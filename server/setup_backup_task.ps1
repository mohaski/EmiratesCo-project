# One-time setup: registers the "EmiratesCo DB Backup" scheduled task to run
# as SYSTEM (no password needed) so it works even though this PC is fully
# shut down overnight. Triggers at startup (2-minute delay for Postgres/network
# to come up) and also at 23:30 as a bonus if the PC is ever left on.
#
# Must be run from an elevated (Run as Administrator) PowerShell window:
#   powershell -ExecutionPolicy Bypass -File "c:\Users\mohas\Desktop\EmiratesCo project\server\setup_backup_task.ps1"

$ErrorActionPreference = "Stop"

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "This script must be run as Administrator. Right-click PowerShell/Terminal and choose 'Run as administrator', then re-run this script."
    exit 1
}

$existing = Get-ScheduledTask -TaskName "EmiratesCo DB Backup" -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName "EmiratesCo DB Backup" -Confirm:$false
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument '-ExecutionPolicy Bypass -File "c:\Users\mohas\Desktop\EmiratesCo project\server\backup_db.ps1"' `
    -WorkingDirectory "c:\Users\mohas\Desktop\EmiratesCo project\server"

$triggerStartup = New-ScheduledTaskTrigger -AtStartup
$triggerStartup.Delay = "PT2M"

$triggerDaily = New-ScheduledTaskTrigger -Daily -At 23:30

$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -DontStopOnIdleEnd `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName "EmiratesCo DB Backup" `
    -Action $action -Trigger @($triggerStartup, $triggerDaily) `
    -Principal $principal -Settings $settings `
    -Description "Nightly local + S3 off-site backup of the EmiratesCo database. Runs as SYSTEM so it works even though the PC is off overnight; fires at next startup instead." | Out-Null

Write-Host "[OK] Task registered. Verifying..." -ForegroundColor Green
Get-ScheduledTask -TaskName "EmiratesCo DB Backup" | Select-Object TaskName, State
(Get-ScheduledTask -TaskName "EmiratesCo DB Backup").Principal | Format-List UserId, LogonType, RunLevel
(Get-ScheduledTask -TaskName "EmiratesCo DB Backup").Triggers | Format-Table -AutoSize
