@echo off
cd /d "%~dp0"
echo Starting EmiratesCo API server...
call venv\Scripts\activate 2>nul || python -m venv venv && call venv\Scripts\activate && pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 2
pause
