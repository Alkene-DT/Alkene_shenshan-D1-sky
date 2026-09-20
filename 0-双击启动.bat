@echo off
chcp 65001 >nul
cd /d "%~dp0"
title D1 带走一片属于你的天空 · 启动服务
echo ==================================================
echo   D1 带走一片属于你的天空 · 深汕气象天文科普馆
echo ==================================================
echo.
echo [温馨提示] 本展项现已支持【直接双击 index.html 离线打开】！
echo           平时无需启动本命令行窗口，直接双击网页文件即可。
echo.
echo 正在为您检查并启动本地服务器 (http://localhost:4185) ...
echo.
where npm >nul 2>nul
if errorlevel 1 (
  echo [提示] 本机未检测到 Node.js，正直接为您在默认浏览器中打开 index.html ...
  start "" "index.html"
  timeout /t 3 >nul
  exit /b 0
)

if not exist "node_modules" (
  echo 首次启动正在配置组件，请稍候...
  call npm install
)

if not exist "dist\index.html" (
  call npm run build
)

start "" /min cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:4185"
echo --------------------------------------------------
echo   本地预览地址 : http://localhost:4185
echo   关闭服务只需直接关闭本窗口或按 Ctrl+C。
echo --------------------------------------------------
echo.
call npm run preview
pause
