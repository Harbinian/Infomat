param(
  [int]$MdmPort = 3000,
  [int]$PmoPort = 5173
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$configPath = Join-Path $PSScriptRoot "infomat-services.config.json"
$localEnvPath = Join-Path $PSScriptRoot "infomat-services.local.env"
$config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json

$fixedMdmPort = [int]$config.mdm.port
$fixedPmoPort = [int]$config.pmo.port
$fixedPmoBindHost = [string]$config.pmo.bindHost
if (-not $fixedPmoBindHost) { $fixedPmoBindHost = [string]$config.pmo.host }
$fixedMysqlHost = [string]$config.mysql.host
$fixedMysqlPort = [int]$config.mysql.port
$fixedMysqlUser = [string]$config.mysql.user
$fixedMysqlDatabase = [string]$config.mysql.database
$fixedMysqlConnectionLimit = [string]$config.mysql.connectionLimit
$fixedMysqlContainer = [string]$config.mysql.dockerContainer

if ($MdmPort -ne $fixedMdmPort -or $PmoPort -ne $fixedPmoPort) {
  throw "Infomat service ports are fixed: MDM=$fixedMdmPort, PMO=$fixedPmoPort. Do not pass drifting ports."
}

$mdmDir = Join-Path $repoRoot "apps\mdm-platform"
$pmoDir = Join-Path $repoRoot "pmo\gantt-react"
$logDir = Join-Path $env:TEMP "infomat-services"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Import-LocalEnvFile {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return }
  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $splitAt = $line.IndexOf("=")
    if ($splitAt -le 0) { return }
    $name = $line.Substring(0, $splitAt).Trim()
    $value = $line.Substring($splitAt + 1).Trim()
    if ($name) { Set-Item -Path "Env:$name" -Value $value }
  }
}

function Require-Env {
  param([string]$Name)
  $value = [Environment]::GetEnvironmentVariable($Name, "Process")
  if (-not $value) {
    throw "Missing $Name. Set it in scripts\infomat-services.local.env or the current shell before starting Infomat services."
  }
  return $value
}

function Test-PortListening {
  param([int]$Port)
  return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Stop-Listener {
  param([int]$Port, [string]$Name)
  $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  foreach ($listener in $listeners) {
    $listenerPid = $listener.OwningProcess
    if ($listenerPid -and $listenerPid -ne $PID) {
      Write-Host "Stopping existing $Name process on port $Port, PID $listenerPid"
      Stop-Process -Id $listenerPid -Force
    }
  }
}

function Test-Tcp {
  param([string]$HostName, [int]$Port)
  $addresses = @()
  try {
    $addresses = [System.Net.Dns]::GetHostAddresses($HostName)
  } catch {
    $addresses = @()
  }

  foreach ($address in $addresses) {
    $client = New-Object System.Net.Sockets.TcpClient($address.AddressFamily)
    try {
      $task = $client.ConnectAsync($address, $Port)
      if ($task.Wait(2000) -and $client.Connected) { return $true }
    } catch {
    } finally {
      $client.Dispose()
    }
  }

  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $task = $client.ConnectAsync($HostName, $Port)
    if ($task.Wait(2000) -and $client.Connected) { return $true }
  } catch {
  } finally {
    $client.Dispose()
  }
  return $false
}

function Wait-Tcp {
  param([string]$HostName, [int]$Port, [string]$Name)
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    if (Test-Tcp -HostName $HostName -Port $Port) { return }
    Start-Sleep -Seconds 1
  }
  throw "$Name did not start listening on $HostName`:$Port."
}

function Get-DockerInspect {
  param([string]$Container)
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $inspect = & docker inspect $Container 2>$null
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -ne 0 -or -not $inspect) { return $null }
  return $inspect
}

function Ensure-FixedMysql {
  if (Test-Tcp -HostName $fixedMysqlHost -Port $fixedMysqlPort) { return }

  $inspect = Get-DockerInspect -Container $fixedMysqlContainer
  if (-not $inspect) {
    throw "Fixed MySQL container '$fixedMysqlContainer' was not found. Run scripts\repair-infomat-mysql-container.ps1 to align the local Docker container with scripts\infomat-services.config.json."
  }

  Write-Host "Starting fixed MySQL container $fixedMysqlContainer on $fixedMysqlHost`:$fixedMysqlPort"
  docker start $fixedMysqlContainer | Out-Null
  Wait-Tcp -HostName $fixedMysqlHost -Port $fixedMysqlPort -Name "MySQL"
}

function Invoke-CheckedNpm {
  param([string]$Name, [string[]]$Arguments)
  Push-Location $repoRoot
  try {
    Write-Host "Running $Name"
    & npm.cmd @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "$Name failed with exit code $LASTEXITCODE."
    }
  } finally {
    Pop-Location
  }
}

Import-LocalEnvFile -Path $localEnvPath

$env:PORT = [string]$fixedMdmPort
$env:INFOMAT_MDM_URL = "http://$($config.mdm.host):$fixedMdmPort"
$env:INFOMAT_PMO_URL = "http://$($config.pmo.host):$fixedPmoPort"
$env:MYSQL_HOST = $fixedMysqlHost
$env:MYSQL_PORT = [string]$fixedMysqlPort
$env:MYSQL_USER = $fixedMysqlUser
$env:MYSQL_DATABASE = $fixedMysqlDatabase
$env:MYSQL_CONNECTION_LIMIT = $fixedMysqlConnectionLimit
$env:MDM_IDENTITY_READ_MODEL = [string]$config.readModels.identity
$env:PROCESS_GOVERNANCE_READ_MODEL = [string]$config.readModels.processGovernance
$env:MDM_ADMIN_EMPLOYEE_NO = [string]$config.admin.employeeNo
$env:ALLOW_INSECURE_SESSION_SECRET = [string]$config.session.allowInsecureDevSecret

Require-Env -Name "MYSQL_PASSWORD" | Out-Null
Require-Env -Name "MDM_ADMIN_PASSWORD" | Out-Null

Ensure-FixedMysql
Invoke-CheckedNpm -Name "MDM MySQL schema initialization" -Arguments @("--prefix", "apps/mdm-platform", "run", "init:mysql")
Invoke-CheckedNpm -Name "MDM person identity live schema check" -Arguments @("--prefix", "apps/mdm-platform", "run", "test:person-identity-live-schema")
Invoke-CheckedNpm -Name "MDM admin permission check" -Arguments @("--prefix", "apps/mdm-platform", "run", "test:admin-permission-mysql")

Stop-Listener -Port $fixedMdmPort -Name "MDM"
Stop-Listener -Port $fixedPmoPort -Name "PMO"

Start-Process -FilePath "npm.cmd" `
  -ArgumentList "start" `
  -WorkingDirectory $mdmDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logDir "mdm-platform.out.log") `
  -RedirectStandardError (Join-Path $logDir "mdm-platform.err.log")

Start-Process -FilePath "npm.cmd" `
  -ArgumentList "run dev -- --host $fixedPmoBindHost --port $fixedPmoPort --strictPort" `
  -WorkingDirectory $pmoDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logDir "pmo-gantt.out.log") `
  -RedirectStandardError (Join-Path $logDir "pmo-gantt.err.log")

Wait-Tcp -HostName "127.0.0.1" -Port $fixedMdmPort -Name "MDM"
Wait-Tcp -HostName "127.0.0.1" -Port $fixedPmoPort -Name "PMO"

Write-Host "Fixed MySQL: $fixedMysqlHost`:$fixedMysqlPort / $fixedMysqlDatabase / $fixedMysqlUser"
Write-Host "MDM: http://localhost:$fixedMdmPort/ ready"
Write-Host "PMO: http://127.0.0.1:$fixedPmoPort/ ready, bind $fixedPmoBindHost`:$fixedPmoPort"
Write-Host "Logs: $logDir"
