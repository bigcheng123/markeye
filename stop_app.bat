@echo off
cd /d "%~dp0"
title MarkEye Stop

echo ========================================
echo   MarkEye Web Server - Stop
echo ========================================
echo.

set PORT=8080

echo [1/3] Requesting graceful shutdown (POST /api/system/shutdown)...
curl -s -m 3 -X POST "http://127.0.0.1:%PORT%/api/system/shutdown" >nul 2>&1
if errorlevel 1 (
    echo   Graceful shutdown unavailable, will force-stop if needed.
) else (
    echo   Shutdown request sent.
)

echo [2/3] Waiting for process to exit...
timeout /t 2 /nobreak >nul

echo [3/3] Checking port %PORT%...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
    echo   Force stopping PID %%p
    taskkill /F /PID %%p >nul 2>&1
)

echo.
echo Done. If service still runs, close the start_app.bat window manually.
echo.
pause
