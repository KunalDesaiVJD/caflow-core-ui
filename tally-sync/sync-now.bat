@echo off
title CAFlow Tally Sync — Running
color 0A
cd /d "%~dp0"

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║       CAFlow Tally Sync — One-Time Sync          ║
echo  ╚══════════════════════════════════════════════════╝
echo.
echo  Make sure Tally is open with the correct company!
echo.

node src/index.js sync

echo.
if %errorlevel% equ 0 (
    echo  ✅ Sync complete! Data is now in CAFlow.
) else (
    echo  ✘ Sync failed. See error above.
)
echo.
pause
