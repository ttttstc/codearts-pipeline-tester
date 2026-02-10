@echo off
title 安装依赖...
cd /d "%~dp0"
echo 正在安装依赖，请稍候...
call npm install
echo.
echo 依赖安装完成！
echo 正在安装 Playwright 浏览器...
call npx playwright install chromium
pause
