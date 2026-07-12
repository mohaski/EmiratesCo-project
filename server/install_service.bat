@echo off
:: ─────────────────────────────────────────────────────────────────────────────
:: Installs EmiratesCo API as a Windows Service using NSSM.
:: Run this ONCE as Administrator after installing NSSM.
:: Download NSSM: https://nssm.cc/download (unzip, put win64\nssm.exe at C:\nssm\win64\nssm.exe)
:: ─────────────────────────────────────────────────────────────────────────────
title Install EmiratesCo Service
cd /d "%~dp0"

set NSSM=C:\nssm\win64\nssm.exe
set SERVICE_NAME=EmiratesCoAPI
set SERVER_DIR=%~dp0
:: %~dp0 always ends with a trailing backslash. Passed quoted to an external
:: .exe (like nssm.exe below), "...\server\" corrupts — a backslash right
:: before a closing quote is parsed as an escaped quote, not the string end,
:: so the literal path gets a stray " appended. Strip it for that use.
set SERVER_DIR_NOSLASH=%SERVER_DIR:~0,-1%
set PYTHON=

:: Detect Python path — project-root .venv first (matches start.bat), then a
:: server-local venv, then fall back to whatever's on PATH.
if exist "%SERVER_DIR%..\.venv\Scripts\python.exe" (
    set PYTHON=%SERVER_DIR%..\.venv\Scripts\python.exe
) else if exist "%SERVER_DIR%venv\Scripts\python.exe" (
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
:: Single worker: the WebSocket broadcast manager (ws/manager.py) keeps
:: connections in an in-process list, not shared across workers — with
:: workers > 1, live-update pushes would miss clients on other workers.
:: 127.0.0.1: this laptop is standalone (no other device needs to reach it).
%NSSM% install %SERVICE_NAME% "%PYTHON%" "-m" "uvicorn" "main:app" "--host" "127.0.0.1" "--port" "8000" "--workers" "1"
%NSSM% set %SERVICE_NAME% AppDirectory "%SERVER_DIR_NOSLASH%"
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
