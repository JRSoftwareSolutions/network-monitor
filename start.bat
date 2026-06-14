@echo off
setlocal

cd /d "%~dp0"

call "%~dp0scripts\setup-venv.bat" -r requirements.txt
if errorlevel 1 exit /b 1

echo Starting Network Monitor...
start "Network Monitor" cmd /k ".venv\Scripts\python.exe" -m src.server

echo Waiting for server to start...
set /a WAIT_ATTEMPTS=0
:wait_server
curl.exe -sf --max-time 2 http://127.0.0.1:8080/api/config >nul 2>&1
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
