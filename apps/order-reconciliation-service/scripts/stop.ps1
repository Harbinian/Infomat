# Stops only the recorded 9998 process after verifying its entry and port owner.
$ErrorActionPreference='Stop'
$serviceRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeRoot=[IO.Path]::GetFullPath((Join-Path $serviceRoot '../../artifacts/order-reconciliation-9998'))
$record=Get-Content -LiteralPath (Join-Path $runtimeRoot 'process.json') -Raw | ConvertFrom-Json
$targetProcess=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$record.pid)
if(-not $targetProcess){Write-Output 'The recorded 9998 process is not running';exit 0}
$expectedEntry=Join-Path $serviceRoot 'server.mjs'
$listeners=@(Get-NetTCPConnection -LocalPort 9998 -State Listen -ErrorAction SilentlyContinue)
if($targetProcess.Name -ne 'node.exe' -or -not $targetProcess.CommandLine.Contains($expectedEntry) -or $record.entry -ne $expectedEntry -or $listeners.Count -eq 0 -or @($listeners | Where-Object {$_.OwningProcess -ne [int]$record.pid}).Count -gt 0){throw 'Process ownership mismatch; nothing was stopped'}
$health=Invoke-RestMethod -Uri 'http://127.0.0.1:9998/api/health' -TimeoutSec 3
if($health.service -ne 'order-reconciliation' -or $health.activeBatch){throw 'Service identity mismatch or an inventory is still running; nothing was stopped'}
Stop-Process -Id ([int]$record.pid) -ErrorAction Stop
Write-Output 'Only the recorded order-reconciliation 9998 process was stopped'
