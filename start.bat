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
".venv\Scripts\python.exe" -m pip install -q -r requirements.txt
if errorlevel 1 (
    echo Failed to install dependencies.
    pause
    exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
    echo Node.js not found — skipping CSS build ^(using committed static/css/app.css^).
    goto start_server
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

:start_server
echo Starting Network Monitor...
start "Network Monitor" cmd /k ".venv\Scripts\python.exe" -m src.server

echo Waiting for server to start...
set /a WAIT_ATTEMPTS=0
:wait_server
curl.exe -sf http://127.0.0.1:8080/api/config >nul 2>&1
if not errorlevel 1 goto server_ready
set /a WAIT_ATTEMPTS+=1
if %WAIT_ATTEMPTS% geq 30 (
    echo.
    echo Server did not respond within 30 seconds.
    echo Check the "Network Monitor" window for errors ^(port 8080 may be in use^).
    pause
    exit /b 1
)
timeout /t 1 /nobreak >nul
goto wait_server

:server_ready
start "" http://127.0.0.1:8080

echo Browser opened. The server is running in the other window.
exit /b 0
