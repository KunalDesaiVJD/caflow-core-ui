@echo off
title CAFlow Tally Auto-Sync (Running)
color 0E
cd /d "%~dp0"

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║       CAFlow Tally Sync — Auto-Sync Mode         ║
echo  ╚══════════════════════════════════════════════════╝
echo.
echo  Auto-sync is running. Press Ctrl+C to stop.
echo  Sync interval: see SYNC_INTERVAL_MINUTES in .env
echo  (default: every 30 minutes)
echo.

node src/index.js watch
