$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$config = Get-Content -Raw (Join-Path $scriptDir 'information-collection.config.json') | ConvertFrom-Json
$localEnvPath = Join-Path $scriptDir 'infomat-services.local.env'

if (Test-Path $localEnvPath) {
  foreach ($line in Get-Content $localEnvPath) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
    $splitAt = $trimmed.IndexOf('=')
    if ($splitAt -le 0) { continue }
    $name = $trimmed.Substring(0, $splitAt).Trim()
    $value = $trimmed.Substring($splitAt + 1).Trim()
    if ($name -and -not [Environment]::GetEnvironmentVariable($name, 'Process')) {
      [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
  }
}

if (-not $env:MYSQL_PASSWORD) {
  throw 'MYSQL_PASSWORD is required in scripts/infomat-services.local.env or the current process environment.'
}

$ports = @([int]$config.admin.port, [int]$config.respondent.port)
foreach ($port in $ports) {
  if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
    throw "Port $port is already in use. The launcher will not terminate an unknown process."
  }
}

$env:COLLECTION_BIND_HOST = [string]$config.admin.host
$env:COLLECTION_ADMIN_PORT = [string]$config.admin.port
$env:COLLECTION_RESPONDENT_PORT = [string]$config.respondent.port
$env:COLLECTION_FILE_ROOT = Join-Path $repoRoot ([string]$config.fileRoot)
$env:MYSQL_HOST = [string]$config.mysql.host
$env:MYSQL_PORT = [string]$config.mysql.port
$env:MYSQL_USER = [string]$config.mysql.user
$env:MYSQL_DATABASE = [string]$config.mysql.database
$env:MYSQL_CONNECTION_LIMIT = [string]$config.mysql.connectionLimit

$appDir = Join-Path $repoRoot 'apps/information-collection-service'
$logDir = Join-Path $repoRoot 'artifacts/information-collection/logs'
New-Item -ItemType Directory -Force $logDir | Out-Null
$stdout = Join-Path $logDir 'service.stdout.log'
$stderr = Join-Path $logDir 'service.stderr.log'

Push-Location $appDir
try {
  & node scripts/migrate.js --check
  if ($LASTEXITCODE -ne 0) { throw 'Schema check failed. Run migrate:dry-run and migrate:apply before starting the service.' }
  $process = Start-Process -FilePath 'node' -ArgumentList @('server/index.js') -WorkingDirectory $appDir -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
} finally {
  Pop-Location
}

$deadline = (Get-Date).AddSeconds(20)
do {
  if ($process.HasExited) {
    $message = if (Test-Path $stderr) { (Get-Content -Tail 20 $stderr) -join [Environment]::NewLine } else { 'No error log was created.' }
    throw "Information collection service exited during startup. $message"
  }
  Start-Sleep -Milliseconds 500
  try {
    $admin = Invoke-RestMethod -Uri "http://$($config.admin.host):$($config.admin.port)/api/health" -TimeoutSec 2
    $respondent = Invoke-RestMethod -Uri "http://$($config.respondent.host):$($config.respondent.port)/api/health" -TimeoutSec 2
    if ($admin.status -eq 'ok' -and $respondent.status -eq 'ok') {
      Write-Output "Information collection service started: admin=http://$($config.admin.host):$($config.admin.port), respondent=http://$($config.respondent.host):$($config.respondent.port), pid=$($process.Id)"
      exit 0
    }
  } catch {
    # Continue until the bounded startup deadline.
  }
} while ((Get-Date) -lt $deadline)

Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
throw 'Information collection service did not become healthy within 20 seconds.'
