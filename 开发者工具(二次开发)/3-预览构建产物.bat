@echo off
cd /d "%~dp0.."
echo ==========================================
echo  D1 Take a Piece of Sky / Preview prebuilt dist
echo ==========================================
echo.
if not exist "node_modules" (
  echo [INFO] node_modules missing, running npm install first ...
  call npm install
  if errorlevel 1 ( echo [ERROR] npm install failed. & pause & exit /b 1 )
)
if not exist "dist\index.html" (
  echo [INFO] dist not found, running npm run build first ...
  call npm run build
  if errorlevel 1 ( echo [ERROR] build failed. & pause & exit /b 1 )
)
echo Starting ... open http://localhost:4185 in your browser.
echo Press Ctrl+C to stop.
echo.
call npm run preview
pause
