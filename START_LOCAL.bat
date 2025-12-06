@echo off
echo ========================================
echo   Pet Finder API - Local Server
echo ========================================
echo.

cd /d "%~dp0"

REM Check if node is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is not installed!
    echo Download from: https://nodejs.org/
    pause
    exit /b 1
)

echo Node.js version:
node --version
echo.

REM Check if dependencies are installed
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    echo.
)

echo Starting server on http://localhost:3000
echo.
echo Press Ctrl+C to stop the server
echo.
echo ========================================
echo.

node server.js

pause
