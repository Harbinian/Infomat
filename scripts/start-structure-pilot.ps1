param()

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$assistantDir = Join-Path $repoRoot "apps\structure-assistant"
$configPath = Join-Path $assistantDir "config\pilot.config.json"
$localEnvPath = Join-Path $PSScriptRoot "structure-pilot.local.env"
$config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
$logDir = Join-Path $env:TEMP "infomat-structure-pilot"

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
    if (
      $value.Length -ge 2 -and
      (($value.StartsWith('"') -and $value.EndsWith('"')) -or
       ($value.StartsWith("'") -and $value.EndsWith("'")))
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    if ($name) { Set-Item -Path "Env:$name" -Value $value }
  }
}

function Require-Env {
  param([string]$Name)
  $value = [Environment]::GetEnvironmentVariable($Name, "Process")
  if (-not $value) {
    throw "Missing $Name. Set it in scripts\structure-pilot.local.env before starting the pilot."
  }
  return $value
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
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $task = $client.ConnectAsync($HostName, $Port)
    return $task.Wait(1500) -and $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
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

Import-LocalEnvFile -Path $localEnvPath

$gitStatus = & git -C $repoRoot status --porcelain --untracked-files=all
if ($LASTEXITCODE -ne 0) { throw "Cannot read the Infomat Git worktree." }
if ($gitStatus) {
  throw "The Infomat worktree is not clean. Commit and review the release before starting the pilot."
}

Require-Env -Name "STRUCTURE_ASSISTANT_SESSION_SECRET" | Out-Null
Require-Env -Name "STRUCTURE_ASSISTANT_TLS_CERT_PATH" | Out-Null
Require-Env -Name "STRUCTURE_ASSISTANT_TLS_KEY_PATH" | Out-Null
foreach ($account in $config.accounts) {
  Require-Env -Name ([string]$account.passwordHashEnv) | Out-Null
  Require-Env -Name ([string]$account.apiKeyEnv) | Out-Null
}

$certPath = Resolve-Path -LiteralPath (Require-Env -Name "STRUCTURE_ASSISTANT_TLS_CERT_PATH")
$keyPath = Resolve-Path -LiteralPath (Require-Env -Name "STRUCTURE_ASSISTANT_TLS_KEY_PATH")
$env:STRUCTURE_ASSISTANT_TLS_CERT_PATH = [string]$certPath
$env:STRUCTURE_ASSISTANT_TLS_KEY_PATH = [string]$keyPath
$env:STRUCTURE_ASSISTANT_HOST = [string]$config.assistant.host
$env:STRUCTURE_ASSISTANT_PORT = [string]$config.assistant.port
$env:STRUCTURE_ASSISTANT_GATEWAY_PORT = [string]$config.assistant.gatewayPort
$env:STRUCTURED_TOOL_BASE_URL = [string]$config.assistant.structuredToolBaseUrl
$env:STRUCTURE_ASSISTANT_ALLOW_HTTP = "0"
$env:STRUCTURE_ASSISTANT_ALLOW_DIRTY = "0"

Invoke-CheckedNpm -Name "3001 structure rules tests" -Arguments @("--prefix", "apps/structured-output-service", "test")
Invoke-CheckedNpm -Name "structure assistant tests" -Arguments @("--prefix", "apps/structure-assistant", "test")
Invoke-CheckedNpm -Name "structure pilot fixed-config tests" -Arguments @("run", "test:structure-pilot-config")

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$structuredPort = [int]([uri]$config.assistant.structuredToolBaseUrl).Port
$assistantPort = [int]$config.assistant.port
$gatewayPort = [int]$config.assistant.gatewayPort

Stop-Listener -Port $assistantPort -Name "structure assistant"
Stop-Listener -Port $gatewayPort -Name "structured tool gateway"

Wait-Tcp -HostName "127.0.0.1" -Port $structuredPort -Name "independent 3001 LAN service"

Start-Process -FilePath "npm.cmd" `
  -ArgumentList "start" `
  -WorkingDirectory $assistantDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logDir "structure-assistant.out.log") `
  -RedirectStandardError (Join-Path $logDir "structure-assistant.err.log")

Wait-Tcp -HostName "127.0.0.1" -Port $assistantPort -Name "structure assistant"
Wait-Tcp -HostName "127.0.0.1" -Port $gatewayPort -Name "structured tool gateway"

$commit = (& git -C $repoRoot rev-parse HEAD).Trim()
Write-Host "Infomat commit: $commit"
Write-Host "Structure assistant: HTTPS port $assistantPort"
Write-Host "Authenticated structured tool gateway: HTTPS port $gatewayPort"
Write-Host "Independent 3001 LAN service unchanged: $($config.assistant.structuredToolBaseUrl)"
Write-Host "Logs: $logDir"
