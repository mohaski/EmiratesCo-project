# ─────────────────────────────────────────────────────────────────────────────
# Bootstraps EmiratesCo on a fresh Windows machine: venv, Python deps, .env,
# Postgres database, frontend build, and (optionally) the NSSM service.
#
# Prerequisites this script does NOT install for you — install these first:
#   - Python 3.11+     https://www.python.org/downloads/
#   - Node.js 20+       https://nodejs.org/
#   - PostgreSQL 17     https://www.postgresql.org/download/windows/
#   - NSSM              https://nssm.cc/download (unzip win64\nssm.exe to C:\nssm\win64\nssm.exe)
#
# Getting the code onto the new machine (do this first):
#   git clone https://github.com/mohaski/EmiratesCo-project.git "EmiratesCo project"
#
# Usage (run as Administrator so the service-install step works):
#   cd "EmiratesCo project\server"
#   .\setup_new_machine.ps1
# ─────────────────────────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"
$ServerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ServerDir
$ClientDir = Join-Path $ProjectRoot "client"

function Write-Step($msg)  { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "[!] $msg" -ForegroundColor Yellow }
function Test-Command($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }

# ── 0. Prerequisite checks ───────────────────────────────────────────────────
Write-Step "Checking prerequisites"

$missing = @()
if (-not (Test-Command "python")) { $missing += "python" }
if (-not (Test-Command "node"))   { $missing += "node" }
if (-not (Test-Command "npm"))    { $missing += "npm" }
if (-not (Test-Command "psql"))   { $missing += "psql (PostgreSQL)" }

if ($missing.Count -gt 0) {
    Write-Warn2 "Missing on PATH: $($missing -join ', ')"
    Write-Warn2 "Install these first (see script header for links), then re-run."
    exit 1
}
Write-Ok "python, node, npm, psql all found on PATH."

$nssmPath = "C:\nssm\win64\nssm.exe"
$hasNssm = Test-Path $nssmPath
if (-not $hasNssm) {
    Write-Warn2 "NSSM not found at $nssmPath — the Windows service step will be skipped."
    Write-Warn2 "Download from https://nssm.cc/download, unzip win64\nssm.exe there, then run install_service.bat manually later."
}

# ── 1. Python venv + dependencies ────────────────────────────────────────────
Write-Step "Setting up Python virtual environment"
$venvPath = Join-Path $ProjectRoot ".venv"
if (-not (Test-Path $venvPath)) {
    python -m venv $venvPath
    Write-Ok "Created venv at $venvPath"
} else {
    Write-Ok "venv already exists at $venvPath"
}

$venvPython = Join-Path $venvPath "Scripts\python.exe"
& $venvPython -m pip install --upgrade pip | Out-Null
& $venvPython -m pip install -r (Join-Path $ServerDir "requirements.txt")
Write-Ok "Python dependencies installed."

# ── 2. .env ───────────────────────────────────────────────────────────────────
Write-Step "Configuring .env"
$envFile = Join-Path $ServerDir ".env"
if (Test-Path $envFile) {
    Write-Ok ".env already exists — leaving it untouched."
} else {
    $dbName = Read-Host "Database name [EmiratesCo_Database]"
    if ([string]::IsNullOrWhiteSpace($dbName)) { $dbName = "EmiratesCo_Database" }

    $dbUser = Read-Host "Postgres user [postgres]"
    if ([string]::IsNullOrWhiteSpace($dbUser)) { $dbUser = "postgres" }

    $dbPasswordSecure = Read-Host "Postgres password for '$dbUser'" -AsSecureString
    $dbPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($dbPasswordSecure))

    if ($dbPassword -match '[:@/]') {
        Write-Warn2 "Password contains :, @ or / — these break the DATABASE_URL connection string."
        Write-Warn2 "Edit .env by hand afterward and URL-encode DATABASE_URL, or use a password without those characters."
    }

    $secretKey = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    $jwtSecret = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))

    @"
DATABASE_URL=postgresql+psycopg2://$dbUser`:$dbPassword@localhost:5432/$dbName
DB_HOST=localhost
DB_PORT=5432
DB_NAME=$dbName
DB_USER=$dbUser
DB_PASSWORD=$dbPassword

DEBUG=False
SECRET_KEY=$secretKey
ENVIRONMENT=production

API_HOST=127.0.0.1
API_PORT=8000

LOG_LEVEL=INFO
CORS_ORIGINS=

JWT_SECRET_KEY=$jwtSecret
JWT_ALGORITHM=HS256
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=480
"@ | Set-Content -Path $envFile -Encoding utf8

    Write-Ok "Wrote $envFile (SECRET_KEY / JWT_SECRET_KEY auto-generated)."
}

# Re-read whatever ended up in .env (freshly written or pre-existing)
$envVars = @{}
Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
    if ($_ -match '^\s*([^=]+?)\s*=\s*(.*)\s*$') { $envVars[$matches[1]] = $matches[2] }
}

# ── 3. Postgres database ─────────────────────────────────────────────────────
Write-Step "Creating Postgres database (if missing)"
$env:PGPASSWORD = $envVars["DB_PASSWORD"]
try {
    $dbExists = & psql -h $envVars["DB_HOST"] -p $envVars["DB_PORT"] -U $envVars["DB_USER"] -tAc `
        "SELECT 1 FROM pg_database WHERE datname='$($envVars["DB_NAME"])'" postgres
    if ($dbExists -eq "1") {
        Write-Ok "Database '$($envVars["DB_NAME"])' already exists."
    } else {
        & psql -h $envVars["DB_HOST"] -p $envVars["DB_PORT"] -U $envVars["DB_USER"] `
            -c "CREATE DATABASE `"$($envVars["DB_NAME"])`"" postgres
        Write-Ok "Created database '$($envVars["DB_NAME"])'."
    }
} finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

# ── 4. Create tables ──────────────────────────────────────────────────────────
Write-Step "Creating tables"
Push-Location $ServerDir
& $venvPython create_tables.py
Pop-Location
Write-Ok "Tables verified/created."

# ── 5. Frontend build ──────────────────────────────────────────────────────────
Write-Step "Building frontend"
Push-Location $ClientDir
npm install
npm run build
Pop-Location
Write-Ok "client/dist built."

# ── 6. Windows service ──────────────────────────────────────────────────────────
if ($hasNssm) {
    Write-Step "Installing Windows service"
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltinRole]::Administrator)
    if (-not $isAdmin) {
        Write-Warn2 "Not running as Administrator — skipping service install. Re-run install_service.bat as Administrator later."
    } else {
        Push-Location $ServerDir
        & .\install_service.bat
        Pop-Location
    }
} else {
    Write-Warn2 "Skipping service install (NSSM not found). Run install_service.bat manually once NSSM is in place."
}

Write-Step "Done"
Write-Host @"

Next steps (manual — see OPERATIONS_MANUAL.md):
  1. Confirm http://127.0.0.1:8000/health returns {"status":"healthy"}
  2. Install the PWA from http://127.0.0.1:8000 in Edge and pin it
  3. Set up nightly backups:
     schtasks /Create /TN "EmiratesCo DB Backup" /SC DAILY /ST 23:30 /TR "powershell.exe -ExecutionPolicy Bypass -File `"$ServerDir\backup_db.ps1`""
  4. Create the shop-worker Windows account, lock down NTFS permissions on this
     folder, configure auto-login if desired (see OPERATIONS_MANUAL.md §5)

"@ -ForegroundColor Cyan
