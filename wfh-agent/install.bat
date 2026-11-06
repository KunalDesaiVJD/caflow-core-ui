@echo off
REM Double-click this to install the Master Flow agent.
REM It asks Windows for administrator rights, then runs install.ps1 (which will
REM prompt you to paste the upload token). No PowerShell knowledge needed.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','%~dp0install.ps1'"
