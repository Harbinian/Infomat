param(
  [string]$BaseUrl = 'http://127.0.0.1:3001',
  [switch]$Headed
)

$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$scenarioPath = Join-Path $PSScriptRoot 'pending-edit-browser-scenario.js'
$artifactRoot = Join-Path $appRoot 'output/playwright'
$sessionName = "infomat-pending-edit-$PID"

$npx = Get-Command npx.cmd -ErrorAction SilentlyContinue
if (-not $npx) {
  throw 'npx.cmd was not found. Install Node.js/npm before running this script.'
}

try {
  $health = Invoke-RestMethod -Uri "$($BaseUrl.TrimEnd('/'))/api/health" -Method Get -TimeoutSec 10
} catch {
  throw "Cannot connect to the candidate 3001 instance at $BaseUrl. This script does not start the service. Original error: $($_.Exception.Message)"
}

if ($health.status -ne 'ok' -or $health.schema_version -ne 'process-governance-v7') {
  throw "Candidate health response is unexpected: $($health | ConvertTo-Json -Compress)"
}

New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
Push-Location $appRoot
try {
  $openArguments = @('--yes', '--package', '@playwright/cli', 'playwright-cli', "-s=$sessionName", 'open', $BaseUrl)
  if ($Headed) { $openArguments += '--headed' }
  & $npx.Source @openArguments
  if ($LASTEXITCODE -ne 0) { throw "Playwright CLI failed to open the page. Exit code: $LASTEXITCODE" }

  & $npx.Source --yes --package '@playwright/cli' playwright-cli "-s=$sessionName" run-code --filename $scenarioPath
  if ($LASTEXITCODE -ne 0) {
    throw "Pending-edit browser regression failed. Exit code: $LASTEXITCODE. Failure screenshot, when available: $artifactRoot\pending-edit-browser-failure.png"
  }
} finally {
  & $npx.Source --yes --package '@playwright/cli' playwright-cli "-s=$sessionName" close 2>$null | Out-Null
  Pop-Location
}

Write-Host '3001 pending-edit browser regression passed.'
