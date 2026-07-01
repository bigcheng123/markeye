@echo off
chcp 65001 >nul
cd /d "%~dp0\.."
title MarkEye Smoke Test

if exist ".venv\Scripts\activate.bat" (
    call ".venv\Scripts\activate.bat"
)

python smoke\run_smoke.py %*
set EXIT_CODE=%ERRORLEVEL%
exit /b %EXIT_CODE%
