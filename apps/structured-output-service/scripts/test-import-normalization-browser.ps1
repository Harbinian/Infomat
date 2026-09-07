param(
  [string]$BaseUrl = 'http://127.0.0.1:3001',
  [switch]$Headed
)

$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$scenarioPath = Join-Path $PSScriptRoot 'import-normalization-browser-scenario.js'
$sessionName = "infomat-import-normalization-$PID"
$npxCommand = Get-Command npx.cmd -ErrorAction SilentlyContinue

if (-not $npxCommand) {
  throw 'npx.cmd was not found. Install Node.js/npm before running this script.'
}
if (-not (Test-Path -LiteralPath $scenarioPath -PathType Leaf)) {
  throw "Browser scenario was not found: $scenarioPath"
}

try {
  $health = Invoke-RestMethod -Uri "$($BaseUrl.TrimEnd('/'))/api/health" -Method Get -TimeoutSec 10
} catch {
  throw "Cannot connect to the candidate 3001 instance at $BaseUrl. This script does not start the service. Original error: $($_.Exception.Message)"
}
if ($health.status -ne 'ok' -or $health.schema_version -ne 'process-governance-v7' -or $health.release_status -ne 'released') {
  throw "Candidate health response is unexpected: $($health | ConvertTo-Json -Compress)"
}

Push-Location $appRoot
try {
  $openArguments = @(
    '--yes', '--package', '@playwright/cli', 'playwright-cli', "-s=$sessionName",
    'open', $BaseUrl, '--browser', 'msedge'
  )
  if ($Headed) { $openArguments += '--headed' }
  & $npxCommand.Source @openArguments
  if ($LASTEXITCODE -ne 0) {
    throw "Playwright CLI failed to open the candidate page in Microsoft Edge. Exit code: $LASTEXITCODE"
  }

  & $npxCommand.Source --yes --package '@playwright/cli' playwright-cli "-s=$sessionName" snapshot | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Playwright CLI failed to snapshot the candidate page. Exit code: $LASTEXITCODE"
  }

  & $npxCommand.Source --yes --package '@playwright/cli' playwright-cli "-s=$sessionName" run-code --filename $scenarioPath
  if ($LASTEXITCODE -ne 0) {
    throw "Import normalization browser regression failed. Exit code: $LASTEXITCODE"
  }
} finally {
  & $npxCommand.Source --yes --package '@playwright/cli' playwright-cli "-s=$sessionName" close 2>$null | Out-Null
  Pop-Location
}

Write-Host '3001 import normalization browser regression passed in Microsoft Edge.'
