param(
  [int]$Port = 0,
  [switch]$Headed
)

$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$scenarioPath = Join-Path $appRoot 'scripts/multi-candidate-atomic-browser-scenario.js'
$sessionName = "infomat-multi-candidate-atomic-$PID"
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$npxCommand = Get-Command npx.cmd -ErrorAction SilentlyContinue

if (-not $nodeCommand) {
  throw 'node.exe was not found. Install Node.js before running this script.'
}
if (-not $npxCommand) {
  throw 'npx.cmd was not found. Install Node.js/npm before running this script.'
}
if (-not (Test-Path -LiteralPath $scenarioPath -PathType Leaf)) {
  throw "Browser scenario was not found: $scenarioPath"
}
if ($Port -lt 0 -or $Port -gt 65535 -or ($Port -gt 0 -and $Port -lt 1024)) {
  throw 'Port must be 0 for an automatically allocated loopback port, or an integer from 1024 through 65535.'
}

if ($Port -eq 0) {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  try {
    $listener.Start()
    $Port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  } finally {
    $listener.Stop()
  }
}

$baseUrl = "http://127.0.0.1:$Port"
$systemTempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$runTempRoot = Join-Path $systemTempRoot ("infomat-multi-candidate-atomic-$PID-" + [guid]::NewGuid().ToString('N'))
$runTempRoot = [System.IO.Path]::GetFullPath($runTempRoot)
if (-not $runTempRoot.StartsWith($systemTempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Resolved test directory is outside the system temporary directory: $runTempRoot"
}
New-Item -ItemType Directory -Path $runTempRoot | Out-Null

$stdoutPath = Join-Path $runTempRoot 'structured-output.stdout.log'
$stderrPath = Join-Path $runTempRoot 'structured-output.stderr.log'
$serverProcess = $null
$previousPortExists = Test-Path Env:STRUCTURED_OUTPUT_PORT
$previousHostExists = Test-Path Env:STRUCTURED_OUTPUT_HOST
$previousPort = $env:STRUCTURED_OUTPUT_PORT
$previousStructuredHost = $env:STRUCTURED_OUTPUT_HOST

try {
  $env:STRUCTURED_OUTPUT_PORT = [string]$Port
  $env:STRUCTURED_OUTPUT_HOST = '127.0.0.1'
  try {
    $serverProcess = Start-Process `
      -FilePath $nodeCommand.Source `
      -ArgumentList @('server.js') `
      -WorkingDirectory $appRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath `
      -PassThru
  } finally {
    if ($previousPortExists) { $env:STRUCTURED_OUTPUT_PORT = $previousPort }
    else { Remove-Item Env:STRUCTURED_OUTPUT_PORT -ErrorAction SilentlyContinue }
    if ($previousHostExists) { $env:STRUCTURED_OUTPUT_HOST = $previousStructuredHost }
    else { Remove-Item Env:STRUCTURED_OUTPUT_HOST -ErrorAction SilentlyContinue }
  }

  $health = $null
  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($serverProcess.HasExited) {
      $stderrText = if (Test-Path -LiteralPath $stderrPath) { Get-Content -Raw -LiteralPath $stderrPath } else { '' }
      throw "Independent 3001 process exited before health became ready. Exit code: $($serverProcess.ExitCode). Error: $stderrText"
    }
    try {
      $health = Invoke-RestMethod -Uri "$baseUrl/api/health" -Method Get -TimeoutSec 2
      if ($health.status -eq 'ok') { break }
    } catch {
      $health = $null
    }
    Start-Sleep -Milliseconds 200
  }

  if (-not $health) {
    throw "Independent 3001 did not become healthy within 20 seconds at $baseUrl."
  }
  if ($health.status -ne 'ok' -or $health.schema_version -ne 'process-governance-v7' -or $health.release_status -ne 'released') {
    throw "Independent 3001 health response is unexpected: $($health | ConvertTo-Json -Compress)"
  }

  Push-Location $runTempRoot
  try {
    $openArguments = @('--yes', '--package', '@playwright/cli', 'playwright-cli', "-s=$sessionName", 'open', $baseUrl)
    if ($Headed) { $openArguments += '--headed' }
    & $npxCommand.Source @openArguments
    if ($LASTEXITCODE -ne 0) {
      throw "Playwright CLI failed to open the independent 3001 page. Exit code: $LASTEXITCODE"
    }

    & $npxCommand.Source --yes --package '@playwright/cli' playwright-cli "-s=$sessionName" run-code --filename $scenarioPath
    if ($LASTEXITCODE -ne 0) {
      throw "Multi-candidate atomic browser regression failed. Exit code: $LASTEXITCODE"
    }
  } finally {
    & $npxCommand.Source --yes --package '@playwright/cli' playwright-cli "-s=$sessionName" close 2>$null | Out-Null
    Pop-Location
  }
} finally {
  if ($serverProcess -and -not $serverProcess.HasExited) {
    Stop-Process -Id $serverProcess.Id -Force
    $serverProcess.WaitForExit()
  }
  if (Test-Path -LiteralPath $runTempRoot) {
    $resolvedCleanupRoot = [System.IO.Path]::GetFullPath((Get-Item -LiteralPath $runTempRoot).FullName)
    if (-not $resolvedCleanupRoot.StartsWith($systemTempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove a test directory outside the system temporary directory: $resolvedCleanupRoot"
    }
    Remove-Item -LiteralPath $resolvedCleanupRoot -Recurse -Force
  }
}

Write-Host '3001 multi-candidate atomic browser regression passed.'
