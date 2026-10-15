# Read-only SQL bridge. Accepts validated filter JSON on stdin, never client SQL.
# Credentials use the existing Windows user environment and never leave this process.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$taskConnection = $null
try {
    $taskInput = [Console]::In.ReadToEnd() | ConvertFrom-Json
    if ($taskInput.operation -notin @('health', 'list','quality-uniqueness','quality-uniqueness-details')) { throw 'Invalid operation' }
    $taskPassword = [Environment]::GetEnvironmentVariable('SQLSERVER_PASSWORD', 'User')
    $taskHost = [Environment]::GetEnvironmentVariable('SQLSERVER_HOST', 'User')
    if ($taskHost -ne '192.168.19.222' -or [string]::IsNullOrEmpty($taskPassword)) { throw 'Configuration unavailable' }
    $taskBuilder = [System.Data.SqlClient.SqlConnectionStringBuilder]::new()
    $taskBuilder['Data Source'] = $taskHost + ',1433'
    $taskBuilder['Initial Catalog'] = 'UFDATA_333_2025'
    $taskBuilder['User ID'] = 'va2'
    $taskBuilder['Password'] = $taskPassword
    $taskBuilder['Connect Timeout'] = 5
    $taskBuilder['Encrypt'] = $true
    $taskBuilder['TrustServerCertificate'] = $true
    $taskBuilder['Application Name'] = 'Infomat-U8-StockOrder-Query'
    $taskConnection = [System.Data.SqlClient.SqlConnection]::new($taskBuilder.ConnectionString)
    Remove-Variable taskPassword,taskBuilder
    $taskConnection.Open()
    $taskCommand = $taskConnection.CreateCommand()
    $taskCommand.CommandTimeout = 12
    if ($taskInput.operation -eq 'health') {
        $taskCommand.CommandText = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../sql/health.sql'),[Text.Encoding]::UTF8)
        $taskReader = $taskCommand.ExecuteReader()
        [void]$taskReader.Read()
        if ($taskReader.GetString(0) -ne 'UFDATA_333_2025' -or $taskReader.GetString(1) -ne 'va2' -or $taskReader.IsDBNull(2) -or $taskReader.IsDBNull(3)) { throw 'Database contract mismatch' }
        $taskResult = @{ ok=$true; database=$taskReader.GetString(0); databaseUser='va2'; timeZone='UTC+8'; beijingNow=$taskReader.GetString(4); mappingCount=$taskReader.GetInt64(5); readOnlyService=$true }
        $taskReader.Close()
    } elseif ($taskInput.operation -in @('quality-uniqueness','quality-uniqueness-details')) {
        $taskDetails=$taskInput.operation -eq 'quality-uniqueness-details'
        $taskFilters=$taskInput.filters
        $taskPage=[int]$taskFilters.page;$taskSize=[int]$taskFilters.pageSize
        if($taskPage -lt 1 -or $taskPage -gt 1000000 -or $taskSize -lt 1 -or $taskSize -gt 100){throw 'Invalid pagination'}
        foreach($taskPair in @(@('drawing','Drawing'),@('qualityNumber','QualityNumber'))){
            $taskValue=([string]$taskFilters.($taskPair[0])).Trim()
            if($taskValue.Length -gt 120){throw 'Invalid text filter'}
            if(-not $taskDetails -and $taskValue){$taskValue='%'+$taskValue.Replace('~','~~').Replace('%','~%').Replace('_','~_').Replace('[','~[')+'%'}
            $taskParameter=$taskCommand.Parameters.Add('@'+$taskPair[1],[System.Data.SqlDbType]::NVarChar,250)
            $taskParameter.Value=if($taskValue){$taskValue}else{[DBNull]::Value}
        }
        if(-not $taskDetails){
            if($taskFilters.status -notin @('all','duplicate','unique','pending')){throw 'Invalid quality status'}
            [void]$taskCommand.Parameters.Add('@CheckStatus',[System.Data.SqlDbType]::VarChar,20)
            $taskCommand.Parameters['@CheckStatus'].Value=$taskFilters.status
        }
        [void]$taskCommand.Parameters.Add('@Offset',[System.Data.SqlDbType]::Int);$taskCommand.Parameters['@Offset'].Value=($taskPage-1)*$taskSize
        [void]$taskCommand.Parameters.Add('@PageSize',[System.Data.SqlDbType]::Int);$taskCommand.Parameters['@PageSize'].Value=$taskSize
        $taskSource=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '../sql/quality-source.sql'),[Text.Encoding]::UTF8)
        if($taskDetails){
            $taskCommand.CommandText=([IO.File]::ReadAllText((Join-Path $PSScriptRoot '../sql/quality-details.sql'),[Text.Encoding]::UTF8)).Replace('/*QUALITY_SOURCE*/',$taskSource)
        }else{
            $taskGroups=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '../sql/quality-groups.sql'),[Text.Encoding]::UTF8)
            $taskCommand.CommandText=([IO.File]::ReadAllText((Join-Path $PSScriptRoot '../sql/quality-list.sql'),[Text.Encoding]::UTF8)).Replace('/*QUALITY_GROUPS*/',$taskSource+$taskGroups)
        }
        $taskReader=$taskCommand.ExecuteReader();[void]$taskReader.Read()
        $taskTotal=$taskReader.GetInt64(0)
        if($taskDetails){$taskCheckedAt=$taskReader.GetString(1)}
        else{$taskTotals=@{total=$taskTotal;duplicates=$taskReader.GetInt32(1);unique=$taskReader.GetInt32(2);pending=$taskReader.GetInt32(3)};$taskCheckedAt=$taskReader.GetString(4)}
        [void]$taskReader.NextResult();$taskRows=[System.Collections.Generic.List[object]]::new()
        while($taskReader.Read()){
            if($taskRows.Count -ge $taskSize){throw 'Row limit exceeded'}
            $taskRow=[ordered]@{}
            for($taskIndex=0;$taskIndex -lt $taskReader.FieldCount;$taskIndex++){$taskRow[$taskReader.GetName($taskIndex)]=if($taskReader.IsDBNull($taskIndex)){$null}else{$taskReader.GetValue($taskIndex)}}
            $taskRows.Add($taskRow)
        }
        $taskReader.Close()
        $taskResult=@{ok=$true;rows=@($taskRows.ToArray());page=$taskPage;pageSize=$taskSize;timeZone='UTC+8';checkedAtUtc8=$taskCheckedAt}
        if($taskDetails){$taskResult.total=$taskTotal}else{$taskResult.totals=$taskTotals}
    } else {
        $taskFilters = $taskInput.filters
        $taskConditions = [System.Collections.Generic.List[string]]::new()
        function AddTextFilter([string]$key,[string]$condition) {
            $taskValue = [string]$taskFilters.$key
            if ($taskValue) {
                if ($taskValue.Length -gt 120) { throw 'Invalid filter' }
                # Escape SQL LIKE metacharacters so the supplied text remains literal.
                $taskValue = $taskValue.Replace('~','~~').Replace('%','~%').Replace('_','~_').Replace('[','~[')
                $taskParameter = $taskCommand.Parameters.Add('@'+$key,[System.Data.SqlDbType]::NVarChar,250)
                $taskParameter.Value = '%'+$taskValue+'%'
                $taskConditions.Add($condition)
            }
        }
        AddTextFilter 'voucher' "m.VoucherCode LIKE @voucher ESCAPE N'~'"
        AddTextFilter 'productionNumber' "(m.SourceProductionNumber LIKE @productionNumber ESCAPE N'~' OR m.AttributedProductionNumber LIKE @productionNumber ESCAPE N'~' OR m.SalesProductionNumber LIKE @productionNumber ESCAPE N'~')"
        AddTextFilter 'productionOrder' "(m.SourceProductionOrderCode LIKE @productionOrder ESCAPE N'~' OR m.ProductionOrderCode LIKE @productionOrder ESCAPE N'~')"
        AddTextFilter 'salesOrder' "m.SalesOrderCode LIKE @salesOrder ESCAPE N'~'"
        AddTextFilter 'inventory' "m.InventoryCode LIKE @inventory ESCAPE N'~'"
        AddTextFilter 'qualityNumber' "n.QualityNumber LIKE @qualityNumber ESCAPE N'~'"
        AddTextFilter 'partNumber' "n.U8PartNumber LIKE @partNumber ESCAPE N'~'"
        foreach ($taskPair in @(@('type','m.VoucherType'),@('status','m.ResolutionStatus'),@('qualityCheck','qc.QualityNumberCheck'))) {
            $taskValue = [string]$taskFilters.($taskPair[0])
            if ($taskValue) {
                $taskParameter = $taskCommand.Parameters.Add('@'+$taskPair[0],[System.Data.SqlDbType]::VarChar,30)
                $taskParameter.Value=$taskValue
                $taskConditions.Add($taskPair[1]+' = @'+$taskPair[0])
            }
        }
        switch ($taskFilters.difference) {
            'different' { $taskConditions.Add('m.ProductionNumberDiffers = 1') }
            'same' { $taskConditions.Add('m.ProductionNumberDiffers = 0') }
            'unknown' { $taskConditions.Add('m.ProductionNumberDiffers IS NULL') }
        }
        foreach ($taskKey in @('dateFrom','dateTo')) {
            if ($taskFilters.$taskKey) {
                $taskParameter=$taskCommand.Parameters.Add('@'+$taskKey,[System.Data.SqlDbType]::DateTime)
                $taskParameter.Value=[datetime]::ParseExact($taskFilters.$taskKey,'yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)
                if ($taskKey -eq 'dateFrom') { $taskConditions.Add('m.VoucherDate >= @dateFrom') }
                else { $taskConditions.Add('m.VoucherDate < DATEADD(DAY,1,@dateTo)') }
            }
        }
        $taskPage=[int]$taskFilters.page
        $taskSize=[int]$taskFilters.pageSize
        if ($taskPage -lt 1 -or $taskPage -gt 1000000 -or $taskSize -lt 1 -or $taskSize -gt 100) { throw 'Invalid pagination' }
        $taskWhere = if ($taskConditions.Count) { ' WHERE '+($taskConditions -join ' AND ') } else { '' }
        [void]$taskCommand.Parameters.Add('@Offset',[System.Data.SqlDbType]::Int)
        $taskCommand.Parameters['@Offset'].Value=($taskPage-1)*$taskSize
        [void]$taskCommand.Parameters.Add('@PageSize',[System.Data.SqlDbType]::Int)
        $taskCommand.Parameters['@PageSize'].Value=$taskSize
        # 编号读取当前生产明细；先核对引用归属，避免误把其他母件的编号用于本条记录。
        # 两段查询复用相同关联，确保编号筛选下统计数量与返回明细保持同一粒度。
        $taskJoins = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../sql/joins.sql'),[Text.Encoding]::UTF8)
        $taskColumns = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../sql/columns.sql'),[Text.Encoding]::UTF8)
        $taskCommand.CommandText = @"
SELECT COUNT_BIG(*) AS Total,
       COALESCE(SUM(CASE WHEN m.VoucherType='10' THEN 1 ELSE 0 END),0) AS Receipts,
       COALESCE(SUM(CASE WHEN m.VoucherType='11' THEN 1 ELSE 0 END),0) AS Issues,
       COALESCE(SUM(CASE WHEN m.ResolutionStatus='pending' THEN 1 ELSE 0 END),0) AS Pending,
       CONVERT(varchar(23),DATEADD(HOUR,8,SYSUTCDATETIME()),121) AS CheckedAtUtc8
FROM dbo.ext_StockOrderAttribution AS m
$taskJoins
$taskWhere;
$taskColumns
FROM dbo.ext_StockOrderAttribution AS m
$taskJoins
LEFT JOIN dbo.Inventory AS i ON i.cInvCode=m.InventoryCode
LEFT JOIN dbo.Inventory AS pi ON pi.cInvCode=md.InvCode
$taskWhere
ORDER BY m.CapturedAtUtc8 DESC,m.VoucherType,m.DetailID DESC
OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
"@
        $taskReader=$taskCommand.ExecuteReader()
        [void]$taskReader.Read()
        $taskTotals=@{ total=$taskReader.GetInt64(0); receipts=$taskReader.GetInt32(1); issues=$taskReader.GetInt32(2); pending=$taskReader.GetInt32(3) }
        $taskCheckedAt=$taskReader.GetString(4)
        [void]$taskReader.NextResult()
        $taskRows=[System.Collections.Generic.List[object]]::new()
        while ($taskReader.Read()) {
            if ($taskRows.Count -ge $taskSize) { throw 'Row limit exceeded' }
            $taskRow=[ordered]@{}
            for ($taskIndex=0;$taskIndex -lt $taskReader.FieldCount;$taskIndex++) {
                $taskRow[$taskReader.GetName($taskIndex)]=if ($taskReader.IsDBNull($taskIndex)) { $null } else { $taskReader.GetValue($taskIndex) }
            }
            $taskRows.Add($taskRow)
        }
        $taskReader.Close()
        $taskResult=@{ ok=$true; rows=@($taskRows.ToArray()); totals=$taskTotals; page=$taskPage; pageSize=$taskSize; timeZone='UTC+8'; checkedAtUtc8=$taskCheckedAt }
    }
    ConvertTo-Json -InputObject $taskResult -Depth 8 -Compress
} catch {
    [Console]::Out.Write('{"ok":false,"error":"database_unavailable"}')
    exit 1
} finally { if ($taskConnection) { $taskConnection.Dispose() } }
