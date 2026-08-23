# Nightly local + off-site (S3) backup for the on-prem EmiratesCo database.
# Runs as SYSTEM via Windows Task Scheduler ("EmiratesCo DB Backup"), triggered
# at startup (the shop PC is off overnight) and also at 23:30 as a bonus catch
# if the PC is ever left on. SYSTEM has its own profile, so AWS credentials are
# pointed at by absolute path below rather than relying on %USERPROFILE%.

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile = Join-Path $ScriptDir ".env"
$BackupDir = Join-Path $ScriptDir "backups"
$RetentionDays = 14
$LogFile = Join-Path $ScriptDir "backup.log"
$S3Bucket = "emiratesco-db-backups"
$AwsProfile = "emiratesco-backup"

$env:AWS_SHARED_CREDENTIALS_FILE = "C:\Users\mohas\.aws\credentials"
$env:AWS_CONFIG_FILE = "C:\Users\mohas\.aws\config"

# Absolute paths: PATH differs between the interactive user and SYSTEM, so a
# bare "pg_dump"/"aws" lookup that works when tested manually can silently
# fail when Task Scheduler runs this as SYSTEM.
$PgDumpExe = "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe"
$AwsExe = "C:\Program Files\Amazon\AWSCLIV2\aws.exe"

function Write-Log {
    param([string]$Message)
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
    Add-Content -Path $LogFile -Value $line
    Write-Host $line
}

function Send-FailureAlert {
    param([string]$ErrorDetail)
    try {
        $smtpHost = $envVars["SMTP_HOST"]
        $smtpPort = [int]$envVars["SMTP_PORT"]
        $smtpUser = $envVars["SMTP_USERNAME"]
        $smtpPass = $envVars["SMTP_PASSWORD"]
        if (-not $smtpUser) { Write-Log "[WARN] No SMTP_USERNAME configured, skipping failure email."; return }

        $msg = New-Object System.Net.Mail.MailMessage
        $msg.From = $smtpUser
        $msg.To.Add($smtpUser)
        $msg.Subject = "EmiratesCo DB Backup FAILED - $(Get-Date -Format 'yyyy-MM-dd')"
        $msg.Body = "The nightly database backup failed.`n`n$ErrorDetail`n`nSee $LogFile on the server for full details."

        $smtp = New-Object System.Net.Mail.SmtpClient($smtpHost, $smtpPort)
        $smtp.EnableSsl = $true
        $smtp.Credentials = New-Object System.Net.NetworkCredential($smtpUser, $smtpPass)
        $smtp.Send($msg)
        Write-Log "[OK] Failure alert email sent to $smtpUser."
    } catch {
        Write-Log "[WARN] Could not send failure alert email: $_"
    }
}

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

try {
    $env:PGPASSWORD = $DbPassword
    try {
        & $PgDumpExe -h $DbHost -p $DbPort -U $DbUser -F c -f $outFile $DbName
        if ($LASTEXITCODE -ne 0) {
            throw "pg_dump exited with code $LASTEXITCODE"
        }
    } finally {
        Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    }
    Write-Log "[OK] Local backup written to $outFile"
} catch {
    Write-Log "[FAIL] pg_dump failed: $_"
    Send-FailureAlert "pg_dump step failed: $_"
    exit 1
}

try {
    $s3Key = "backups/$(Split-Path -Leaf $outFile)"
    & $AwsExe s3 cp $outFile "s3://$S3Bucket/$s3Key" --profile $AwsProfile
    if ($LASTEXITCODE -ne 0) {
        throw "aws s3 cp exited with code $LASTEXITCODE"
    }
    Write-Log "[OK] Uploaded to s3://$S3Bucket/$s3Key"
} catch {
    Write-Log "[FAIL] S3 upload failed: $_"
    Send-FailureAlert "Local backup succeeded ($outFile) but the off-site S3 upload failed: $_"
    exit 1
}

# Prune local copies older than $RetentionDays — off-site copies in S3 are kept
# far longer under the bucket's lifecycle policy, so this only trims local disk usage.
Get-ChildItem $BackupDir -Filter "*.dump" |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) } |
    Remove-Item -Force

Write-Log "[OK] Pruned local backups older than $RetentionDays days."
