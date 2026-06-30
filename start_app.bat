@echo off
chcp 65001 >nul
cd /d "%~dp0"
title MarkEye Web Server

echo ========================================
echo   MarkEye Web 服务
echo ========================================
echo.

if exist ".venv\Scripts\activate.bat" (
    call ".venv\Scripts\activate.bat"
    echo [OK] 已激活虚拟环境 .venv
) else (
    echo [提示] 未找到 .venv，使用系统 Python
)

where python >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 python，请先安装 Python 3.10+
    pause
    exit /b 1
)

echo.
echo 启动中...
echo   UI:  http://localhost:8080/template/
echo   Mock: http://localhost:8080/template/?mock=0
echo.
echo 关闭本窗口将停止服务。
echo ----------------------------------------
echo.

python -m src.web_server
set EXIT_CODE=%ERRORLEVEL%

echo.
echo [MarkEye] 服务已退出 (code=%EXIT_CODE%)
if not "%EXIT_CODE%"=="0" pause
exit /b %EXIT_CODE%
