# Stops only the recorded process after checking its command and creation time.
param([int]$Port=3088)
$ErrorActionPreference='Stop'
$taskAppRoot=Split-Path -Parent $PSScriptRoot
$taskRepoRoot=Split-Path -Parent (Split-Path -Parent $taskAppRoot)
$taskRecordPath=Join-Path $taskRepoRoot ('artifacts/u8-stock-order-query-runtime-'+$Port+'/process.json')
if (-not (Test-Path -LiteralPath $taskRecordPath)) { throw 'Owned process record is unavailable.' }
$taskRecord=Get-Content -LiteralPath $taskRecordPath -Raw | ConvertFrom-Json
$taskExpectedEntry=Join-Path $taskAppRoot 'server.mjs'
if ($taskRecord.entry -ne $taskExpectedEntry -or $taskRecord.port -ne $Port) { throw 'Process record does not match this service.' }
$taskProcess=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$taskRecord.pid)
if (-not $taskProcess) { Write-Output 'Service is already stopped.'; exit 0 }
$taskRecordedUtc=if ($taskRecord.startedAtUtc -is [datetime]) { $taskRecord.startedAtUtc.ToUniversalTime() } else { [datetimeoffset]::Parse([string]$taskRecord.startedAtUtc).UtcDateTime }
$taskCreationDifference=($taskProcess.CreationDate.ToUniversalTime()-$taskRecordedUtc).TotalSeconds
if ($taskProcess.Name -ne 'node.exe' -or $taskProcess.CommandLine -notlike ('*"'+$taskExpectedEntry+'"*') -or [Math]::Abs($taskCreationDifference) -gt 1) { throw 'Process ownership changed; refusing to stop it.' }
Stop-Process -Id $taskRecord.pid
Write-Output 'Owned query service stopped.'
