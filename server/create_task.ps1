$taskName = "EmiratesCo API"
$batFile  = "c:\Users\mohas\Desktop\EmiratesCo project\server\start.bat"

$action  = New-ScheduledTaskAction `
    -Execute "cmd.exe" `
    -Argument "/c `"$batFile`"" `
    -WorkingDirectory "c:\Users\mohas\Desktop\EmiratesCo project\server"

$trigger = New-ScheduledTaskTrigger -AtStartup

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries

$principal = New-ScheduledTaskPrincipal `
    -UserId "SYSTEM" `
    -LogonType ServiceAccount `
    -RunLevel Highest

# Remove existing task if present
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "Starts EmiratesCo FastAPI server on boot"

Write-Host ""
Write-Host " Task '$taskName' created successfully." -ForegroundColor Green
Write-Host " Testing it now..."

Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 3

$state = (Get-ScheduledTask -TaskName $taskName).State
Write-Host " Task state: $state" -ForegroundColor Cyan
Write-Host ""
Write-Host " Check http://localhost:8000/health to confirm FastAPI is running."
