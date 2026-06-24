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

where npm >nul 2>&1
if errorlevel 1 (
    echo Node.js is not installed. Install from https://nodejs.org/ and retry.
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

echo Starting Go API on :8080...
start "Network Monitor API" cmd /k cd /d "%~dp0" ^&^& go run ./cmd/monitor

echo Starting Vite dev server on :5173...
start "Network Monitor Vite" cmd /k cd /d "%~dp0web" ^&^& npm run dev

echo Waiting for servers to start...
set /a WAIT_ATTEMPTS=0
:wait_api
curl.exe -sf --max-time 2 http://127.0.0.1:8080/api/health >nul 2>&1
if not errorlevel 1 goto wait_vite
set /a WAIT_ATTEMPTS+=1
if %WAIT_ATTEMPTS% geq 30 (
    echo.
    echo API did not respond within 30 seconds.
    echo Check the "Network Monitor API" window for errors ^(port 8080 may be in use^).
    pause
    exit /b 1
)
timeout /t 1 /nobreak >nul
goto wait_api

:wait_vite
set /a WAIT_ATTEMPTS=0
:wait_vite_loop
curl.exe -sf --max-time 2 http://127.0.0.1:5173/ >nul 2>&1
if not errorlevel 1 goto servers_ready
set /a WAIT_ATTEMPTS+=1
if %WAIT_ATTEMPTS% geq 30 (
    echo.
    echo Vite did not respond within 30 seconds.
    echo Check the "Network Monitor Vite" window for errors ^(port 5173 may be in use^).
    pause
    exit /b 1
)
timeout /t 1 /nobreak >nul
goto wait_vite_loop

:servers_ready
start "" http://127.0.0.1:5173

echo Browser opened. API and Vite are running in separate windows.
echo UI changes hot-reload; restart the API window after Go code changes.
exit /b 0
