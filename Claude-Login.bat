@echo off
setlocal
title Sign in to Claude Code
where claude >nul 2>nul
if errorlevel 1 (
  echo Claude Code was not found. Install it from https://claude.com/claude-code and run this again.
  pause
  exit /b 1
)
echo Opening the Claude sign-in in your browser. Choose your Claude account ^(Pro or Max^) and approve.
echo.
call claude auth login
echo.
echo --- Current status ---
call claude auth status
echo.
echo If it says "loggedIn": true, close this window and try the chat again.
pause
