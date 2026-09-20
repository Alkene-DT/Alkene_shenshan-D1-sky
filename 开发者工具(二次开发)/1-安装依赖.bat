@echo off
cd /d "%~dp0.."
echo ==========================================
echo  D1 Take a Piece of Sky / Install deps (run once)
echo ==========================================
echo.
where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js / npm not found.
  echo Install Node.js 18+ from https://nodejs.org
  echo.
  pause
  exit /b 1
)
call npm install
if errorlevel 1 (
  echo.
  echo [ERROR] npm install failed. Please check your network.
) else (
  echo.
  echo [OK] Dependencies installed. Next: run 2-*.bat
)
echo.
pause
