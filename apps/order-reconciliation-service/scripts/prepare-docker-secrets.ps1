# Consumes existing credentials inside this process, writes ACL-restricted local
# Docker secret files, and prints only paths/status. No database connection.
$ErrorActionPreference='Stop'
$appRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$repoRoot=[IO.Path]::GetFullPath((Join-Path $appRoot '../..'))
$privateRoot=Join-Path $repoRoot 'artifacts/order-reconciliation-9998/docker/private'
git -C $repoRoot check-ignore -- $privateRoot | Out-Null
if($LASTEXITCODE -ne 0){throw 'Private runtime path is not ignored'}
$u8Host=[Environment]::GetEnvironmentVariable('SQLSERVER_HOST','User')
$mesHost=[Environment]::GetEnvironmentVariable('CESOFT_DB_SERVER','Machine')
$mesDatabase=[Environment]::GetEnvironmentVariable('CESOFT_DB_DATABASE','Machine')
if($u8Host -ne '192.168.19.222' -or $mesHost -notmatch '^192\.168\.19\.220([,\\:]|$)' -or $mesDatabase -ne 'CXSYSYS'){throw 'Existing source targets do not match the authorized scope'}
$u8Password=[Environment]::GetEnvironmentVariable('SQLSERVER_PASSWORD','User')
$mesUsername=[Environment]::GetEnvironmentVariable('CESOFT_DB_USERNAME','Machine')
$mesPassword=[Environment]::GetEnvironmentVariable('CESOFT_DB_PASSWORD','Machine')
if([string]::IsNullOrEmpty($u8Password) -or [string]::IsNullOrEmpty($mesUsername) -or [string]::IsNullOrEmpty($mesPassword)){throw 'Existing source credentials are unavailable'}
[void][IO.Directory]::CreateDirectory($privateRoot)
$acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetAccessRuleProtection($true,$false)
$userSid=[Security.Principal.WindowsIdentity]::GetCurrent().User
foreach($identity in @($userSid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow))}
[IO.Directory]::SetAccessControl($privateRoot,$acl)
[IO.File]::WriteAllText((Join-Path $privateRoot 'u8-password'),$u8Password,[Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $privateRoot 'mes-username'),$mesUsername,[Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $privateRoot 'mes-password'),$mesPassword,[Text.UTF8Encoding]::new($false))
Remove-Variable u8Password,mesUsername,mesPassword
[pscustomobject]@{prepared=$true;directory=$privateRoot;gitIgnored=$true;aclRestricted=$true}|ConvertTo-Json -Compress
