@echo off
setlocal

cd /d "%~dp0"

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
".venv\Scripts\python.exe" -m pip install -q -r requirements.txt -r requirements-build.txt
if errorlevel 1 (
    echo Failed to install dependencies.
    pause
    exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
    echo Node.js not found — cannot build dashboard CSS. Install Node.js and retry.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo Installing Node dependencies...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo Failed to install Node dependencies.
        pause
        exit /b 1
    )
)

echo Building dashboard CSS...
call npm run build:css
if errorlevel 1 (
    echo CSS build failed.
    pause
    exit /b 1
)

echo Building NetworkMonitor.exe...
".venv\Scripts\python.exe" -m PyInstaller network_monitor.spec --noconfirm
if errorlevel 1 (
    echo Build failed.
    pause
    exit /b 1
)

echo.
echo Build complete: dist\NetworkMonitor\NetworkMonitor.exe
echo Copy the dist\NetworkMonitor folder anywhere and double-click the exe.
pause
exit /b 0
