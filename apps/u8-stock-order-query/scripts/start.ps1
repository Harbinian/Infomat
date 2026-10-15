# Starts only this loopback query service; logs and PID stay under ignored artifacts.
param([int]$Port=3088)
$ErrorActionPreference='Stop'
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Port is invalid.' }
$taskAppRoot=Split-Path -Parent $PSScriptRoot
$taskRepoRoot=Split-Path -Parent (Split-Path -Parent $taskAppRoot)
$taskRuntime=Join-Path $taskRepoRoot ('artifacts/u8-stock-order-query-runtime-'+$Port)
$taskEntry=Join-Path $taskAppRoot 'server.mjs'
$taskListener=Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($taskListener) { throw 'Port is already occupied. Existing processes will not be stopped.' }
$taskNodeCommand=Get-Command node.exe -ErrorAction SilentlyContinue
$taskNode=if ($taskNodeCommand) { $taskNodeCommand.Source } else { Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' }
if (-not (Test-Path -LiteralPath $taskNode)) { throw 'Node runtime is unavailable.' }
New-Item -ItemType Directory -Path $taskRuntime -Force | Out-Null
$taskOldPort=[Environment]::GetEnvironmentVariable('U8_QUERY_PORT','Process')
try {
    $env:U8_QUERY_PORT=[string]$Port
    $taskProcess=Start-Process -FilePath $taskNode -ArgumentList ('"'+$taskEntry+'"') -WorkingDirectory $taskAppRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskRuntime 'stdout.log') -RedirectStandardError (Join-Path $taskRuntime 'stderr.log')
    @{ pid=$taskProcess.Id; port=$Port; entry=$taskEntry; startedAtUtc=$taskProcess.StartTime.ToUniversalTime().ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRuntime 'process.json') -Encoding UTF8
    $taskReady=$false
    for ($taskAttempt=0;$taskAttempt -lt 8;$taskAttempt++) {
        if ($taskProcess.HasExited) { break }
        try {
            $taskHealth=Invoke-RestMethod -Uri ('http://127.0.0.1:'+$Port+'/api/health') -TimeoutSec 5
            if ($taskHealth.ok -and $taskHealth.databaseUser -eq 'va2' -and $taskHealth.timeZone -eq 'UTC+8') { $taskReady=$true; break }
        } catch { }
        Start-Sleep -Milliseconds 250
    }
    if (-not $taskReady) {
        if (-not $taskProcess.HasExited) { $taskProcess.Kill() }
        throw 'Query service health check failed. The newly created process was stopped.'
    }
    [pscustomobject]@{ status='ready'; pid=$taskProcess.Id; url=('http://127.0.0.1:'+$Port); runtime=$taskRuntime; health=$taskHealth } | ConvertTo-Json -Depth 4
} finally { [Environment]::SetEnvironmentVariable('U8_QUERY_PORT',$taskOldPort,'Process') }
