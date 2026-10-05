# Connects only to the supplied instance; writes CLI evidence and synthetic page data, never starts services or writes a database.
param(
  [Parameter(Mandatory = $true)][string]$BaseUrl,
  [ValidateSet('process-governance-v7', 'process-governance-v8')]
  [string]$ExpectedSchemaVersion = 'process-governance-v8',
  [switch]$Headed
)

$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$scenarioPath = Join-Path $PSScriptRoot 'v7-performance-browser-scenario.js'
$sessionName = "infomat-v7-performance-$PID"

$npx = Get-Command npx.cmd -ErrorAction SilentlyContinue
if (-not $npx) {
  throw 'npx.cmd was not found. Install Node.js/npm before running this script.'
}

try {
  $health = Invoke-RestMethod -Uri "$($BaseUrl.TrimEnd('/'))/api/health" -Method Get -TimeoutSec 10
} catch {
  throw "Cannot connect to the candidate 3001 instance at $BaseUrl. This script does not start the service. Original error: $($_.Exception.Message)"
}

if ($health.status -ne 'ok' -or $health.schema_version -ne $ExpectedSchemaVersion -or $health.release_status -notin @('candidate', 'released')) {
  throw "Candidate health response is unexpected: $($health | ConvertTo-Json -Compress)"
}

Push-Location $appRoot
try {
  $openArguments = @('--yes', '--package', '@playwright/cli', 'playwright-cli', "-s=$sessionName", 'open', $BaseUrl, '--browser', 'msedge')
  if ($Headed) { $openArguments += '--headed' }
  & $npx.Source @openArguments
  if ($LASTEXITCODE -ne 0) { throw "Playwright CLI failed to open the page. Exit code: $LASTEXITCODE" }

  $scenarioOutput = & $npx.Source --yes --package '@playwright/cli' playwright-cli "-s=$sessionName" run-code --filename $scenarioPath
  $scenarioExitCode = $LASTEXITCODE
  $scenarioOutput | Write-Output
  if ($scenarioExitCode -eq 0 -and (($scenarioOutput -join "`n") -notmatch '### Result\s*\r?\n[^\r\n]*"passed"\s*:\s*true')) {
    throw 'Browser scenario did not return a complete passing result.'
  }
  $LASTEXITCODE = $scenarioExitCode
  if ($LASTEXITCODE -ne 0) {
    throw "Browser performance regression failed for $ExpectedSchemaVersion. Exit code: $LASTEXITCODE"
  }
} finally {
  & $npx.Source --yes --package '@playwright/cli' playwright-cli "-s=$sessionName" close 2>$null | Out-Null
  Pop-Location
}

Write-Host "3001 $ExpectedSchemaVersion browser performance regression passed in Microsoft Edge (1699x828)."
