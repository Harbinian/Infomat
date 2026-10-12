# Reads a local source JSON; uses independent Edge page memory and writes screenshots, actual downloads and a report only.
param([Parameter(Mandatory=$true)][string]$BaseUrl,[Parameter(Mandatory=$true)][string]$SourcePath,[Parameter(Mandatory=$true)][string]$OutputDir,[switch]$Allow3001)
$ErrorActionPreference='Stop'
$candidateUri=[Uri]$BaseUrl
if ($candidateUri.Scheme -ne 'http' -or $candidateUri.Host -notin @('127.0.0.1','localhost') -or $candidateUri.Port -in @(80,3000) -or ($candidateUri.Port -eq 3001 -and !$Allow3001) -or $candidateUri.AbsolutePath -ne '/' -or $candidateUri.Query -or $candidateUri.UserInfo) { throw 'Explicit local origin required; formal 3001 needs -Allow3001.' }
$sourceFile=[IO.Path]::GetFullPath($SourcePath)
$evidenceRoot=[IO.Path]::GetFullPath($OutputDir)
$sourceHash=(Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash
New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
$fixturePath=Join-Path $evidenceRoot 'source.json'
Copy-Item -LiteralPath $sourceFile -Destination $fixturePath
$health=Invoke-RestMethod -Uri ($BaseUrl.TrimEnd('/')+'/api/health')
if ($health.status -ne 'ok' -or $health.schema_version -ne 'process-governance-v8' -or $health.release_status -ne 'candidate') { throw 'Expected V8 candidate health.' }
$scenario=Get-Content -Raw -Encoding utf8 -LiteralPath (Join-Path $PSScriptRoot 'workbench-checks-browser-scenario.js')
$scenario=$scenario.Replace('__OUTPUT_DIR__',$evidenceRoot.Replace('\','/')).Replace('__FIXTURE_PATH__',$fixturePath.Replace('\','/')).Replace('__BASE_URL__',$BaseUrl.TrimEnd('/'))
$scenarioPath=Join-Path $evidenceRoot 'scenario.js'
[IO.File]::WriteAllText($scenarioPath,$scenario,[Text.UTF8Encoding]::new($false))
$sessionName="3001-checks-$PID"
try {
  & npx.cmd --yes --package '@playwright/cli' playwright-cli "-s=$sessionName" open about:blank --browser msedge
  if ($LASTEXITCODE -ne 0) { throw 'Edge launch failed.' }
  $scenarioOutput=& npx.cmd --yes --package '@playwright/cli' playwright-cli "-s=$sessionName" run-code --filename $scenarioPath
  $scenarioOutput | Set-Content -LiteralPath (Join-Path $evidenceRoot 'cli-result.log') -Encoding utf8
  $match=[regex]::Match(($scenarioOutput -join "`n"),'(?s)### Result\s*\n(.*?)\n###')
  if (!$match.Success) { throw 'Browser result missing; see cli-result.log.' }
  $result=$match.Groups[1].Value | ConvertFrom-Json
  [IO.File]::WriteAllText((Join-Path $evidenceRoot 'report.json'),($result | ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))
  if (!$result.passed) { Write-Output ($result | ConvertTo-Json -Depth 6); throw 'Workbench checks browser scenario failed.' }
  & node.exe (Join-Path $PSScriptRoot 'verify-workbench-checks-evidence.mjs') $sourceFile $evidenceRoot
  if ($LASTEXITCODE -ne 0) { throw 'Actual downloaded content verification failed.' }
  if ((Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash -ne $sourceHash) { throw 'Source changed.' }
  Write-Output "Edge checks passed $($result.checks.Count) groups. Evidence: $evidenceRoot"
} finally {
  & npx.cmd --yes --package '@playwright/cli' playwright-cli "-s=$sessionName" close 2>$null | Out-Null
}
