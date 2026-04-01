@echo off
:: ─────────────────────────────────────────────────────────────────────────────
:: sync-client.bat — Sync a SPECIFIC client by name
:: Usage: sync-client.bat ClientName
::   e.g: sync-client.bat ABC
::        (reads from clients\ABC.env)
:: ─────────────────────────────────────────────────────────────────────────────
title CAFlow Tally Sync — Client Sync
color 0A
cd /d "%~dp0"

if "%1"=="" (
    echo.
    echo  Usage: sync-client.bat ^<ClientName^>
    echo  Example: sync-client.bat ABC
    echo.
    echo  This will read config from: clients\ABC.env
    echo.
    echo  Available client configs:
    dir /b clients\*.env 2>nul
    echo.
    pause
    exit /b 1
)

set CLIENT=%1
set ENVFILE=clients\%CLIENT%.env

if not exist "%ENVFILE%" (
    echo.
    echo  [ERROR] Config file not found: %ENVFILE%
    echo.
    echo  Create it by copying: clients\CLIENT-A.env.example
    echo  Rename to:            clients\%CLIENT%.env
    echo  Fill in the values for this client.
    echo.
    pause
    exit /b 1
)

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║  CAFlow Tally Sync — Syncing Client: %CLIENT%
echo  ╚══════════════════════════════════════════════════╝
echo.

:: Run sync with this client's env file
node -e "require('dotenv').config({path:'%ENVFILE%'}); require('./src/index.js');" 2>nul
:: Fallback — direct approach
set DOTENV_PATH=%ENVFILE%
node src/index.js sync --env %ENVFILE% 2>nul || (
    copy "%ENVFILE%" ".env.tmp" >nul
    node src/index.js sync
    del ".env.tmp" >nul 2>nul
)

echo.
pause
