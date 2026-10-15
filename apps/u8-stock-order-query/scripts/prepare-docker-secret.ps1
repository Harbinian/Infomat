# Input: existing Windows user credential; output: private ignored password file.
# Never prints credentials and never changes a database or Docker container.
$ErrorActionPreference='Stop'
$taskAppRoot=Split-Path -Parent $PSScriptRoot
$taskRepoRoot=Split-Path -Parent (Split-Path -Parent $taskAppRoot)
$taskPrivate=Join-Path $taskRepoRoot 'artifacts/u8-stock-order-docker-runtime-3088/private'
$taskSecret=Join-Path $taskPrivate 'sqlserver-password'
$taskHost=[Environment]::GetEnvironmentVariable('SQLSERVER_HOST','User')
$taskPassword=[Environment]::GetEnvironmentVariable('SQLSERVER_PASSWORD','User')
if($taskHost -ne '192.168.19.222' -or [string]::IsNullOrEmpty($taskPassword)){throw 'Existing database configuration unavailable.'}
$taskIgnored=git -C $taskRepoRoot check-ignore $taskSecret
if($LASTEXITCODE -ne 0){throw 'Private runtime path must be ignored by Git.'}
New-Item -ItemType Directory -Path $taskPrivate -Force | Out-Null
$taskAcl=[Security.AccessControl.DirectorySecurity]::new()
$taskAcl.SetAccessRuleProtection($true,$false)
$taskSid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$taskRights=[Security.AccessControl.FileSystemRights]::FullControl
$taskInheritance=[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
$taskPropagation=[Security.AccessControl.PropagationFlags]::None
foreach($taskIdentity in @($taskSid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){
 $taskAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($taskIdentity,$taskRights,$taskInheritance,$taskPropagation,[Security.AccessControl.AccessControlType]::Allow))
}
[IO.Directory]::SetAccessControl($taskPrivate,$taskAcl)
[IO.File]::WriteAllText($taskSecret,$taskPassword,[Text.UTF8Encoding]::new($false))
Remove-Variable taskPassword
[pscustomobject]@{status='prepared';passwordFile=$taskSecret;gitIgnored=$true;restrictedAcl=$true}|ConvertTo-Json
