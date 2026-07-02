@echo off
:: ─────────────────────────────────────────────────────────────────────────────
:: Installs EmiratesCo API as a Windows Service using NSSM.
:: Run this ONCE as Administrator after installing NSSM.
:: Download NSSM: https://nssm.cc/download  (unzip, put nssm.exe in C:\nssm\)
:: ─────────────────────────────────────────────────────────────────────────────
title Install EmiratesCo Service
cd /d "%~dp0"

set NSSM=C:\nssm\win64\nssm.exe
set SERVICE_NAME=EmiratesCoAPI
set SERVER_DIR=%~dp0
set PYTHON=

:: Detect Python path (venv takes priority)
if exist "%SERVER_DIR%venv\Scripts\python.exe" (
    set PYTHON=%SERVER_DIR%venv\Scripts\python.exe
) else (
    for /f "delims=" %%i in ('where python') do set PYTHON=%%i
)

echo.
echo  Installing service: %SERVICE_NAME%
echo  Python: %PYTHON%
echo  Directory: %SERVER_DIR%
echo.

:: Remove existing service if present
%NSSM% stop %SERVICE_NAME% 2>nul
%NSSM% remove %SERVICE_NAME% confirm 2>nul

:: Install service
%NSSM% install %SERVICE_NAME% "%PYTHON%" "-m" "uvicorn" "main:app" "--host" "0.0.0.0" "--port" "8000" "--workers" "2"
%NSSM% set %SERVICE_NAME% AppDirectory "%SERVER_DIR%"
%NSSM% set %SERVICE_NAME% DisplayName "EmiratesCo API Server"
%NSSM% set %SERVICE_NAME% Description "FastAPI backend for EmiratesCo Management System"
%NSSM% set %SERVICE_NAME% Start SERVICE_AUTO_START
%NSSM% set %SERVICE_NAME% AppStdout "%SERVER_DIR%logs\service.log"
%NSSM% set %SERVICE_NAME% AppStderr "%SERVER_DIR%logs\service_error.log"
%NSSM% set %SERVICE_NAME% AppRotateFiles 1
%NSSM% set %SERVICE_NAME% AppRotateBytes 10485760

:: Create logs directory
if not exist "%SERVER_DIR%logs" mkdir "%SERVER_DIR%logs"

:: Start the service
%NSSM% start %SERVICE_NAME%

echo.
echo  [OK] Service installed and started.
echo  Manage it with:
echo    nssm start %SERVICE_NAME%
echo    nssm stop %SERVICE_NAME%
echo    nssm restart %SERVICE_NAME%
echo    nssm edit %SERVICE_NAME%
echo.
pause
