# Starts FleetOS on Windows. -Demo adds 10 simulated vehicles.
#   powershell -ExecutionPolicy Bypass -File scripts\windows\start.ps1 -Demo
# Ports come from .env: HTTP_ADDR (default :8080), TELTONIKA_ADDR (default :5027).
param([switch]$Demo)
$ErrorActionPreference = 'Stop'
$Root = Resolve-Path "$PSScriptRoot\..\.."
$Bin = Join-Path $Root 'server\bin'

foreach ($line in Get-Content (Join-Path $Root '.env')) {
  if ($line -match '^\s*([^#=]+)=(.*)$') { Set-Item "Env:$($Matches[1].Trim())" $Matches[2] }
}
$env:WEB_DIR = Join-Path $Root 'web\dist'
if (-not $env:HTTP_ADDR) { $env:HTTP_ADDR = ':8080' }
if (-not $env:TELTONIKA_ADDR) { $env:TELTONIKA_ADDR = ':5027' }
$HttpPort = [int]($env:HTTP_ADDR -split ':')[-1]
$GpsPort = [int]($env:TELTONIKA_ADDR -split ':')[-1]

# Fail early with a useful message if another program holds one of our ports.
foreach ($port in $HttpPort, $GpsPort) {
  $owner = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $owner) {
    $owner = Get-NetUDPEndpoint -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
  }
  if ($owner) {
    $name = (Get-Process -Id $owner.OwningProcess -ErrorAction SilentlyContinue).ProcessName
    $key = if ($port -eq $HttpPort) { 'HTTP_ADDR' } else { 'TELTONIKA_ADDR' }
    Write-Host "Port $port is already used by '$name' (PID $($owner.OwningProcess))." -ForegroundColor Red
    Write-Host "Close that program, or pick another port by adding a line like  $key=:$($port + 1)  to .env" -ForegroundColor Red
    exit 1
  }
}

$fleetd = Start-Process (Join-Path $Bin 'fleetd.exe') -NoNewWindow -PassThru
$procs = @($fleetd)
Start-Sleep 2
if ($fleetd.HasExited) {
  Write-Host 'fleetd stopped during startup - see the error above.' -ForegroundColor Red
  exit 1
}
if ($Demo) {
  $procs += Start-Process (Join-Path $Bin 'simulator.exe') -NoNewWindow -PassThru `
    -ArgumentList '-devices', '10', '-interval', '3s', '-addr', "localhost:$GpsPort"
}

$url = "http://localhost:$HttpPort"
Write-Host ''
Write-Host "Somtel Fleet is running: $url   (trackers connect to port $GpsPort; Ctrl+C to stop)"
Start-Process $url
try {
  $fleetd.WaitForExit()
} finally {
  $procs | Where-Object { -not $_.HasExited } | Stop-Process -Force
}
