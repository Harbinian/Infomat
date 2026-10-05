# Opens only an explicit local candidate; writes synthetic fixture, screenshots and downloaded JSON evidence.
param([Parameter(Mandatory=$true)][string]$BaseUrl,[string]$OutputDir,[switch]$Headed)
$ErrorActionPreference='Stop'
$candidateUri=[Uri]$BaseUrl
if ($candidateUri.Scheme -ne 'http' -or $candidateUri.Host -notin @('127.0.0.1','localhost','::1') -or $candidateUri.Port -in @(80,3000,3001) -or $candidateUri.AbsolutePath -ne '/' -or $candidateUri.Query -or $candidateUri.UserInfo) { throw 'An explicit loopback candidate origin is required; ports 3000 and 3001 are forbidden.' }
$appRoot=Split-Path -Parent $PSScriptRoot
$repoRoot=Split-Path -Parent (Split-Path -Parent $appRoot)
$evidenceRoot=if ($OutputDir) { [System.IO.Path]::GetFullPath($OutputDir) } else { Join-Path $repoRoot 'output/playwright/workbench-ui' }
New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
$fixturePath=Join-Path $repoRoot 'artifacts/3001-frontend-redesign-20261005/workbench-graph-fixture.json'
& node.exe (Join-Path $PSScriptRoot 'workbench-graph-fixture.js') $fixturePath
if ($LASTEXITCODE -ne 0) { throw 'Synthetic fixture generation failed.' }
$health=Invoke-RestMethod -Uri ($BaseUrl.TrimEnd('/')+'/api/health')
if ($health.status -ne 'ok' -or $health.schema_version -ne 'process-governance-v8' -or $health.release_status -ne 'candidate') { throw 'Expected candidate V8 health.' }
$scenario=Get-Content -Raw -Encoding utf8 -LiteralPath (Join-Path $PSScriptRoot 'workbench-browser-scenario.js')
$scenario=$scenario.Replace('__OUTPUT_DIR__',$evidenceRoot.Replace('\','/')).Replace('__FIXTURE_PATH__',$fixturePath.Replace('\','/')).Replace('__BASE_URL__',$BaseUrl.TrimEnd('/'))
$scenarioPath=Join-Path $evidenceRoot 'scenario.js'
[IO.File]::WriteAllText($scenarioPath,$scenario,[Text.UTF8Encoding]::new($false))
$sessionName="3001-workbench-ui-$PID"
Push-Location $appRoot
try {
  $openArgs=@('--yes','--package','@playwright/cli','playwright-cli',"-s=$sessionName",'open','about:blank','--browser','msedge')
  if ($Headed) { $openArgs+='--headed' }
  & npx.cmd @openArgs
  if ($LASTEXITCODE -ne 0) { throw 'Edge launch failed.' }
  $scenarioOutput=& npx.cmd --yes --package '@playwright/cli' playwright-cli "-s=$sessionName" run-code --filename $scenarioPath
  $scenarioOutput | Set-Content -LiteralPath (Join-Path $evidenceRoot 'cli-result.log') -Encoding utf8
  $match=[regex]::Match(($scenarioOutput -join "`n"),'(?s)### Result\s*\n(.*?)\n###')
  if (!$match.Success) { $scenarioOutput | Select-Object -Last 12 | Write-Output; throw 'Scenario result missing.' }
  $result=$match.Groups[1].Value | ConvertFrom-Json
  [IO.File]::WriteAllText((Join-Path $evidenceRoot 'report.json'),($result | ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))
  if (!$result.passed) { Write-Output ($result | ConvertTo-Json -Depth 6); throw 'Workbench UI scenario failed.' }
  & node.exe (Join-Path $PSScriptRoot 'verify-workbench-browser-evidence.js') $evidenceRoot
  if ($LASTEXITCODE -ne 0) { throw 'Downloaded byte evidence failed.' }
  Write-Output "Workbench Edge UI passed $($result.checks.Count) groups. Evidence: $evidenceRoot"
} finally {
  & npx.cmd --yes --package '@playwright/cli' playwright-cli "-s=$sessionName" close 2>$null | Out-Null
  Pop-Location
}
