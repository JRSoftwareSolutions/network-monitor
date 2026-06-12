@echo off
setlocal

cd /d "%~dp0"

where python >nul 2>&1
if errorlevel 1 (
    echo Python was not found. Install Python 3.10+ and ensure it is on your PATH.
    pause
    exit /b 1
)

echo Starting Network Monitor...
start "Network Monitor" cmd /k python -m src.server

echo Waiting for server to start...
timeout /t 2 /nobreak >nul

start "" http://127.0.0.1:8080

echo Browser opened. The server is running in the other window.
exit /b 0
