@echo off
rem One click setup for Windows. Double click this file.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Trying to install it with winget...
  where winget >nul 2>nul
  if errorlevel 1 (
    echo Please install the LTS version from https://nodejs.org , then double click this file again.
    pause
    exit /b 1
  )
  winget install -e --id OpenJS.NodeJS.LTS
  echo.
  echo Node.js was installed. Close this window and double click setup.cmd again.
  pause
  exit /b 0
)
node backend\scripts\setup.mjs %*
echo.
pause
