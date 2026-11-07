@echo off
REM Master Flow - one-click installer. Double-click this. It asks Windows for
REM admin rights, then runs Setup-MasterFlow.ps1 (which asks for the employee
REM name, laptop name, and token, then installs everything). No PowerShell needed.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','%~dp0Setup-MasterFlow.ps1'"
