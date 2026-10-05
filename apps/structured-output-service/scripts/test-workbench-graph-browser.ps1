# Uses an already running, explicitly supplied candidate; never starts/stops services or touches a database.
# Generates only fictional fixture JSON, actual draft downloads, screenshots and evidence in the chosen local output folder.
param(
  [Parameter(Mandatory = $true)][string]$BaseUrl,
  [string]$OutputDir,
  [switch]$Headed
)
$ErrorActionPreference = 'Stop'
$candidateUri = [uri]$BaseUrl
if ($candidateUri.Scheme -ne 'http' -or $candidateUri.Host -notin @('127.0.0.1','localhost','::1','[::1]') -or $candidateUri.IsDefaultPort -or $candidateUri.Port -in @(3000,3001) -or $candidateUri.UserInfo -or $candidateUri.AbsolutePath -ne '/' -or $candidateUri.Query -or $candidateUri.Fragment) { throw 'An explicit loopback candidate origin is required; ports 3000 and 3001 are forbidden.' }
$appRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent (Split-Path -Parent $appRoot)
if (-not $OutputDir) { $OutputDir = Join-Path $repoRoot 'output/playwright/workbench-graph' }
$graphOutput = [System.IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Force -Path $graphOutput | Out-Null
$fixturePath = Join-Path $graphOutput 'fictional-graph-fixture.json'
$npx = Get-Command npx.cmd -ErrorAction Stop
$health = Invoke-RestMethod -Uri "$($BaseUrl.TrimEnd('/'))/api/health" -TimeoutSec 10
if ($health.status -ne 'ok' -or $health.schema_version -ne 'process-governance-v8' -or $health.release_status -ne 'candidate') { throw 'The target must report a V8 candidate health contract.' }
$sessionName = "3001-workbench-graph-$PID"
Push-Location $appRoot
try {
  & node (Join-Path $PSScriptRoot 'workbench-graph-fixture.js') $fixturePath
  if ($LASTEXITCODE -ne 0) { throw 'Fictional graph fixture generation failed.' }
  $openArgs = @('--yes','--package','@playwright/cli','playwright-cli',"-s=$sessionName",'open','about:blank','--browser','msedge')
  if ($Headed) { $openArgs += '--headed' }
  & $npx.Source @openArgs | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Microsoft Edge could not open the candidate.' }
  & $npx.Source --yes --package '@playwright/cli' playwright-cli "-s=$sessionName" snapshot | Out-Null
  $configuration = @{ fixturePath = $fixturePath; outputDir = $graphOutput; BaseUrl = $BaseUrl.TrimEnd('/') } | ConvertTo-Json -Compress
  $configCode = "async page => { await page.evaluate(value => { globalThis.__workbenchGraphTestConfig = value; }, $configuration); return {configured:true}; }"
  $configPath = Join-Path $graphOutput 'configure-cli.js'
  $configCode | Set-Content -LiteralPath $configPath -Encoding utf8
  $configured = & $npx.Source --yes --package '@playwright/cli' playwright-cli "-s=$sessionName" --raw run-code --filename $configPath
  if (($configured -join "`n") -notmatch '"configured"\s*:\s*true') { throw "CLI graph configuration failed: $configured" }
  $raw = & $npx.Source --yes --package '@playwright/cli' playwright-cli "-s=$sessionName" run-code --filename (Join-Path $PSScriptRoot 'workbench-graph-browser-scenario.js')
  $joined = $raw -join "`n"
  $joined | Set-Content -LiteralPath (Join-Path $graphOutput 'cli-output.txt') -Encoding utf8
  if ($joined -notmatch '(?s)### Result\s*\r?\n(.*?)\r?\n### Ran Playwright code') {
    & $npx.Source --yes --package '@playwright/cli' playwright-cli "-s=$sessionName" screenshot --filename (Join-Path $graphOutput 'failed-scenario.png') | Out-Null
    $failureText = if ($joined -match '(?s)### Error\s*\r?\n(.*?)(###|$)') { $Matches[1].Trim() } else { 'No completed result; inspect CLI output and failed-scenario.png.' }
    throw "Graph scenario did not return evidence. See $graphOutput/cli-output.txt. $failureText"
  }
  try { $evidence = $Matches[1] | ConvertFrom-Json } catch { throw "Graph scenario returned invalid JSON evidence. See $graphOutput/cli-output.txt." }
  $evidence | ConvertTo-Json -Depth 50 | Set-Content -LiteralPath (Join-Path $graphOutput 'evidence.json') -Encoding utf8
  if (-not $evidence.passed) { throw 'The graph browser scenario did not finish successfully.' }
  Write-Output "Microsoft Edge graph verification passed: $($evidence.checks.Count) checks, 1699x828, $graphOutput/evidence.json"
} finally {
  & $npx.Source --yes --package '@playwright/cli' playwright-cli "-s=$sessionName" close 2>$null | Out-Null
  Pop-Location
}
