[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Snapshot,

    [Parameter(Mandatory = $true)]
    [string]$RootTable,

    [Parameter(Mandatory = $true)]
    [string]$WorkflowId,

    [Parameter(Mandatory = $true)]
    [string]$Output,

    [Parameter(Mandatory = $true)]
    [switch]$ConfirmReadOnly
)

$ErrorActionPreference = 'Stop'

if (-not $ConfirmReadOnly) {
    throw '必须显式提供 -ConfirmReadOnly；该开关只授权固定的限列限行只读核验。'
}

$snapshotPath = [System.IO.Path]::GetFullPath($Snapshot)
$outputPath = [System.IO.Path]::GetFullPath($Output)
if (-not (Test-Path -LiteralPath $snapshotPath -PathType Leaf)) {
    throw "结构快照不存在：$snapshotPath"
}
if (Test-Path -LiteralPath $outputPath) {
    throw "输出文件已存在，拒绝覆盖：$outputPath"
}

$snapshotData = Get-Content -LiteralPath $snapshotPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($snapshotData.schema_version -ne 'database-process-evidence-v1' -or $snapshotData.database -ne 'CXSYSYS' -or $snapshotData.schema -ne 'dbo') {
    throw '只允许 database-process-evidence-v1 格式的 CXSYSYS.dbo 快照。'
}
$formMatches = @($snapshotData.forms | Where-Object { $_.root_table -eq $RootTable -or $_.form_template -eq $RootTable })
if ($formMatches.Count -ne 1) {
    throw "主表或表单模板匹配数必须为1，当前为$($formMatches.Count)。"
}
$workflowMatches = @($snapshotData.workflows | Where-Object { $_.root_table -eq $formMatches[0].root_table -and $_.workflow_id -eq $WorkflowId })
if ($workflowMatches.Count -ne 1) {
    throw "工作流匹配数必须为1，当前为$($workflowMatches.Count)。"
}
$targets = @($formMatches[0].verification_targets)
if ($targets.Count -eq 0) {
    throw '结构快照没有 verification_targets，不能临时扩大实时读取范围。'
}

$connectionValue = [Environment]::GetEnvironmentVariable('INFOMAT_CXSYSYS_READONLY_CONNECTION_STRING', 'Process')
if ([string]::IsNullOrWhiteSpace($connectionValue)) {
    throw '未设置进程级环境变量 INFOMAT_CXSYSYS_READONLY_CONNECTION_STRING。'
}

function Assert-SafeIdentifier {
    param([Parameter(Mandatory = $true)][string]$Name)
    if ($Name -notmatch '^[\p{L}\p{N}_]+$') {
        throw "标识符包含不允许的字符：$Name"
    }
}

function Quote-Identifier {
    param([Parameter(Mandatory = $true)][string]$Name)
    Assert-SafeIdentifier -Name $Name
    return "[$Name]"
}

function Invoke-ScalarCommand {
    param(
        [Parameter(Mandatory = $true)][System.Data.SqlClient.SqlConnection]$Connection,
        [Parameter(Mandatory = $true)][string]$CommandText
    )
    $command = $Connection.CreateCommand()
    $command.CommandText = $CommandText
    $command.CommandTimeout = 15
    try {
        return $command.ExecuteScalar()
    }
    finally {
        $command.Dispose()
    }
}

$builder = New-Object System.Data.SqlClient.SqlConnectionStringBuilder($connectionValue)
if ($builder.InitialCatalog -ne 'CXSYSYS') {
    throw '连接目标数据库必须明确为 CXSYSYS。'
}
$builder.ApplicationIntent = [System.Data.SqlClient.ApplicationIntent]::ReadOnly
$builder.PersistSecurityInfo = $false
$connection = New-Object System.Data.SqlClient.SqlConnection($builder.ConnectionString)

try {
    $connection.Open()
    $actualDatabase = [string](Invoke-ScalarCommand -Connection $connection -CommandText 'SELECT DB_NAME();')
    if ($actualDatabase -ne 'CXSYSYS') {
        throw "实际连接数据库不是 CXSYSYS：$actualDatabase"
    }
    $isSysadmin = [int](Invoke-ScalarCommand -Connection $connection -CommandText "SELECT ISNULL(IS_SRVROLEMEMBER('sysadmin'), 0);")
    $isDbOwner = [int](Invoke-ScalarCommand -Connection $connection -CommandText "SELECT ISNULL(IS_MEMBER('db_owner'), 0);")
    if ($isSysadmin -eq 1 -or $isDbOwner -eq 1) {
        throw '账号属于 sysadmin 或 db_owner，不符合专用只读账号要求。'
    }

    $permissionCommand = $connection.CreateCommand()
    $permissionCommand.CommandText = "SELECT permission_name FROM fn_my_permissions(NULL, 'DATABASE');"
    $permissionReader = $permissionCommand.ExecuteReader()
    $permissions = New-Object System.Collections.Generic.List[string]
    try {
        while ($permissionReader.Read()) {
            $permissions.Add([string]$permissionReader.GetValue(0))
        }
    }
    finally {
        $permissionReader.Close()
        $permissionCommand.Dispose()
    }
    $forbiddenPermissions = @($permissions | Where-Object {
        $_ -match '^(ALTER|CONTROL|CREATE|DELETE|INSERT|UPDATE|EXECUTE|IMPERSONATE|TAKE OWNERSHIP|BACKUP)'
    })
    if ($forbiddenPermissions.Count -gt 0) {
        throw "账号包含写入或管理权限，拒绝继续：$($forbiddenPermissions -join '、')"
    }

    $results = New-Object System.Collections.Generic.List[object]
    foreach ($target in $targets) {
        $tableName = [string]$target.table
        Assert-SafeIdentifier -Name $tableName
        $columns = @($target.columns)
        if ($columns.Count -eq 0) {
            throw "核验目标$tableName没有指定列；禁止读取全部列。"
        }
        if ($columns.Count -gt 20) {
            throw "核验目标$tableName一次最多允许20列。"
        }
        $maxRows = if ($target.max_rows) { [int]$target.max_rows } else { 20 }
        if ($maxRows -lt 1 -or $maxRows -gt 20) {
            throw "核验目标$tableName的max_rows必须在1至20之间。"
        }
        foreach ($columnNameValue in $columns) {
            $columnName = [string]$columnNameValue
            Assert-SafeIdentifier -Name $columnName
            if ($columnName -match '(?i)(phone|mobile|email|contact|password|token|secret|手机号|邮箱|联系方式|密码|令牌)') {
                throw "核验列属于禁止读取范围：$tableName.$columnName"
            }
            $quotedTable = Quote-Identifier -Name $tableName
            $quotedColumn = Quote-Identifier -Name $columnName
            $command = $connection.CreateCommand()
            $command.CommandTimeout = 15
            $command.CommandText = @"
SELECT COUNT_BIG(1) AS sampled_rows,
       SUM(CASE WHEN sample.$quotedColumn IS NULL THEN 0 ELSE 1 END) AS non_null_rows
FROM (SELECT TOP (@maxRows) $quotedColumn FROM [dbo].$quotedTable ORDER BY (SELECT NULL)) AS sample;
"@
            [void]$command.Parameters.Add('@maxRows', [System.Data.SqlDbType]::Int)
            $command.Parameters['@maxRows'].Value = $maxRows
            $reader = $command.ExecuteReader()
            try {
                [void]$reader.Read()
                $results.Add([pscustomobject]@{
                    table = $tableName
                    column = $columnName
                    sampled_rows = [int64]$reader.GetValue(0)
                    non_null_rows = if ($reader.IsDBNull(1)) { 0 } else { [int64]$reader.GetValue(1) }
                })
            }
            finally {
                $reader.Close()
                $command.Dispose()
            }
        }
    }

    $verification = [ordered]@{
        schema_version = 'cxsysys-read-only-verification-v1'
        read_only_verified = $true
        verified_at = [DateTimeOffset]::Now.ToString('o')
        database = 'CXSYSYS'
        schema = 'dbo'
        root_table = $formMatches[0].root_table
        workflow_id = $WorkflowId
        application_intent = 'ReadOnly'
        maximum_rows_per_target = 20
        raw_values_included = $false
        database_write_operations = 0
        permission_summary = [ordered]@{
            sysadmin = $false
            db_owner = $false
            forbidden_permissions = @()
        }
        results = @($results)
    }
    $outputDirectory = Split-Path -Parent $outputPath
    if ($outputDirectory) {
        [System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
    }
    $verification | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $outputPath -Encoding UTF8
    Write-Output "只读核验完成：$outputPath"
}
finally {
    if ($connection.State -ne [System.Data.ConnectionState]::Closed) {
        $connection.Close()
    }
    $connection.Dispose()
    $connectionValue = $null
    $builder.Clear()
}
