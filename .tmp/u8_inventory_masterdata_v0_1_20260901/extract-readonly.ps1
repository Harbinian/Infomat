param(
    [string]$OutputPath = 'E:\CA001\Infomat\.tmp\u8_inventory_masterdata_v0_1_20260901\live-audit.json'
)

$ErrorActionPreference = 'Stop'

function Get-ScopedEnvironmentValue {
    param([Parameter(Mandatory = $true)][string]$Name)

    foreach ($scope in @('Process', 'User', 'Machine')) {
        $value = [Environment]::GetEnvironmentVariable($Name, $scope)
        if ($value) {
            return $value
        }
    }

    throw "Required environment variable is missing: $Name"
}

function Convert-DataTableRows {
    param([Parameter(Mandatory = $true)][System.Data.DataTable]$Table)

    $rows = @()
    foreach ($row in $Table.Rows) {
        $item = [ordered]@{}
        foreach ($column in $Table.Columns) {
            $value = $row[$column.ColumnName]
            if ($value -is [System.DBNull]) {
                $value = $null
            }
            $item[$column.ColumnName] = $value
        }
        $rows += [pscustomobject]$item
    }
    return ,$rows
}

function Invoke-ReadOnlyQuery {
    param(
        [Parameter(Mandatory = $true)][System.Data.SqlClient.SqlConnection]$Connection,
        [Parameter(Mandatory = $true)][string]$Sql,
        [int]$CommandTimeoutSeconds = 180
    )

    if ($Sql -notmatch '^\s*(SELECT|WITH)\b') {
        throw 'Only SELECT or WITH read-only statements are permitted.'
    }

    $command = $Connection.CreateCommand()
    $command.CommandText = $Sql
    $command.CommandTimeout = $CommandTimeoutSeconds
    $adapter = New-Object System.Data.SqlClient.SqlDataAdapter($command)
    $table = New-Object System.Data.DataTable
    [void]$adapter.Fill($table)
    return Convert-DataTableRows -Table $table
}

function Quote-SqlIdentifier {
    param([Parameter(Mandatory = $true)][string]$Name)
    return '[' + $Name.Replace(']', ']]') + ']'
}

$builder = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
$builder['Data Source'] = (Get-ScopedEnvironmentValue 'SQLSERVER_HOST') + ',' + (Get-ScopedEnvironmentValue 'SQLSERVER_PORT')
$builder['Initial Catalog'] = Get-ScopedEnvironmentValue 'SQLSERVER_DATABASE'
$builder['User ID'] = Get-ScopedEnvironmentValue 'SQLSERVER_USER'
$builder['Password'] = Get-ScopedEnvironmentValue 'SQLSERVER_PASSWORD'
$builder['Encrypt'] = [bool]::Parse((Get-ScopedEnvironmentValue 'SQLSERVER_ENCRYPT'))
$builder['TrustServerCertificate'] = [bool]::Parse((Get-ScopedEnvironmentValue 'SQLSERVER_TRUST_SERVER_CERTIFICATE'))
$builder['Persist Security Info'] = $false

$connection = New-Object System.Data.SqlClient.SqlConnection($builder.ConnectionString)
$connection.Open()

try {
    $startSnapshot = Invoke-ReadOnlyQuery -Connection $connection -Sql @'
SELECT
    DB_NAME() AS database_name,
    CONVERT(varchar(19), SYSDATETIME(), 120) AS database_time,
    (SELECT COUNT_BIG(1) FROM dbo.Inventory) AS Inventory_rows,
    (SELECT COUNT_BIG(1) FROM dbo.Inventory_Sub) AS Inventory_Sub_rows,
    (SELECT COUNT_BIG(1) FROM dbo.InventoryClass) AS InventoryClass_rows,
    (SELECT COUNT_BIG(1) FROM dbo.Ca_Inventory) AS Ca_Inventory_rows,
    (SELECT COUNT_BIG(1) FROM dbo.Ca_Inventory_Buffer) AS Ca_Inventory_Buffer_rows,
    (SELECT COUNT_BIG(1) FROM dbo.Inventory_extradefine) AS Inventory_extradefine_rows
'@

    $columns = Invoke-ReadOnlyQuery -Connection $connection -Sql @'
SELECT
    s.name AS schema_name,
    o.name AS object_name,
    o.type_desc AS object_type,
    c.column_id,
    c.name AS column_name,
    t.name AS data_type,
    CASE
        WHEN c.max_length = -1 THEN -1
        WHEN t.name IN ('nchar', 'nvarchar') THEN c.max_length / 2
        ELSE c.max_length
    END AS declared_length,
    c.precision,
    c.scale,
    c.is_nullable,
    c.is_identity,
    c.is_computed,
    c.collation_name,
    dc.name AS default_constraint_name,
    dc.definition AS default_definition
FROM sys.objects o
JOIN sys.schemas s ON s.schema_id = o.schema_id
JOIN sys.columns c ON c.object_id = o.object_id
JOIN sys.types t ON t.user_type_id = c.user_type_id
LEFT JOIN sys.default_constraints dc
    ON dc.parent_object_id = c.object_id
   AND dc.parent_column_id = c.column_id
WHERE s.name = N'dbo'
  AND o.name IN (N'Inventory', N'Inventory_Sub', N'InventoryClass', N'Ca_Inventory')
ORDER BY
    CASE o.name
        WHEN N'Inventory' THEN 1
        WHEN N'Inventory_Sub' THEN 2
        WHEN N'InventoryClass' THEN 3
        WHEN N'Ca_Inventory' THEN 4
        ELSE 9
    END,
    c.column_id
'@

    $indexes = Invoke-ReadOnlyQuery -Connection $connection -Sql @'
SELECT
    s.name AS schema_name,
    o.name AS object_name,
    c.name AS column_name,
    i.name AS index_name,
    i.type_desc AS index_type,
    i.is_unique,
    i.is_primary_key,
    i.is_unique_constraint,
    ic.key_ordinal,
    ic.is_included_column
FROM sys.objects o
JOIN sys.schemas s ON s.schema_id = o.schema_id
JOIN sys.indexes i ON i.object_id = o.object_id AND i.index_id > 0
JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
WHERE s.name = N'dbo'
  AND o.name IN (N'Inventory', N'Inventory_Sub', N'InventoryClass')
ORDER BY o.name, i.name, ic.key_ordinal, c.column_id
'@

    $foreignKeys = Invoke-ReadOnlyQuery -Connection $connection -Sql @'
SELECT
    fk.name AS foreign_key_name,
    SCHEMA_NAME(po.schema_id) AS parent_schema,
    po.name AS parent_object,
    pc.name AS parent_column,
    SCHEMA_NAME(ro.schema_id) AS referenced_schema,
    ro.name AS referenced_object,
    rc.name AS referenced_column,
    fk.is_disabled,
    fk.is_not_trusted,
    fk.delete_referential_action_desc,
    fk.update_referential_action_desc
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
JOIN sys.objects po ON po.object_id = fk.parent_object_id
JOIN sys.columns pc ON pc.object_id = po.object_id AND pc.column_id = fkc.parent_column_id
JOIN sys.objects ro ON ro.object_id = fk.referenced_object_id
JOIN sys.columns rc ON rc.object_id = ro.object_id AND rc.column_id = fkc.referenced_column_id
WHERE po.name IN (N'Inventory', N'Inventory_Sub', N'InventoryClass')
   OR ro.name IN (N'Inventory', N'Inventory_Sub', N'InventoryClass')
ORDER BY fk.name, fkc.constraint_column_id
'@

    $alignment = Invoke-ReadOnlyQuery -Connection $connection -Sql @'
SELECT
    (SELECT COUNT_BIG(1)
       FROM dbo.Inventory i
       LEFT JOIN dbo.Inventory_Sub s ON s.cInvSubCode = i.cInvCode
      WHERE s.cInvSubCode IS NULL) AS Inventory_missing_Sub,
    (SELECT COUNT_BIG(1)
       FROM dbo.Inventory_Sub s
       LEFT JOIN dbo.Inventory i ON i.cInvCode = s.cInvSubCode
      WHERE i.cInvCode IS NULL) AS Sub_missing_Inventory,
    (SELECT COUNT_BIG(1)
       FROM dbo.Inventory i
       LEFT JOIN dbo.Ca_Inventory c ON c.cInvCode = i.cInvCode
      WHERE c.cInvCode IS NULL) AS Inventory_missing_Ca,
    (SELECT COUNT_BIG(1)
       FROM dbo.Ca_Inventory c
       LEFT JOIN dbo.Inventory i ON i.cInvCode = c.cInvCode
      WHERE i.cInvCode IS NULL) AS Ca_missing_Inventory,
    (SELECT COUNT_BIG(1)
       FROM dbo.Inventory i
       LEFT JOIN dbo.InventoryClass ic ON ic.cInvCCode = i.cInvCCode
      WHERE NULLIF(LTRIM(RTRIM(i.cInvCCode)), N'') IS NOT NULL
        AND ic.cInvCCode IS NULL) AS Inventory_orphan_class,
    (SELECT COUNT_BIG(1)
       FROM dbo.Inventory
      WHERE NULLIF(LTRIM(RTRIM(cInvCCode)), N'') IS NULL) AS Inventory_blank_class
'@

    $coreMetrics = Invoke-ReadOnlyQuery -Connection $connection -Sql @'
SELECT
    COUNT_BIG(1) AS total_rows,
    SUM(CASE WHEN NULLIF(LTRIM(RTRIM(cInvName)), N'') IS NULL THEN 1 ELSE 0 END) AS blank_cInvName,
    SUM(CASE WHEN NULLIF(LTRIM(RTRIM(cInvStd)), N'') IS NULL THEN 1 ELSE 0 END) AS blank_cInvStd,
    SUM(CASE WHEN NULLIF(LTRIM(RTRIM(cInvCCode)), N'') IS NULL THEN 1 ELSE 0 END) AS blank_cInvCCode,
    SUM(CASE WHEN bPurchase = 1 THEN 1 ELSE 0 END) AS bPurchase_1,
    SUM(CASE WHEN bSelf = 1 THEN 1 ELSE 0 END) AS bSelf_1,
    SUM(CASE WHEN bPurchase = 1 AND bSelf = 1 THEN 1 ELSE 0 END) AS purchase_and_self,
    SUM(CASE WHEN bPurchase = 0 AND bSelf = 0 THEN 1 ELSE 0 END) AS neither_purchase_nor_self,
    SUM(CASE WHEN bInvBatch = 1 THEN 1 ELSE 0 END) AS bInvBatch_1,
    SUM(CASE WHEN bSerial = 1 THEN 1 ELSE 0 END) AS bSerial_1,
    SUM(CASE WHEN bBomMain = 1 THEN 1 ELSE 0 END) AS bBomMain_1,
    SUM(CASE WHEN bBomSub = 1 THEN 1 ELSE 0 END) AS bBomSub_1,
    SUM(CASE WHEN bProductBill = 1 THEN 1 ELSE 0 END) AS bProductBill_1,
    SUM(CASE WHEN bSpecialOrder = 1 THEN 1 ELSE 0 END) AS bSpecialOrder_1,
    SUM(CASE WHEN bProxyForeign = 1 THEN 1 ELSE 0 END) AS bProxyForeign_1,
    SUM(CASE WHEN bPropertyCheck = 1 THEN 1 ELSE 0 END) AS bPropertyCheck_1,
    SUM(CASE WHEN bReceiptByDT = 1 THEN 1 ELSE 0 END) AS bReceiptByDT_1,
    SUM(CASE WHEN bSolitude = 1 THEN 1 ELSE 0 END) AS bSolitude_1,
    SUM(CASE WHEN NULLIF(LTRIM(RTRIM(cVenCode)), N'') IS NOT NULL THEN 1 ELSE 0 END) AS nonblank_cVenCode,
    SUM(CASE WHEN NULLIF(LTRIM(RTRIM(cEngineerFigNo)), N'') IS NOT NULL THEN 1 ELSE 0 END) AS nonblank_cEngineerFigNo,
    SUM(CASE WHEN NULLIF(LTRIM(RTRIM(cQuality)), N'') IS NOT NULL THEN 1 ELSE 0 END) AS nonblank_cQuality,
    SUM(CASE WHEN NULLIF(LTRIM(RTRIM(cEnterprise)), N'') IS NOT NULL THEN 1 ELSE 0 END) AS nonblank_cEnterprise,
    SUM(CASE WHEN cInvDefine9 LIKE N'%' + NCHAR(23458) + NCHAR(20379) + N'%' THEN 1 ELSE 0 END) AS customer_supplied_text_rows,
    SUM(CASE WHEN cInvDefine9 LIKE N'%' + NCHAR(23458) + NCHAR(20379) + N'%' AND bInvBatch = 1 THEN 1 ELSE 0 END) AS customer_supplied_text_batch_rows,
    SUM(CASE WHEN cInvDefine9 LIKE N'%' + NCHAR(23458) + NCHAR(20379) + N'%' AND bInvBatch = 0 THEN 1 ELSE 0 END) AS customer_supplied_text_no_batch_rows,
    COUNT_BIG(DISTINCT iSupplyType) AS iSupplyType_distinct
FROM dbo.Inventory
'@

    $subMetrics = Invoke-ReadOnlyQuery -Connection $connection -Sql @'
SELECT
    COUNT_BIG(1) AS total_rows,
    SUM(CASE WHEN bPrjMat = 1 THEN 1 ELSE 0 END) AS bPrjMat_1,
    SUM(CASE WHEN bInvKeyPart = 1 THEN 1 ELSE 0 END) AS bInvKeyPart_1,
    SUM(CASE WHEN bBondedInv = 1 THEN 1 ELSE 0 END) AS bBondedInv_1,
    SUM(CASE WHEN bImport = 1 THEN 1 ELSE 0 END) AS bImport_1,
    SUM(CASE WHEN bBatchCreate = 1 THEN 1 ELSE 0 END) AS bBatchCreate_1,
    SUM(CASE WHEN bBatchProperty1 = 1 THEN 1 ELSE 0 END) AS bBatchProperty1_1,
    SUM(CASE WHEN bBatchProperty2 = 1 THEN 1 ELSE 0 END) AS bBatchProperty2_1,
    SUM(CASE WHEN bBatchProperty3 = 1 THEN 1 ELSE 0 END) AS bBatchProperty3_1,
    SUM(CASE WHEN bBatchProperty4 = 1 THEN 1 ELSE 0 END) AS bBatchProperty4_1,
    SUM(CASE WHEN bBatchProperty5 = 1 THEN 1 ELSE 0 END) AS bBatchProperty5_1,
    SUM(CASE WHEN bBatchProperty6 = 1 THEN 1 ELSE 0 END) AS bBatchProperty6_1,
    SUM(CASE WHEN bBatchProperty7 = 1 THEN 1 ELSE 0 END) AS bBatchProperty7_1,
    SUM(CASE WHEN bBatchProperty8 = 1 THEN 1 ELSE 0 END) AS bBatchProperty8_1,
    SUM(CASE WHEN bBatchProperty9 = 1 THEN 1 ELSE 0 END) AS bBatchProperty9_1,
    SUM(CASE WHEN bBatchProperty10 = 1 THEN 1 ELSE 0 END) AS bBatchProperty10_1,
    SUM(CASE WHEN NULLIF(LTRIM(RTRIM(cInvAppDocNo)), N'') IS NOT NULL THEN 1 ELSE 0 END) AS nonblank_cInvAppDocNo,
    SUM(CASE WHEN bPUQuota = 1 THEN 1 ELSE 0 END) AS bPUQuota_1,
    SUM(CASE WHEN bInvROHS = 1 THEN 1 ELSE 0 END) AS bInvROHS_1,
    SUM(CASE WHEN bInByProCheck = 1 THEN 1 ELSE 0 END) AS bInByProCheck_1,
    SUM(CASE WHEN bIsAttachFile = 1 THEN 1 ELSE 0 END) AS bIsAttachFile_1
FROM dbo.Inventory_Sub
'@

    $codeQuality = Invoke-ReadOnlyQuery -Connection $connection -Sql @'
SELECT
    COUNT_BIG(1) AS total_rows,
    COUNT_BIG(DISTINCT cInvCode) AS distinct_codes,
    MIN(LEN(cInvCode)) AS min_code_length,
    MAX(LEN(cInvCode)) AS max_code_length,
    AVG(CONVERT(float, LEN(cInvCode))) AS avg_code_length,
    SUM(CASE WHEN cInvCode <> LTRIM(RTRIM(cInvCode)) THEN 1 ELSE 0 END) AS code_edge_space_rows,
    SUM(CASE WHEN cInvCode COLLATE Latin1_General_100_BIN2 LIKE '%[a-z]%' THEN 1 ELSE 0 END) AS code_lowercase_rows,
    SUM(CASE WHEN cInvCode LIKE N'% %' OR CHARINDEX(CHAR(9), cInvCode) > 0 OR CHARINDEX(CHAR(13), cInvCode) > 0 OR CHARINDEX(CHAR(10), cInvCode) > 0 THEN 1 ELSE 0 END) AS code_whitespace_rows,
    SUM(CASE WHEN cInvCode COLLATE Latin1_General_100_BIN2 LIKE '%[^A-Z0-9-]%' THEN 1 ELSE 0 END) AS code_outside_new_charset_rows,
    SUM(CASE WHEN cInvCode LIKE N'-%' OR cInvCode LIKE N'%-' THEN 1 ELSE 0 END) AS code_edge_hyphen_rows,
    SUM(CASE WHEN cInvCode LIKE N'%--%' THEN 1 ELSE 0 END) AS code_double_hyphen_rows,
    (SELECT COUNT_BIG(1)
       FROM (
            SELECT LTRIM(RTRIM(cInvName)) AS normalized_name
              FROM dbo.Inventory
             WHERE NULLIF(LTRIM(RTRIM(cInvName)), N'') IS NOT NULL
             GROUP BY LTRIM(RTRIM(cInvName))
            HAVING COUNT_BIG(1) > 1
       ) d) AS duplicate_name_groups,
    (SELECT COALESCE(SUM(d.row_count), 0)
       FROM (
            SELECT COUNT_BIG(1) AS row_count
              FROM dbo.Inventory
             WHERE NULLIF(LTRIM(RTRIM(cInvName)), N'') IS NOT NULL
             GROUP BY LTRIM(RTRIM(cInvName))
            HAVING COUNT_BIG(1) > 1
       ) d) AS duplicate_name_rows,
    (SELECT COUNT_BIG(1)
       FROM (
            SELECT LTRIM(RTRIM(cInvName)) AS normalized_name,
                   COALESCE(NULLIF(LTRIM(RTRIM(cInvStd)), N''), N'<BLANK>') AS normalized_std
              FROM dbo.Inventory
             WHERE NULLIF(LTRIM(RTRIM(cInvName)), N'') IS NOT NULL
             GROUP BY LTRIM(RTRIM(cInvName)), COALESCE(NULLIF(LTRIM(RTRIM(cInvStd)), N''), N'<BLANK>')
            HAVING COUNT_BIG(1) > 1
       ) d) AS duplicate_name_std_groups,
    (SELECT COALESCE(SUM(d.row_count), 0)
       FROM (
            SELECT COUNT_BIG(1) AS row_count
              FROM dbo.Inventory
             WHERE NULLIF(LTRIM(RTRIM(cInvName)), N'') IS NOT NULL
             GROUP BY LTRIM(RTRIM(cInvName)), COALESCE(NULLIF(LTRIM(RTRIM(cInvStd)), N''), N'<BLANK>')
            HAVING COUNT_BIG(1) > 1
       ) d) AS duplicate_name_std_rows,
    (SELECT COUNT_BIG(1)
       FROM (
            SELECT LTRIM(RTRIM(cInvAddCode)) AS normalized_add_code
              FROM dbo.Inventory
             WHERE NULLIF(LTRIM(RTRIM(cInvAddCode)), N'') IS NOT NULL
             GROUP BY LTRIM(RTRIM(cInvAddCode))
            HAVING COUNT_BIG(1) > 1
       ) d) AS duplicate_add_code_groups,
    (SELECT COUNT_BIG(1)
       FROM (
            SELECT LTRIM(RTRIM(cBarCode)) AS normalized_bar_code
              FROM dbo.Inventory
             WHERE NULLIF(LTRIM(RTRIM(cBarCode)), N'') IS NOT NULL
             GROUP BY LTRIM(RTRIM(cBarCode))
            HAVING COUNT_BIG(1) > 1
       ) d) AS duplicate_barcode_groups
FROM dbo.Inventory
'@

    $classificationMetrics = Invoke-ReadOnlyQuery -Connection $connection -Sql @'
SELECT
    COUNT_BIG(DISTINCT i.cInvCCode) AS used_class_count,
    COUNT_BIG(DISTINCT CASE WHEN ic.bInvCEnd = 1 THEN i.cInvCCode END) AS used_leaf_class_count,
    SUM(CASE WHEN ic.bInvCEnd = 0 THEN 1 ELSE 0 END) AS rows_on_nonleaf_class,
    SUM(CASE WHEN ic.cInvCCode IS NULL THEN 1 ELSE 0 END) AS orphan_class_rows
FROM dbo.Inventory i
LEFT JOIN dbo.InventoryClass ic ON ic.cInvCCode = i.cInvCCode
'@

    $supplyTypeDistribution = Invoke-ReadOnlyQuery -Connection $connection -Sql @'
SELECT CONVERT(nvarchar(40), iSupplyType) AS value, COUNT_BIG(1) AS row_count
FROM dbo.Inventory
GROUP BY iSupplyType
ORDER BY iSupplyType
'@

    $define9Distribution = Invoke-ReadOnlyQuery -Connection $connection -Sql @'
SELECT
    COALESCE(NULLIF(LTRIM(RTRIM(cInvDefine9)), N''), N'<' + NCHAR(31354) + N'>') AS value,
    COUNT_BIG(1) AS row_count
FROM dbo.Inventory
GROUP BY COALESCE(NULLIF(LTRIM(RTRIM(cInvDefine9)), N''), N'<' + NCHAR(31354) + N'>')
ORDER BY row_count DESC, value
'@

    $classRows = Invoke-ReadOnlyQuery -Connection $connection -Sql @'
SELECT
    ic.cInvCCode,
    ic.cInvCName,
    ic.iInvCGrade,
    ic.bInvCEnd,
    COUNT_BIG(i.cInvCode) AS inventory_rows,
    SUM(CASE WHEN i.cInvDefine9 LIKE N'%' + NCHAR(23458) + NCHAR(20379) + N'%' THEN 1 ELSE 0 END) AS customer_supplied_text_rows,
    SUM(CASE WHEN i.bInvBatch = 1 THEN 1 ELSE 0 END) AS batch_enabled_rows
FROM dbo.InventoryClass ic
LEFT JOIN dbo.Inventory i ON i.cInvCCode = ic.cInvCCode
GROUP BY ic.cInvCCode, ic.cInvCName, ic.iInvCGrade, ic.bInvCEnd
ORDER BY ic.cInvCCode
'@

    $rootClassRows = Invoke-ReadOnlyQuery -Connection $connection -Sql @'
SELECT
    root.cInvCCode,
    root.cInvCName,
    COUNT_BIG(i.cInvCode) AS inventory_rows,
    SUM(CASE WHEN i.bSelf = 1 THEN 1 ELSE 0 END) AS self_rows,
    SUM(CASE WHEN i.bPurchase = 1 THEN 1 ELSE 0 END) AS purchase_rows,
    SUM(CASE WHEN i.cInvDefine9 LIKE N'%' + NCHAR(23458) + NCHAR(20379) + N'%' THEN 1 ELSE 0 END) AS customer_supplied_text_rows,
    SUM(CASE WHEN i.bInvBatch = 1 THEN 1 ELSE 0 END) AS batch_enabled_rows
FROM dbo.InventoryClass root
LEFT JOIN dbo.Inventory i ON i.cInvCCode LIKE root.cInvCCode + N'%'
WHERE root.iInvCGrade = 1
GROUP BY root.cInvCCode, root.cInvCName
ORDER BY root.cInvCCode
'@

    $customerSupplyNoBatch = Invoke-ReadOnlyQuery -Connection $connection -Sql @'
SELECT
    i.cInvCode,
    i.cInvName,
    i.cInvStd,
    i.cInvCCode,
    ic.cInvCName,
    i.cInvDefine9,
    i.bInvBatch,
    i.bSerial,
    i.bPurchase,
    i.bSelf,
    i.cEngineerFigNo
FROM dbo.Inventory i
LEFT JOIN dbo.InventoryClass ic ON ic.cInvCCode = i.cInvCCode
WHERE i.cInvDefine9 LIKE N'%' + NCHAR(23458) + NCHAR(20379) + N'%'
  AND i.bInvBatch = 0
ORDER BY i.cInvCode
'@

    $sameNameReferenceCounts = Invoke-ReadOnlyQuery -Connection $connection -Sql @'
SELECT
    SUM(CASE WHEN o.type = 'U' THEN 1 ELSE 0 END) AS user_tables_with_cInvCode,
    SUM(CASE WHEN o.type = 'V' THEN 1 ELSE 0 END) AS views_with_cInvCode
FROM sys.objects o
JOIN sys.columns c ON c.object_id = o.object_id
WHERE o.is_ms_shipped = 0
  AND c.name = N'cInvCode'
'@

    $physicalColumns = @($columns | Where-Object { $_.object_name -in @('Inventory', 'Inventory_Sub', 'InventoryClass') })
    $fieldStatistics = @()
    $position = 0
    foreach ($column in $physicalColumns) {
        $position += 1
        $objectName = [string]$column.object_name
        $columnName = [string]$column.column_name
        $dataType = [string]$column.data_type
        $qObject = Quote-SqlIdentifier $objectName
        $qColumn = Quote-SqlIdentifier $columnName
        if ($dataType -in @('timestamp', 'rowversion', 'binary', 'varbinary', 'image')) {
            $normalized = "NULLIF(CONVERT(nvarchar(4000), CONVERT(varbinary(max), $qColumn), 1), N'')"
        }
        else {
            $normalized = "NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(4000), $qColumn))), N'')"
        }
        $statsSql = @"
SELECT
    COUNT_BIG(1) AS total_count,
    SUM(CASE WHEN $qColumn IS NULL THEN 1 ELSE 0 END) AS null_count,
    SUM(CASE WHEN $qColumn IS NOT NULL AND $normalized IS NULL THEN 1 ELSE 0 END) AS blank_count,
    SUM(CASE WHEN $normalized IS NOT NULL THEN 1 ELSE 0 END) AS nonblank_count,
    COUNT_BIG(DISTINCT $normalized) AS distinct_nonblank_count
FROM dbo.$qObject
"@
        $stat = @(Invoke-ReadOnlyQuery -Connection $connection -Sql $statsSql)[0]
        $distribution = @()
        $distinctCount = [int64]$stat.distinct_nonblank_count
        if ($distinctCount -gt 0 -and $distinctCount -le 12) {
            $distributionSql = @"
SELECT TOP (12)
    LEFT($normalized, 120) AS value,
    COUNT_BIG(1) AS row_count
FROM dbo.$qObject
WHERE $normalized IS NOT NULL
GROUP BY $normalized
ORDER BY row_count DESC, value
"@
            $distribution = @(Invoke-ReadOnlyQuery -Connection $connection -Sql $distributionSql)
        }

        $fieldStatistics += [pscustomobject][ordered]@{
            object_name = $objectName
            column_id = [int]$column.column_id
            column_name = $columnName
            total_count = [int64]$stat.total_count
            null_count = [int64]$stat.null_count
            blank_count = [int64]$stat.blank_count
            nonblank_count = [int64]$stat.nonblank_count
            distinct_nonblank_count = [int64]$stat.distinct_nonblank_count
            low_cardinality_distribution = $distribution
        }

        if (($position % 50) -eq 0) {
            Write-Host "Read-only field profiling progress: $position / $($physicalColumns.Count)"
        }
    }

    $endSnapshot = Invoke-ReadOnlyQuery -Connection $connection -Sql @'
SELECT
    CONVERT(varchar(19), SYSDATETIME(), 120) AS database_time,
    (SELECT COUNT_BIG(1) FROM dbo.Inventory) AS Inventory_rows,
    (SELECT COUNT_BIG(1) FROM dbo.Inventory_Sub) AS Inventory_Sub_rows,
    (SELECT COUNT_BIG(1) FROM dbo.InventoryClass) AS InventoryClass_rows,
    (SELECT COUNT_BIG(1) FROM dbo.Ca_Inventory) AS Ca_Inventory_rows
'@

    $result = [ordered]@{
        extraction_method = 'SQL Server metadata and aggregate SELECT queries only; no database write statement executed'
        start_snapshot = $startSnapshot[0]
        end_snapshot = $endSnapshot[0]
        columns = $columns
        indexes = $indexes
        foreign_keys = $foreignKeys
        alignment = $alignment[0]
        core_metrics = $coreMetrics[0]
        inventory_sub_metrics = $subMetrics[0]
        code_quality = $codeQuality[0]
        classification_metrics = $classificationMetrics[0]
        supply_type_distribution = $supplyTypeDistribution
        cInvDefine9_distribution = $define9Distribution
        inventory_classes = $classRows
        root_class_distribution = $rootClassRows
        customer_supply_no_batch_review = $customerSupplyNoBatch
        same_name_reference_counts = $sameNameReferenceCounts[0]
        field_statistics = $fieldStatistics
    }

    $outputDirectory = Split-Path -Parent $OutputPath
    if (-not (Test-Path -LiteralPath $outputDirectory)) {
        [void](New-Item -ItemType Directory -Path $outputDirectory -Force)
    }
    $result | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $OutputPath -Encoding utf8

    [pscustomobject]@{
        Database = $result.start_snapshot.database_name
        StartTime = $result.start_snapshot.database_time
        EndTime = $result.end_snapshot.database_time
        InventoryStart = $result.start_snapshot.Inventory_rows
        InventoryEnd = $result.end_snapshot.Inventory_rows
        PhysicalFieldCount = $physicalColumns.Count
        ReviewListRows = $customerSupplyNoBatch.Count
        OutputPath = $OutputPath
    } | Format-List
}
finally {
    $connection.Close()
}
