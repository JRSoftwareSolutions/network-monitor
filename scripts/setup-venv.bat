@echo off
setlocal

cd /d "%~dp0.."

where python >nul 2>&1
if errorlevel 1 (
    echo Python was not found. Install Python 3.10+ and ensure it is on your PATH.
    pause
    exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
    echo Creating virtual environment...
    python -m venv .venv
    if errorlevel 1 (
        echo Failed to create virtual environment.
        pause
        exit /b 1
    )
)

echo Installing dependencies...
".venv\Scripts\python.exe" -m pip install -q %*
if errorlevel 1 (
    echo Failed to install dependencies.
    pause
    exit /b 1
)

exit /b 0
