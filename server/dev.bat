@echo off
title EmiratesCo API - DEV MODE (port 8001)
cd /d "%~dp0"

echo.
echo  ==========================================
echo   EmiratesCo API - DEV MODE
echo   Port 8001 (production service owns 8000 - do not touch that port)
echo  ==========================================
echo.

:: Locate venv — check project-root .venv first, then local venv fallback
if exist "..\\.venv\Scripts\activate.bat" (
    echo [*] Activating virtual environment: .venv
    call "..\\.venv\Scripts\activate.bat"
) else if exist "venv\Scripts\activate.bat" (
    echo [*] Activating virtual environment: venv
    call venv\Scripts\activate.bat
) else (
    echo [!] No venv found — using system Python.
    echo     Create one at the project root: python -m venv .venv
)

if not exist ".env" (
    echo [!] WARNING: .env file not found. Copy env.example to .env and fill in values.
    pause
    exit /b 1
)

echo [*] Starting FastAPI (reload) on http://127.0.0.1:8001 ...
echo [*] The production service keeps running separately on 8000 — this will NOT touch it.
echo [*] Remember: point the Vite dev client at VITE_API_URL=http://localhost:8001 (client/.env.development.local)
echo [*] Press Ctrl+C to stop.
echo.

python -m uvicorn main:app --host 127.0.0.1 --port 8001 --reload

echo.
echo [*] Dev server stopped.
pause
