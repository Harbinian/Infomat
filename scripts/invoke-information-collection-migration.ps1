param(
  [ValidateSet('dry-run', 'apply', 'check')]
  [string]$Mode = 'dry-run'
)

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

if (-not $env:MYSQL_PASSWORD) { throw 'MYSQL_PASSWORD is required in the ignored local environment file or current process environment.' }

$env:MYSQL_HOST = [string]$config.mysql.host
$env:MYSQL_PORT = [string]$config.mysql.port
$env:MYSQL_USER = [string]$config.mysql.user
$env:MYSQL_DATABASE = [string]$config.mysql.database
$env:MYSQL_CONNECTION_LIMIT = [string]$config.mysql.connectionLimit

$argument = "--$Mode"
Push-Location (Join-Path $repoRoot 'apps/information-collection-service')
try {
  & node scripts/migrate.js $argument
  if ($LASTEXITCODE -ne 0) { throw "Information collection migration $Mode failed." }
} finally {
  Pop-Location
}
