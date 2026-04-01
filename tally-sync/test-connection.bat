@echo off
title CAFlow Tally Sync — Test Connection
color 0B
cd /d "%~dp0"

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║       CAFlow Tally Sync — Test Connection        ║
echo  ╚══════════════════════════════════════════════════╝
echo.

node src/index.js test

echo.
node src/index.js companies

pause
