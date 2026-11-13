param([int]$Port = 3090)
$ErrorActionPreference = 'Stop'
if ($Port -in @(3000,3001) -or $Port -lt 1024 -or $Port -gt 65535) { throw 'Choose an independent unprivileged port.' }
$serviceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$artifactRoot = [IO.Path]::GetFullPath((Join-Path $serviceRoot '../../artifacts/process-review-service'))
$dataRoot = Join-Path $artifactRoot 'local'
New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
$existing = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
if ($existing) {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 5
    if ($health.service -ne 'process-review-service' -or $health.mode -ne 'local-isolated') { throw 'Port belongs to another service; no process was stopped.' }
    $scriptResponse = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/app.js" -TimeoutSec 5
    if ($scriptResponse.StatusCode -ne 200) { throw 'Application script is not ready.' }
    Write-Output "Already available at http://127.0.0.1:$Port"
    exit 0
}
$nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
$priorPort = $env:REVIEW_PORT
$priorData = $env:REVIEW_DATA_DIR
$priorBindHost = $env:REVIEW_BIND_HOST
try {
    $env:REVIEW_PORT = "$Port"
    $env:REVIEW_DATA_DIR = $dataRoot
    $env:REVIEW_BIND_HOST = '127.0.0.1'
    $process = Start-Process -FilePath $nodeExecutable -ArgumentList @('server.mjs') -WorkingDirectory $serviceRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $artifactRoot 'server.stdout.log') -RedirectStandardError (Join-Path $artifactRoot 'server.stderr.log')
    $process.Id | Set-Content -LiteralPath (Join-Path $artifactRoot 'server.pid')
} finally {
    $env:REVIEW_PORT = $priorPort
    $env:REVIEW_DATA_DIR = $priorData
    $env:REVIEW_BIND_HOST = $priorBindHost
}
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 300
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
        if ($health.service -eq 'process-review-service' -and $health.mode -eq 'local-isolated') {
            $page = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/" -TimeoutSec 2
            $scriptResponse = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/app.js" -TimeoutSec 2
            if ($page.StatusCode -eq 200 -and $page.Content -match 'src="/app.js"' -and $scriptResponse.StatusCode -eq 200) {
                Write-Output "Local isolated review service: http://127.0.0.1:$Port"
                exit 0
            }
        }
    } catch { }
}
throw 'Startup health or application-content check failed. Inspect this service logs; no other service was modified.'
