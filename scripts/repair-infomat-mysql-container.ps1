param()

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$configPath = Join-Path $PSScriptRoot "infomat-services.config.json"
$localEnvPath = Join-Path $PSScriptRoot "infomat-services.local.env"
$config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json

$fixedMysqlHost = [string]$config.mysql.host
$fixedMysqlPort = [int]$config.mysql.port
$fixedMysqlUser = [string]$config.mysql.user
$fixedMysqlDatabase = [string]$config.mysql.database
$fixedMysqlContainer = [string]$config.mysql.dockerContainer

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
    throw "Missing $Name. Set it in scripts\infomat-services.local.env or the current shell before repairing Infomat MySQL."
  }
  return $value
}

function Test-Tcp {
  param([string]$HostName, [int]$Port)
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
  return @($inspect | ConvertFrom-Json)[0]
}

function Get-MySqlHostPorts {
  param($Inspect)
  $ports = @()
  foreach ($section in @($Inspect.HostConfig.PortBindings, $Inspect.NetworkSettings.Ports)) {
    if (-not $section) { continue }
    $property = $section.PSObject.Properties | Where-Object { $_.Name -eq "3306/tcp" } | Select-Object -First 1
    if (-not $property) { continue }
    foreach ($binding in @($property.Value)) {
      if ($binding -and $binding.HostPort) { $ports += [int]$binding.HostPort }
    }
  }
  return @($ports | Select-Object -Unique)
}

function Find-SourceMysqlContainers {
  $ids = docker ps -a --format "{{.ID}}"
  if ($LASTEXITCODE -ne 0) { throw "Docker is not available. Start Docker Desktop and retry." }

  $matchesForPort = @()
  foreach ($id in $ids) {
    $inspect = Get-DockerInspect -Container $id
    if (-not $inspect) { continue }
    $image = [string]$inspect.Config.Image
    if ($image -notmatch '(^|/)mysql(:|@|$)') { continue }
    if ((Get-MySqlHostPorts -Inspect $inspect) -notcontains $fixedMysqlPort) { continue }
    $matchesForPort += [PSCustomObject]@{
      Id = [string]$inspect.Id
      ShortId = ([string]$inspect.Id).Substring(0, 12)
      Name = ([string]$inspect.Name).TrimStart("/")
      Status = [string]$inspect.State.Status
    }
  }
  return @($matchesForPort)
}

function Test-ProjectMysql {
  Push-Location $repoRoot
  try {
    $env:MYSQL_HOST = $fixedMysqlHost
    $env:MYSQL_PORT = [string]$fixedMysqlPort
    $env:MYSQL_USER = $fixedMysqlUser
    $env:MYSQL_DATABASE = $fixedMysqlDatabase
    $env:MYSQL_CONNECTION_LIMIT = [string]$config.mysql.connectionLimit
    $probe = @'
const mysql = require('mysql2/promise');

(async () => {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    connectionLimit: 1
  });
  const [[version]] = await pool.query('SELECT VERSION() AS version, DATABASE() AS db');
  const [[tables]] = await pool.query('SELECT COUNT(*) AS tables FROM information_schema.tables WHERE table_schema=DATABASE()');
  await pool.end();
  console.log(JSON.stringify({ mysql: `${process.env.MYSQL_HOST}:${process.env.MYSQL_PORT}`, database: version.db, version: version.version, tables: tables.tables }));
})().catch(error => {
  console.error(JSON.stringify({ code: error.code, message: error.message }));
  process.exit(1);
});
'@
    $probe | node -
    if ($LASTEXITCODE -ne 0) { throw "Project MySQL connection check failed." }
  } finally {
    Pop-Location
  }
}

Import-LocalEnvFile -Path $localEnvPath
Require-Env -Name "MYSQL_PASSWORD" | Out-Null

$target = Get-DockerInspect -Container $fixedMysqlContainer
if ($target) {
  if ([string]$target.State.Status -ne "running") {
    Write-Host "Starting configured MySQL container $fixedMysqlContainer"
    docker start $fixedMysqlContainer | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Configured MySQL container could not be started." }
  }
  Wait-Tcp -HostName $fixedMysqlHost -Port $fixedMysqlPort -Name "MySQL"
  Test-ProjectMysql
  Write-Host "Configured MySQL container is aligned: $fixedMysqlContainer"
  exit 0
}

$sources = @(Find-SourceMysqlContainers)
if ($sources.Count -eq 0) {
  throw "No historical MySQL container with host port $fixedMysqlPort was found. Restore the project MySQL container or create it intentionally before retrying."
}
if ($sources.Count -gt 1) {
  $ids = ($sources | ForEach-Object { $_.ShortId }) -join ", "
  throw "Multiple MySQL containers expose host port $fixedMysqlPort ($ids). Stop and remove unrelated containers before retrying."
}

$source = $sources[0]
if ($source.Status -ne "running") {
  Write-Host "Starting historical MySQL container $($source.ShortId)"
  docker start $source.Id | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Historical MySQL container could not be started." }
}

Wait-Tcp -HostName $fixedMysqlHost -Port $fixedMysqlPort -Name "MySQL"
Test-ProjectMysql

Write-Host "Renaming historical MySQL container $($source.ShortId) to $fixedMysqlContainer"
docker rename $source.Id $fixedMysqlContainer
if ($LASTEXITCODE -ne 0) { throw "Docker container rename failed." }

$renamed = Get-DockerInspect -Container $fixedMysqlContainer
if (-not $renamed) { throw "Configured MySQL container was not found after rename." }
Wait-Tcp -HostName $fixedMysqlHost -Port $fixedMysqlPort -Name "MySQL"
Test-ProjectMysql
Write-Host "Infomat MySQL container repair completed: $fixedMysqlContainer"
