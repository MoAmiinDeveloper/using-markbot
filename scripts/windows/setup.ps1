# One-time setup of FleetOS on Windows: installs Go, Node.js and PostgreSQL
# with winget, creates the database and builds the server and web UI.
#   powershell -ExecutionPolicy Bypass -File scripts\windows\setup.ps1
$ErrorActionPreference = 'Stop'
$Root = Resolve-Path "$PSScriptRoot\..\.."
$PgSuperPassword = if ($env:PG_SUPERPASSWORD) { $env:PG_SUPERPASSWORD } else { 'postgres' }

function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
              [Environment]::GetEnvironmentVariable('Path', 'User')
}

function Install-IfMissing($command, $wingetId, $extra = @()) {
  if (Get-Command $command -ErrorAction SilentlyContinue) { return }
  Write-Host "==> Installing $wingetId"
  winget install --id $wingetId -e --accept-source-agreements --accept-package-agreements @extra
  Refresh-Path
}

function Find-Psql {
  Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  throw 'winget not found. Install "App Installer" from the Microsoft Store, then re-run.'
}

Install-IfMissing go 'GoLang.Go'
Install-IfMissing node 'OpenJS.NodeJS.LTS'
if (-not (Find-Psql)) {
  Write-Host '==> Installing PostgreSQL 17 (a Windows admin prompt may appear)'
  winget install --id PostgreSQL.PostgreSQL.17 -e --accept-source-agreements --accept-package-agreements `
    --override "--mode unattended --unattendedmodeui minimal --superpassword $PgSuperPassword --serverport 5432"
}
$Psql = Find-Psql
if (-not $Psql) { throw 'PostgreSQL install not found under C:\Program Files\PostgreSQL' }

Write-Host '==> Creating database'
$env:PGPASSWORD = $PgSuperPassword
$hasRole = & $Psql -U postgres -h localhost -tAc "SELECT 1 FROM pg_roles WHERE rolname='fleet'"
if ($LASTEXITCODE -ne 0) {
  throw 'Could not log in to PostgreSQL as "postgres". If it was installed before, set its password: $env:PG_SUPERPASSWORD="..." and re-run.'
}
if ($hasRole -ne '1') { & $Psql -U postgres -h localhost -qc "CREATE ROLE fleet LOGIN PASSWORD 'fleet'" }
$hasDb = & $Psql -U postgres -h localhost -tAc "SELECT 1 FROM pg_database WHERE datname='fleet'"
if ($hasDb -ne '1') { & $Psql -U postgres -h localhost -qc "CREATE DATABASE fleet OWNER fleet" }
Remove-Item Env:PGPASSWORD

$EnvFile = Join-Path $Root '.env'
if (-not (Test-Path $EnvFile)) {
  Write-Host '==> Writing .env (change ADMIN_PASSWORD here)'
  $secret = -join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
  @("JWT_SECRET=$secret", 'ADMIN_EMAIL=admin@fleet.local', 'ADMIN_PASSWORD=admin', 'AUTO_REGISTER=true') |
    Set-Content -Encoding ascii $EnvFile
}

Write-Host '==> Building web UI'
Push-Location (Join-Path $Root 'web')
npm ci --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
npm run build; if ($LASTEXITCODE -ne 0) { throw 'web build failed' }
Pop-Location

Write-Host '==> Building server'
Push-Location (Join-Path $Root 'server')
go build -o bin\fleetd.exe .\cmd\fleetd; if ($LASTEXITCODE -ne 0) { throw 'server build failed' }
go build -o bin\simulator.exe .\cmd\simulator; if ($LASTEXITCODE -ne 0) { throw 'simulator build failed' }
Pop-Location

Write-Host ''
Write-Host 'Done. Start with:  powershell -ExecutionPolicy Bypass -File scripts\windows\start.ps1 -Demo'
