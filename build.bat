@echo off
setlocal

cd /d "%~dp0"

call "%~dp0scripts\setup-venv.bat" -r requirements.txt -r requirements-build.txt
if errorlevel 1 exit /b 1

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
