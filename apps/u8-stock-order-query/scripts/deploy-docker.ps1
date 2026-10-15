# Builds and validates this service before switching its owned 3088 listener.
# Input: existing Windows user credential; output: image/health records and Docker logs.
# Only this service and its temporary candidate container are changed; no database writes.
$ErrorActionPreference='Stop'
$taskAppRoot=Split-Path -Parent $PSScriptRoot
$taskRepoRoot=Split-Path -Parent (Split-Path -Parent $taskAppRoot)
$taskRuntime=Join-Path $taskRepoRoot 'artifacts/u8-stock-order-docker-runtime-3088'
$taskCompose=Join-Path $taskAppRoot 'compose.yaml'
$taskContainer='infomat-u8-stock-order-query-3088'
$taskCandidate='infomat-u8-stock-order-query-candidate-3099'
$taskDocker=(Get-Command docker.exe -ErrorAction Stop).Source
New-Item -ItemType Directory -Path $taskRuntime -Force|Out-Null
$taskStep=0
function Invoke-TaskDocker([string[]]$Arguments,[int]$TimeoutSeconds=60){
 $script:taskStep++
 $taskStdout=Join-Path $taskRuntime ('docker-'+$script:taskStep+'-stdout.log')
 $taskStderr=Join-Path $taskRuntime ('docker-'+$script:taskStep+'-stderr.log')
 $taskQuoted=($Arguments|ForEach-Object{'"'+$_.Replace('"','\"')+'"'}) -join ' '
 $taskProcess=Start-Process -FilePath $taskDocker -ArgumentList $taskQuoted -WindowStyle Hidden -PassThru -RedirectStandardOutput $taskStdout -RedirectStandardError $taskStderr
 # Retain the handle so Windows PowerShell can read the exit code after a fast command.
 $taskProcessHandle=$taskProcess.Handle
 if(-not $taskProcess.WaitForExit($TimeoutSeconds*1000)){$taskProcess.Kill();throw 'Docker command timed out; the Docker engine and other containers were not restarted.'}
 $taskProcess.Refresh()
 if($taskProcess.ExitCode -ne 0){throw ('Docker command failed. Review '+$taskStderr)}
 return [IO.File]::ReadAllText($taskStdout).Trim()
}
function Assert-TaskContainer([string]$Name){
 $taskId=Invoke-TaskDocker @('ps','-a','--filter',('name=^'+$Name+'$'),'--format','{{.ID}}')
 if($taskId){
  $taskLabel=Invoke-TaskDocker @('inspect','--format','{{index .Config.Labels "com.infomat.service"}}',$Name)
  if($taskLabel -ne 'u8-stock-order-query'){throw 'Container name belongs to another service.'}
 }
 return $taskId
}
[void](Invoke-TaskDocker @('version','--format','{{.Server.Version}}') 15)
[void](Assert-TaskContainer $taskContainer)
if(Assert-TaskContainer $taskCandidate){throw 'A prior candidate exists; review it before another deployment.'}
if(Get-NetTCPConnection -LocalPort 3099 -State Listen -ErrorAction SilentlyContinue){throw 'Candidate port 3099 is occupied.'}
$taskSecretResult=& (Join-Path $PSScriptRoot 'prepare-docker-secret.ps1') |ConvertFrom-Json
$taskFiles=@('Dockerfile','package.json','package-lock.json','server.mjs','database.mjs','query.mjs','fields.mjs','access.mjs')|ForEach-Object{Join-Path $taskAppRoot $_}
$taskFiles+=@(Get-ChildItem -LiteralPath (Join-Path $taskAppRoot 'sql'),(Join-Path $taskAppRoot 'public') -File -Recurse|ForEach-Object{$_.FullName})
$taskManifest=@($taskFiles|Sort-Object|ForEach-Object{[ordered]@{path=$_.Substring($taskAppRoot.Length+1);sha256=(Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash}})
$taskHashText=($taskManifest|ConvertTo-Json -Compress)
$taskSha=[Security.Cryptography.SHA256]::Create()
$taskDigest=([BitConverter]::ToString($taskSha.ComputeHash([Text.Encoding]::UTF8.GetBytes($taskHashText)))).Replace('-','').ToLowerInvariant()
$taskImage='infomat-u8-stock-order-query:quality-uniqueness-20261015-'+$taskDigest.Substring(0,12)
$taskManifest|ConvertTo-Json -Depth 4|Set-Content (Join-Path $taskRuntime 'source-manifest.json') -Encoding UTF8
Write-Output ('Building reviewed service image '+$taskImage)
[void](Invoke-TaskDocker @('build','-t',$taskImage,$taskAppRoot) 600)
$taskOldEnv=@{}
foreach($taskKey in @('U8_QUERY_IMAGE','U8_SQL_PASSWORD_FILE','U8_PUBLIC_PORT','U8_CONTAINER_NAME','U8_COMPOSE_PROJECT','U8_BIND_IP')){$taskOldEnv[$taskKey]=[Environment]::GetEnvironmentVariable($taskKey,'Process')}
$taskPreviousImage=$null;$taskPreviousBindIp=$null;$taskWindowsStopped=$false;$taskCandidateStarted=$false;$taskFinalStarted=$false
try{
 $env:U8_QUERY_IMAGE=$taskImage;$env:U8_SQL_PASSWORD_FILE=$taskSecretResult.passwordFile
 $env:U8_PUBLIC_PORT='3099';$env:U8_CONTAINER_NAME=$taskCandidate;$env:U8_COMPOSE_PROJECT='infomat-u8-stock-order-query-candidate';$env:U8_BIND_IP='127.0.0.1'
 $taskCandidateStarted=$true
 [void](Invoke-TaskDocker @('compose','-f',$taskCompose,'up','-d','--wait','--wait-timeout','60') 100)
 $taskCandidateHealth=Invoke-RestMethod 'http://127.0.0.1:3099/api/health' -TimeoutSec 15
 $taskAlerts=Invoke-RestMethod 'http://127.0.0.1:3099/api/quality-alerts' -TimeoutSec 15
 if(-not $taskCandidateHealth.ok -or $taskCandidateHealth.databaseUser -ne 'va2' -or $taskCandidateHealth.timeZone -ne 'UTC+8' -or -not $taskAlerts.ok){throw 'Candidate database/alert contract failed.'}
 $taskCandidateQuality=Invoke-RestMethod 'http://127.0.0.1:3099/api/quality-uniqueness?pageSize=1' -TimeoutSec 15
 if(-not $taskCandidateQuality.ok -or $taskCandidateQuality.meta.source -ne 'dbo.SO_SODetails'){throw 'Candidate uniqueness contract failed.'}
 if($taskCandidateQuality.rows.Count){
  $taskGroup=$taskCandidateQuality.rows[0]
  $taskDetailUrl='http://127.0.0.1:3099/api/quality-uniqueness/details?drawing='+[Uri]::EscapeDataString([string]$taskGroup.ProductDrawing)+'&qualityNumber='+[Uri]::EscapeDataString([string]$taskGroup.QualityNumber)+'&pageSize=1'
  $taskSourceDetails=Invoke-RestMethod $taskDetailUrl -TimeoutSec 15
  if(-not $taskSourceDetails.ok -or $taskSourceDetails.total -ne $taskGroup.SourceDetailCount){throw 'Candidate source detail count did not reconcile.'}
 }
 if(Assert-TaskContainer $taskContainer){
  $taskPreviousImage=Invoke-TaskDocker @('inspect','--format','{{.Image}}',$taskContainer)
  $taskPreviousBindIp=Invoke-TaskDocker @('inspect','--format','{{(index (index .HostConfig.PortBindings "3088/tcp") 0).HostIp}}',$taskContainer)
 }
 else{
  $taskListener=Get-NetTCPConnection -LocalPort 3088 -State Listen -ErrorAction SilentlyContinue
  if($taskListener){
   $taskRecord=Get-Content (Join-Path $taskRepoRoot 'artifacts/u8-stock-order-query-runtime-3088/process.json') -Raw|ConvertFrom-Json
   if($taskListener.OwningProcess -ne $taskRecord.pid){throw 'Port 3088 belongs to another process.'}
   & (Join-Path $PSScriptRoot 'stop.ps1') -Port 3088
   $taskWindowsStopped=$true
  }
 }
 $env:U8_PUBLIC_PORT='3088';$env:U8_CONTAINER_NAME=$taskContainer;$env:U8_COMPOSE_PROJECT='infomat-u8-stock-order-query';$env:U8_BIND_IP='0.0.0.0'
 $taskFinalStarted=$true
 [void](Invoke-TaskDocker @('compose','-f',$taskCompose,'up','-d','--wait','--wait-timeout','60') 100)
 $taskHealth=Invoke-RestMethod 'http://127.0.0.1:3088/api/health' -TimeoutSec 15
 $taskFinalAlerts=Invoke-RestMethod 'http://127.0.0.1:3088/api/quality-alerts' -TimeoutSec 15
 if(-not $taskHealth.ok -or $taskHealth.databaseUser -ne 'va2' -or $taskHealth.timeZone -ne 'UTC+8' -or -not $taskFinalAlerts.ok){throw 'Final database/alert contract failed.'}
 $taskFinalQuality=Invoke-RestMethod 'http://127.0.0.1:3088/api/quality-uniqueness?pageSize=1' -TimeoutSec 15
 if(-not $taskFinalQuality.ok -or $taskFinalQuality.meta.source -ne 'dbo.SO_SODetails'){throw 'Final uniqueness contract failed.'}
 $taskImageId=Invoke-TaskDocker @('inspect','--format','{{.Image}}',$taskContainer)
 $taskResult=@{status='ready';container=$taskContainer;image=$taskImage;imageId=$taskImageId;previousImage=$taskPreviousImage;previousBindIp=$taskPreviousBindIp;bindIp='0.0.0.0';url='http://127.0.0.1:3088';health=$taskHealth;qualityDifferences=$taskFinalAlerts.total;checkedAtUtc8=$taskFinalAlerts.checkedAtUtc8}
 $taskResult|ConvertTo-Json -Depth 5|Set-Content (Join-Path $taskRuntime 'deployment.json') -Encoding UTF8
 $taskResult|ConvertTo-Json -Depth 5
}catch{
 if($taskFinalStarted){
  $env:U8_PUBLIC_PORT='3088';$env:U8_CONTAINER_NAME=$taskContainer;$env:U8_COMPOSE_PROJECT='infomat-u8-stock-order-query'
  if($taskPreviousImage){$env:U8_QUERY_IMAGE=$taskPreviousImage;$env:U8_BIND_IP=$taskPreviousBindIp;[void](Invoke-TaskDocker @('compose','-f',$taskCompose,'up','-d','--wait','--wait-timeout','60') 100)}
  else{[void](Invoke-TaskDocker @('compose','-f',$taskCompose,'down') 60)}
 }
 if($taskWindowsStopped){& (Join-Path $PSScriptRoot 'start.ps1') -Port 3088|Out-Null}
 throw
}finally{
 if($taskCandidateStarted){
  $env:U8_PUBLIC_PORT='3099';$env:U8_CONTAINER_NAME=$taskCandidate;$env:U8_COMPOSE_PROJECT='infomat-u8-stock-order-query-candidate'
  [void](Invoke-TaskDocker @('compose','-f',$taskCompose,'down') 60)
 }
 foreach($taskKey in $taskOldEnv.Keys){[Environment]::SetEnvironmentVariable($taskKey,$taskOldEnv[$taskKey],'Process')}
}
