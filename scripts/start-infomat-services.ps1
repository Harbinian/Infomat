param(
  [int]$MdmPort = 3000,
  [int]$PmoPort = 5173,
  [int]$MysqlPort = 3307,
  [string]$MysqlHost = "127.0.0.1"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$mdmDir = Join-Path $repoRoot "apps\mdm-platform"
$pmoDir = Join-Path $repoRoot "pmo\gantt-react"
$logDir = Join-Path $env:TEMP "infomat-services"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

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

function Test-Mysql {
  param([string]$HostName, [int]$Port)
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $task = $client.ConnectAsync($HostName, $Port)
    if (-not $task.Wait(2000)) { return $false }
    return $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

if (-not (Test-Mysql -HostName $MysqlHost -Port $MysqlPort)) {
  throw "MySQL is not listening on $MysqlHost`:$MysqlPort. Start the project MySQL instance first, or pass -MysqlPort."
}

Stop-Listener -Port $MdmPort -Name "MDM"
Stop-Listener -Port $PmoPort -Name "PMO"

$env:PORT = [string]$MdmPort
$env:MYSQL_HOST = $MysqlHost
$env:MYSQL_PORT = [string]$MysqlPort
$env:ALLOW_INSECURE_SESSION_SECRET = "1"

Start-Process -FilePath "npm.cmd" `
  -ArgumentList "start" `
  -WorkingDirectory $mdmDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logDir "mdm-platform.out.log") `
  -RedirectStandardError (Join-Path $logDir "mdm-platform.err.log")

Start-Process -FilePath "npm.cmd" `
  -ArgumentList "run dev -- --host 127.0.0.1 --port $PmoPort --strictPort" `
  -WorkingDirectory $pmoDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logDir "pmo-gantt.out.log") `
  -RedirectStandardError (Join-Path $logDir "pmo-gantt.err.log")

Start-Sleep -Seconds 4

$mdmReady = Test-PortListening -Port $MdmPort
$pmoReady = Test-PortListening -Port $PmoPort
$mdmStatus = if ($mdmReady) { "ready" } else { "not listening" }
$pmoStatus = if ($pmoReady) { "ready" } else { "not listening" }

Write-Host "MDM: http://localhost:$MdmPort/ $mdmStatus"
Write-Host "PMO: http://127.0.0.1:$PmoPort/ $pmoStatus"
Write-Host "Logs: $logDir"

if (-not $mdmReady -or -not $pmoReady) {
  throw "Not all services started. Check the log directory."
}
