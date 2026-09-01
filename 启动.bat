@echo off
rem MediaHub launcher: cd to this script's folder, then run dev.
rem Uses %~dp0 so no Chinese path needs to be stored in this file (avoids codepage issues).
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm not found in PATH. Install Node.js first.
  pause
  exit /b 1
)
echo Starting MediaHub dev...
call npm run dev
if errorlevel 1 (
  echo.
  echo [ERROR] dev exited with an error. Check output above.
  pause
)
