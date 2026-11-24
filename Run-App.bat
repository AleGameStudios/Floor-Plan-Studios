@echo off
setlocal
cd /d "%~dp0"
title Floorplan Studio (running from source)
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is needed. Install the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies first...
  call npm ci --no-audit --no-fund
  if errorlevel 1 goto :fail
)
call npm start
exit /b 0

:fail
echo.
echo Something went wrong. Scroll up to see the error.
pause
exit /b 1
