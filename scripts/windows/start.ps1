# Starts FleetOS on Windows. -Demo adds 10 simulated vehicles.
#   powershell -ExecutionPolicy Bypass -File scripts\windows\start.ps1 -Demo
param([switch]$Demo)
$ErrorActionPreference = 'Stop'
$Root = Resolve-Path "$PSScriptRoot\..\.."
$Bin = Join-Path $Root 'server\bin'

foreach ($line in Get-Content (Join-Path $Root '.env')) {
  if ($line -match '^\s*([^#=]+)=(.*)$') { Set-Item "Env:$($Matches[1].Trim())" $Matches[2] }
}
$env:WEB_DIR = Join-Path $Root 'web\dist'

$procs = @(Start-Process (Join-Path $Bin 'fleetd.exe') -NoNewWindow -PassThru)
Start-Sleep 2
if ($Demo) {
  $procs += Start-Process (Join-Path $Bin 'simulator.exe') -ArgumentList '-devices', '10', '-interval', '3s' -NoNewWindow -PassThru
}

Write-Host ''
Write-Host 'FleetOS is running: http://localhost:8080   (Ctrl+C to stop)'
Start-Process 'http://localhost:8080'
try {
  Wait-Process -Id $procs[0].Id
} finally {
  $procs | Where-Object { -not $_.HasExited } | Stop-Process -Force
}
