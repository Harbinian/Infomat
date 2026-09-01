$ErrorActionPreference = 'Stop'

function Get-UserEnv([string]$name) {
  [Environment]::GetEnvironmentVariable($name, 'User')
}

function Invoke-Db([string]$sql) {
  $command = $connection.CreateCommand()
  $command.CommandText = $sql
  $command.CommandTimeout = 60
  $adapter = [System.Data.SqlClient.SqlDataAdapter]::new($command)
  $table = [System.Data.DataTable]::new()
  [void]$adapter.Fill($table)
  $result = @()
  foreach ($row in $table.Rows) {
    $record = [ordered]@{}
    foreach ($column in $table.Columns) {
      $value = $row[$column.ColumnName]
      if ($value -is [System.DBNull]) {
        $record[$column.ColumnName] = $null
      } elseif ($value -is [datetime]) {
        $record[$column.ColumnName] = $value.ToString('yyyy-MM-dd HH:mm:ss')
      } else {
        $record[$column.ColumnName] = $value
      }
    }
    $result += [pscustomobject]$record
  }
  $result
}

$hostName = Get-UserEnv 'SQLSERVER_HOST'
$port = Get-UserEnv 'SQLSERVER_PORT'
$databaseName = Get-UserEnv 'SQLSERVER_DATABASE'
$userName = Get-UserEnv 'SQLSERVER_USER'
$password = Get-UserEnv 'SQLSERVER_PASSWORD'
$encrypt = Get-UserEnv 'SQLSERVER_ENCRYPT'
$trustServerCertificate = Get-UserEnv 'SQLSERVER_TRUST_SERVER_CERTIFICATE'
$connectionString = "Server=$hostName,$port;Initial Catalog=$databaseName;User ID=$userName;Password=$password;Encrypt=$encrypt;TrustServerCertificate=$trustServerCertificate;Connect Timeout=20;"
$connection = [System.Data.SqlClient.SqlConnection]::new($connectionString)

try {
  $connection.Open()
  $tables = Invoke-Db @"
SELECT t.name AS table_name, t.create_date, t.modify_date
FROM sys.tables AS t
WHERE t.schema_id = SCHEMA_ID(N'dbo')
  AND t.name IN (N'Inventory', N'InventoryClass', N'Ca_Inventory_Buffer', N'Inventory_Sub', N'Inventory_extradefine')
ORDER BY t.name;
"@
  $objects = Invoke-Db @"
SELECT s.name AS schema_name, o.name AS object_name, o.type, o.type_desc, o.create_date, o.modify_date
FROM sys.objects AS o
JOIN sys.schemas AS s ON s.schema_id = o.schema_id
WHERE s.name = N'dbo'
  AND o.name IN (N'Ca_Inventory', N'Ca_Inventory_Buffer', N'Inventory', N'InventoryClass', N'Inventory_Sub', N'Inventory_extradefine');
"@
  $viewDefinition = Invoke-Db @"
SELECT OBJECT_DEFINITION(OBJECT_ID(N'dbo.Ca_Inventory')) AS view_definition;
"@
  $viewDependencies = Invoke-Db @"
SELECT referenced_schema_name, referenced_entity_name, referenced_database_name, referenced_server_name, is_schema_bound_reference
FROM sys.sql_expression_dependencies
WHERE referencing_id = OBJECT_ID(N'dbo.Ca_Inventory')
ORDER BY referenced_schema_name, referenced_entity_name;
"@
  $columns = Invoke-Db @"
SELECT t.name AS table_name, c.column_id, c.name AS column_name, ty.name AS data_type,
       CASE WHEN ty.name IN (N'nvarchar',N'varchar',N'nchar',N'char') THEN c.max_length / CASE WHEN ty.name LIKE N'n%' THEN 2 ELSE 1 END ELSE c.max_length END AS length_or_bytes,
       c.is_nullable
FROM sys.tables AS t
JOIN sys.columns AS c ON c.object_id = t.object_id
JOIN sys.types AS ty ON ty.user_type_id = c.user_type_id
WHERE t.schema_id = SCHEMA_ID(N'dbo')
  AND t.name IN (N'Inventory', N'InventoryClass', N'Ca_Inventory_Buffer', N'Inventory_Sub', N'Inventory_extradefine')
  AND (t.name IN (N'InventoryClass')
       OR c.name IN (N'cInvCode',N'cInvName',N'cInvStd',N'cInvCCode',N'cInvAddCode',N'iInvRCost',N'iId',N'iPartID',N'cInvM_Unit',N'cAssUnit',N'cInvCName',N'cComUnitCode',N'cAssComUnitCode',N'cModifyPerson',N'dModifyDate',N'pubufts',N'bProxyForeign',N'caFlag'))
ORDER BY t.name,c.column_id;
"@
  $viewColumns = Invoke-Db @"
SELECT c.column_id, c.name AS column_name, ty.name AS data_type,
       CASE WHEN ty.name IN (N'nvarchar',N'varchar',N'nchar',N'char') THEN c.max_length / CASE WHEN ty.name LIKE N'n%' THEN 2 ELSE 1 END ELSE c.max_length END AS length_or_bytes,
       c.is_nullable
FROM sys.columns AS c
JOIN sys.types AS ty ON ty.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID(N'dbo.Ca_Inventory')
ORDER BY c.column_id;
"@
  $objectColumnCounts = Invoke-Db @"
SELECT o.name AS object_name, o.type_desc, COUNT(c.column_id) AS column_count
FROM sys.objects AS o
JOIN sys.columns AS c ON c.object_id=o.object_id
WHERE o.schema_id=SCHEMA_ID(N'dbo')
  AND o.name IN (N'Ca_Inventory',N'Ca_Inventory_Buffer',N'Inventory',N'InventoryClass',N'Inventory_extradefine')
GROUP BY o.name,o.type_desc
ORDER BY o.name;
"@
  $viewSecurity = Invoke-Db @"
SELECT OBJECTPROPERTYEX(OBJECT_ID(N'dbo.Ca_Inventory'), N'IsEncrypted') AS is_encrypted,
       CASE WHEN OBJECT_DEFINITION(OBJECT_ID(N'dbo.Ca_Inventory')) IS NULL THEN 1 ELSE 0 END AS definition_unavailable;
"@
  $indexes = Invoke-Db @"
SELECT t.name AS table_name, i.name AS index_name, i.type_desc, i.is_primary_key, i.is_unique, i.is_unique_constraint,
       STUFF((SELECT N', ' + c.name FROM sys.index_columns ic2 JOIN sys.columns c ON c.object_id=ic2.object_id AND c.column_id=ic2.column_id WHERE ic2.object_id=i.object_id AND ic2.index_id=i.index_id AND ic2.key_ordinal>0 ORDER BY ic2.key_ordinal FOR XML PATH(''),TYPE).value('.','nvarchar(max)'),1,2,N'') AS key_columns
FROM sys.tables t JOIN sys.indexes i ON i.object_id=t.object_id
WHERE t.schema_id=SCHEMA_ID(N'dbo') AND t.name IN (N'Inventory',N'InventoryClass',N'Ca_Inventory',N'Ca_Inventory_Buffer') AND i.index_id>0
ORDER BY t.name,i.is_primary_key DESC,i.name;
"@
  $foreignKeys = Invoke-Db @"
SELECT fk.name AS foreign_key_name, OBJECT_SCHEMA_NAME(fk.parent_object_id) AS child_schema, OBJECT_NAME(fk.parent_object_id) AS child_table,
       pc.name AS child_column, OBJECT_SCHEMA_NAME(fk.referenced_object_id) AS parent_schema, OBJECT_NAME(fk.referenced_object_id) AS parent_table,
       rc.name AS parent_column, fk.is_disabled, fk.is_not_trusted
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id=fk.object_id
JOIN sys.columns pc ON pc.object_id=fkc.parent_object_id AND pc.column_id=fkc.parent_column_id
JOIN sys.columns rc ON rc.object_id=fkc.referenced_object_id AND rc.column_id=fkc.referenced_column_id
WHERE fk.parent_object_id IN (OBJECT_ID(N'dbo.Inventory'),OBJECT_ID(N'dbo.InventoryClass'),OBJECT_ID(N'dbo.Ca_Inventory'))
   OR fk.referenced_object_id IN (OBJECT_ID(N'dbo.Inventory'),OBJECT_ID(N'dbo.InventoryClass'),OBJECT_ID(N'dbo.Ca_Inventory'))
ORDER BY child_table, foreign_key_name;
"@
  $counts = Invoke-Db @"
SELECT
  (SELECT COUNT(*) FROM dbo.Inventory) AS inventory_rows,
  (SELECT COUNT(*) FROM dbo.InventoryClass) AS inventory_class_rows,
  (SELECT COUNT(*) FROM dbo.Ca_Inventory) AS ca_inventory_rows,
  (SELECT COUNT(*) FROM dbo.Ca_Inventory_Buffer) AS ca_inventory_buffer_rows,
  (SELECT COUNT(DISTINCT cInvCode) FROM dbo.Inventory) AS inventory_distinct_codes,
  (SELECT COUNT(DISTINCT cInvCode) FROM dbo.Ca_Inventory) AS ca_inventory_distinct_codes,
  (SELECT COUNT(*) FROM dbo.Ca_Inventory AS c LEFT JOIN dbo.Inventory AS i ON i.cInvCode=c.cInvCode WHERE i.cInvCode IS NULL) AS ca_missing_inventory,
  (SELECT COUNT(*) FROM dbo.Inventory AS i LEFT JOIN dbo.Ca_Inventory AS c ON c.cInvCode=i.cInvCode WHERE c.cInvCode IS NULL) AS inventory_missing_ca,
  (SELECT COUNT(*) FROM dbo.Ca_Inventory AS c JOIN dbo.Inventory AS i ON i.cInvCode=c.cInvCode WHERE ISNULL(c.cInvCCode,N'')<>ISNULL(i.cInvCCode,N'')) AS category_code_mismatches,
  (SELECT COUNT(*) FROM dbo.Ca_Inventory AS c JOIN dbo.Inventory AS i ON i.cInvCode=c.cInvCode WHERE ISNULL(c.cInvName,N'')<>ISNULL(i.cInvName,N'')) AS name_mismatches,
  (SELECT COUNT(*) FROM dbo.Ca_Inventory AS c JOIN dbo.Inventory AS i ON i.cInvCode=c.cInvCode WHERE ISNULL(c.iPartID,-2147483648)<>ISNULL(i.iId,-2147483648)) AS partid_vs_iid_mismatches,
  (SELECT COUNT(*) FROM dbo.Ca_Inventory AS c JOIN dbo.InventoryClass AS ic ON ic.cInvCCode=c.cInvCCode WHERE ISNULL(c.cInvCName,N'')<>ISNULL(ic.cInvCName,N'')) AS category_name_mismatches,
  (SELECT COUNT(*) FROM dbo.Ca_Inventory AS c LEFT JOIN dbo.InventoryClass AS ic ON ic.cInvCCode=c.cInvCCode WHERE ic.cInvCCode IS NULL) AS ca_missing_class,
  (SELECT COUNT(*) FROM dbo.Ca_Inventory AS c LEFT JOIN dbo.Ca_Inventory_Buffer AS b ON b.cInvCode=c.cInvCode WHERE b.cInvCode IS NULL) AS ca_missing_buffer_by_code,
  (SELECT COUNT(*) FROM dbo.Ca_Inventory_Buffer AS b LEFT JOIN dbo.Ca_Inventory AS c ON c.cInvCode=b.cInvCode WHERE c.cInvCode IS NULL) AS buffer_missing_ca_by_code,
  (SELECT COUNT(*) FROM dbo.Ca_Inventory AS c JOIN dbo.Ca_Inventory_Buffer AS b ON b.cInvCode=c.cInvCode WHERE ISNULL(c.cInvName,N'')<>ISNULL(b.cInvName,N'')) AS ca_buffer_name_mismatches,
  (SELECT COUNT(*) FROM dbo.Ca_Inventory AS c JOIN dbo.Ca_Inventory_Buffer AS b ON b.cInvCode=c.cInvCode WHERE ISNULL(c.cInvCCode,N'')<>ISNULL(b.cInvCCode,N'')) AS ca_buffer_category_mismatches,
  (SELECT COUNT(*) FROM dbo.Ca_Inventory AS c JOIN dbo.Inventory AS i ON i.cInvCode=c.cInvCode WHERE ISNULL(c.cInvM_Unit,N'')=ISNULL(i.cComUnitCode,N'') AND ISNULL(c.cInvM_Unit,N'')<>N'') AS main_unit_same_as_com_unit_code,
  (SELECT COUNT(*) FROM dbo.Ca_Inventory AS c JOIN dbo.Inventory AS i ON i.cInvCode=c.cInvCode WHERE ISNULL(c.cAssUnit,N'')=ISNULL(i.cAssComUnitCode,N'') AND ISNULL(c.cAssUnit,N'')<>N'') AS ass_unit_same_as_ass_com_unit_code;
"@
  $classProfile = Invoke-Db @"
SELECT iInvCGrade AS grade, bInvCEnd AS is_leaf, COUNT(*) AS class_rows
FROM dbo.InventoryClass GROUP BY iInvCGrade,bInvCEnd ORDER BY iInvCGrade,bInvCEnd;
"@
  $caClassUsage = Invoke-Db @"
SELECT ic.iInvCGrade AS grade, ic.bInvCEnd AS is_leaf, COUNT(DISTINCT c.cInvCCode) AS used_class_count, COUNT(*) AS inventory_row_count
FROM dbo.Ca_Inventory AS c
JOIN dbo.InventoryClass AS ic ON ic.cInvCCode=c.cInvCCode
GROUP BY ic.iInvCGrade,ic.bInvCEnd
ORDER BY ic.iInvCGrade,ic.bInvCEnd;
"@
  $supplementary = Invoke-Db @"
SELECT
  (SELECT COUNT(*) FROM dbo.Inventory_extradefine) AS inventory_extradefine_rows,
  (SELECT COUNT(*) FROM dbo.Inventory_extradefine AS e LEFT JOIN dbo.Inventory AS i ON i.cInvCode=e.cInvCode WHERE i.cInvCode IS NULL) AS extradefine_missing_inventory,
  (SELECT COUNT(*) FROM dbo.Inventory AS i LEFT JOIN dbo.Inventory_extradefine AS e ON e.cInvCode=i.cInvCode WHERE e.cInvCode IS NULL) AS inventory_missing_extradefine,
  (SELECT COUNT(*) FROM dbo.Inventory_extradefine GROUP BY cInvCode HAVING COUNT(*) > 1) AS extradefine_duplicate_codes;
"@
  [pscustomobject]@{
    captured_at = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    objects = $objects
    tables = $tables
    view_definition = $viewDefinition
    view_dependencies = $viewDependencies
    columns = $columns
    view_columns = $viewColumns
    object_column_counts = $objectColumnCounts
    view_security = $viewSecurity
    indexes = $indexes
    foreign_keys = $foreignKeys
    counts = $counts
    class_profile = $classProfile
    ca_class_usage = $caClassUsage
    supplementary = $supplementary
  } | ConvertTo-Json -Depth 8
}
finally {
  if ($connection) { $connection.Dispose() }
}
