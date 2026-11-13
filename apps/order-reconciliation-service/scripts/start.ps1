# Starts only the independent 9998 application. No source query runs on startup.
$ErrorActionPreference='Stop'
$serviceRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeRoot=[IO.Path]::GetFullPath((Join-Path $serviceRoot '../../artifacts/order-reconciliation-9998'))
$listeners=@(Get-NetTCPConnection -LocalPort 9998 -State Listen -ErrorAction SilentlyContinue)
if($listeners.Count){throw 'Port 9998 is already listening; no process was stopped'}
[void][IO.Directory]::CreateDirectory($runtimeRoot)
$nodePath=(Get-Command node.exe -ErrorAction Stop).Source
$serviceProcess=Start-Process -FilePath $nodePath -ArgumentList @((Join-Path $serviceRoot 'server.mjs')) -WorkingDirectory $serviceRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeRoot 'service.stdout.log') -RedirectStandardError (Join-Path $runtimeRoot 'service.stderr.log')
@{pid=$serviceProcess.Id;entry=(Join-Path $serviceRoot 'server.mjs');startedAt=[DateTimeOffset]::UtcNow.ToString('o');port=9998} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeRoot 'process.json') -Encoding UTF8
for($attempt=0;$attempt -lt 30;$attempt++){
 try{$ready=Invoke-RestMethod -Uri 'http://127.0.0.1:9998/api/health' -TimeoutSec 2;if($ready.ok -and $ready.service -eq 'order-reconciliation'){@{ok=$true;service=$ready.service;port=$ready.port;activeBatch=$ready.activeBatch;latestSuccessfulBatchId=$ready.latestSuccessfulBatch.id}|ConvertTo-Json -Compress;exit 0}}catch{}
 Start-Sleep -Milliseconds 300
}
throw '9998 did not become healthy; inspect only its own runtime logs'
