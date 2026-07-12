# Nightly local backup for the on-prem EmiratesCo database.
# Run manually, or wire up to Windows Task Scheduler (see README note below).
#
# Task Scheduler example (run once, as the shop PC's normal user):
#   schtasks /Create /TN "EmiratesCo DB Backup" /SC DAILY /ST 23:30 ^
#     /TR "powershell.exe -ExecutionPolicy Bypass -File \"C:\Users\mohas\Desktop\EmiratesCo project\server\backup_db.ps1\""

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile = Join-Path $ScriptDir ".env"
$BackupDir = Join-Path $ScriptDir "backups"
$RetentionDays = 14

if (-not (Test-Path $EnvFile)) {
    Write-Error ".env not found at $EnvFile"
    exit 1
}

# Minimal .env parser — matches KEY=VALUE lines, ignores comments/blank lines.
$envVars = @{}
Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
    if ($_ -match '^\s*([^=]+?)\s*=\s*(.*)\s*$') {
        $envVars[$matches[1]] = $matches[2]
    }
}

$DbHost = $envVars["DB_HOST"]
$DbPort = $envVars["DB_PORT"]
$DbName = $envVars["DB_NAME"]
$DbUser = $envVars["DB_USER"]
$DbPassword = $envVars["DB_PASSWORD"]

if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir | Out-Null
}

$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$outFile = Join-Path $BackupDir "$DbName`_$timestamp.dump"

$env:PGPASSWORD = $DbPassword
try {
    & pg_dump -h $DbHost -p $DbPort -U $DbUser -F c -f $outFile $DbName
    if ($LASTEXITCODE -ne 0) {
        throw "pg_dump exited with code $LASTEXITCODE"
    }
    Write-Host "[OK] Backup written to $outFile"
} finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

# Prune backups older than $RetentionDays
Get-ChildItem $BackupDir -Filter "*.dump" |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) } |
    Remove-Item -Force

Write-Host "[OK] Pruned backups older than $RetentionDays days."
