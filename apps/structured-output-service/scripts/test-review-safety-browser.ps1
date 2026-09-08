param([Parameter(Mandatory=$true)][string]$BaseUrl)

$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$sessionName = "infomat-review-safety-$PID"
$browserCommand = Get-Command playwright-cli.cmd -ErrorAction Stop
$health = Invoke-RestMethod "$($BaseUrl.TrimEnd('/'))/api/health" -TimeoutSec 10
if ($health.status -ne 'ok' -or $health.schema_version -ne 'process-governance-v7') { throw 'Expected an explicit v7 test instance.' }
Push-Location $appRoot
try {
  node -e "const fs=require('node:fs');fs.mkdirSync('artifacts/review-safety',{recursive:true});fs.writeFileSync('artifacts/review-safety/fixture.json',JSON.stringify(require('./scripts/review-layout-fixture').createReviewLayoutFixture()));"
  if ($LASTEXITCODE -ne 0) { throw 'Fixture generation failed.' }
  & $browserCommand.Source "-s=$sessionName" open $BaseUrl --browser msedge
  if ($LASTEXITCODE -ne 0) { throw 'Edge did not start.' }
  & $browserCommand.Source "-s=$sessionName" snapshot | Out-Null
  $result = & $browserCommand.Source "-s=$sessionName" run-code --filename (Join-Path $PSScriptRoot 'review-safety-browser-scenario.js') 2>&1
  $result | Set-Content -LiteralPath 'artifacts/review-safety/result.log' -Encoding utf8
  if ($LASTEXITCODE -ne 0 -or ($result -join "`n") -match '### Error' -or ($result -join "`n") -notmatch '"passed":true') { throw "Review safety browser test failed. See artifacts/review-safety/result.log" }
  $result | Select-String '^\{"passed"'
} finally {
  & $browserCommand.Source "-s=$sessionName" close 2>$null | Out-Null
  Pop-Location
}
