@echo off
cd /d "%~dp0"
title MarkEye Stop

echo ========================================
echo   MarkEye Web Server - Stop
echo ========================================
echo.

echo Stopping service on port 8080...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8080" ^| findstr "LISTENING"') do (
    echo   taskkill PID %%p
    taskkill /F /PID %%p >nul 2>&1
)

echo.
echo Done. If service still runs, close the start_app.bat window manually.
echo.
pause
