@echo off
setlocal

cd /d "%~dp0"

where go >nul 2>&1
if errorlevel 1 (
    if exist "C:\Program Files\Go\bin\go.exe" (
        set "PATH=C:\Program Files\Go\bin;%PATH%"
    )
)
if exist "%USERPROFILE%\go\bin" set "PATH=%USERPROFILE%\go\bin;%PATH%"
where go >nul 2>&1
if errorlevel 1 (
    echo Go is not installed. Install from https://go.dev/dl/ and retry.
    pause
    exit /b 1
)

if not exist web\node_modules (
    echo Installing web dependencies...
    pushd web
    call npm install
    if errorlevel 1 exit /b 1
    popd
)

echo Building dashboard...
pushd web
call npm run build
if errorlevel 1 exit /b 1
popd

echo Syncing static assets...
call npm run sync-web
if errorlevel 1 exit /b 1

echo Building monitor...
go build -o bin\monitor.exe ./cmd/monitor
if errorlevel 1 exit /b 1

echo Starting Network Monitor...
start "Network Monitor" cmd /k "bin\monitor.exe"

echo Waiting for server to start...
set /a WAIT_ATTEMPTS=0
:wait_server
curl.exe -sf --max-time 2 http://127.0.0.1:8080/api/health >nul 2>&1
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
