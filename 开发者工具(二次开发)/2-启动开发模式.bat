@echo off
cd /d "%~dp0.."
echo ==========================================
echo  D1 Take a Piece of Sky / Dev server
echo ==========================================
echo.
if not exist "node_modules" (
  echo [INFO] node_modules missing, running npm install first ...
  call npm install
  if errorlevel 1 ( echo [ERROR] npm install failed. & pause & exit /b 1 )
)
echo Starting ... open http://localhost:5185 in your browser.
echo Press Ctrl+C to stop.
echo.
call npm run dev
pause
