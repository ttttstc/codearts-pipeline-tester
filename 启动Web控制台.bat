@echo off
title Huawei Cloud Pipeline Tester - Web Console
cd /d "%~dp0"

:: Check dependencies
if not exist node_modules (
  echo -------------------------------------------------------
  echo [ERROR] Dependencies not found!
  echo Please run "安装依赖.bat" first.
  echo -------------------------------------------------------
  pause
  exit /b
)

echo Starting Web Console...
echo.

:: Direct launch server.js (Skipping launcher.js wrapper)
node server.js

if %errorlevel% neq 0 (
  echo.
  echo [ERROR] Server exited with code %errorlevel%
  echo Check server_error.log for details.
)
pause
