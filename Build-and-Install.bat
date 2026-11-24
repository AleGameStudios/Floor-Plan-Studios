@echo off
setlocal
cd /d "%~dp0"
title Floorplan Studio - build and install

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is needed to build the app. Install the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)

echo.
echo === 1/3 Installing dependencies ===
call npm ci --no-audit --no-fund
if errorlevel 1 goto :fail

echo.
echo === 2/3 Building the Windows installer ===
call npm run dist:win
if errorlevel 1 (
  echo.
  echo The normal build failed, probably because Windows would not let it unpack the code-signing tools ^(symbolic link privilege^).
  echo Retrying without the step that needs it. The app is the same; only the .exe's own icon may stay the default Electron one.
  call npx electron-builder --win nsis --x64 -c.win.signAndEditExecutable=false
  if errorlevel 1 goto :fail
)

echo.
echo === 3/3 Claude Code (for the chat and Ask Claude) ===
where claude >nul 2>nul
if errorlevel 1 (
  echo Claude Code was not found. Install it from https://claude.com/claude-code, then run: claude auth login
) else (
  claude auth status
  echo If that says loggedIn false, run: claude auth login
)

set "INST="
for %%f in (dist\Floorplan-Studio-Setup-*.exe) do set "INST=%%f"
if not defined INST goto :fail

echo.
echo Starting the installer: %INST%
start "" "%INST%"
echo You can close this window.
timeout /t 8 >nul
exit /b 0

:fail
echo.
echo Something went wrong. Scroll up to see the error.
pause
exit /b 1
