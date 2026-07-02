@echo off
title EmiratesCo API Server
cd /d "%~dp0"

echo.
echo  ==========================================
echo   EmiratesCo API Server
echo  ==========================================
echo.

:: Locate venv — check project-root .venv first, then local venv fallback
if exist "..\\.venv\Scripts\activate.bat" (
    echo [*] Activating virtual environment (.venv)...
    call "..\\.venv\Scripts\activate.bat"
) else if exist "venv\Scripts\activate.bat" (
    echo [*] Activating virtual environment (venv)...
    call venv\Scripts\activate.bat
) else (
    echo [!] No venv found — using system Python.
    echo     Create one at the project root: python -m venv .venv
)

:: Verify .env exists
if not exist ".env" (
    echo [!] WARNING: .env file not found. Copy env.example to .env and fill in values.
    pause
    exit /b 1
)

echo [*] Starting FastAPI on http://0.0.0.0:8000 ...
echo [*] Press Ctrl+C to stop.
echo.

python -m uvicorn main:app --host 0.0.0.0 --port 8000 --log-level info

echo.
echo [*] Server stopped.
pause
