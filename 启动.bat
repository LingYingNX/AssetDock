@echo off
rem MediaHub launcher: cd to this script's folder, then run dev.
rem Keep this file pure ASCII: cmd.exe reads .bat in the OEM codepage,
rem so any UTF-8 CJK text here turns into garbage commands.
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm not found in PATH. Install Node.js first.
  pause
  exit /b 1
)
echo Starting MediaHub dev...
call npm run dev
rem dev keeps the console open while the window lives. If it returns, no window came up.
rem Most common cause: another MediaHub instance still holds the single-instance lock,
rem so the new process quits immediately with exit code 0.
if errorlevel 1 (
  echo.
  echo [ERROR] dev exited with an error. Check output above.
  pause
  exit /b 1
)
echo.
echo MediaHub dev exited and no window stayed open.
echo If electron.exe is still in Task Manager, an older instance is running:
echo the single-instance lock rejects a second window.
echo Kill that electron.exe, then run this file again.
pause
