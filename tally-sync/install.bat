@echo off
title CAFlow Tally Sync — Installer
color 0B

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║      CAFlow Tally Sync — One-Time Setup          ║
echo  ╚══════════════════════════════════════════════════╝
echo.

:: Check Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js is not installed.
    echo  Please download from: https://nodejs.org  (LTS version)
    echo  Then run this installer again.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo  [OK] Node.js %NODE_VER% found

:: Navigate to tally-sync folder
cd /d "%~dp0"

:: Install dependencies
echo.
echo  [1/3] Installing dependencies...
call npm install --silent
if %errorlevel% neq 0 (
    echo  [ERROR] npm install failed. Check your internet connection.
    pause
    exit /b 1
)
echo  [OK] Dependencies installed

:: Create .env from example if not exists
if not exist ".env" (
    copy ".env.example" ".env" >nul
    echo  [2/3] Created .env file — PLEASE EDIT IT with your credentials
) else (
    echo  [2/3] .env file already exists
)

echo.
echo  ══════════════════════════════════════════════════════
echo  IMPORTANT: Edit the .env file before running sync!
echo.
echo  You need to fill in:
echo    SUPABASE_SERVICE_KEY  — from Supabase dashboard
echo    FIRM_ID               — from CAFlow app URL/Settings
echo    CLIENT_ID             — from CAFlow client record
echo    ENGAGEMENT_ID         — from CAFlow engagement record
echo    FROM_DATE / TO_DATE   — financial year dates (YYYYMMDD)
echo    TALLY_COMPANY         — exact company name in Tally (optional)
echo  ══════════════════════════════════════════════════════
echo.

:: Open .env for editing
echo  [3/3] Opening .env for editing...
start notepad ".env"

echo.
echo  After editing .env, run:  sync-now.bat
echo  For auto-sync, run:       auto-sync.bat
echo.
pause
