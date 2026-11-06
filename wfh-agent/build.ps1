# Build the two agent executables with PyInstaller. Run on Windows in the venv.
# Produces: dist\masterflow-collector.exe, dist\masterflow-watchdog.exe
# config.yaml and policy-notice.txt are copied NEXT TO the exes (kept editable).

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
Set-Location $root

Write-Host "Building masterflow-collector.exe ..."
pyinstaller --noconfirm --clean --onefile --noconsole `
  --name masterflow-collector `
  --paths "src" `
  --hidden-import win32timezone `
  --hidden-import pystray._win32 `
  --collect-submodules pystray `
  "src\collector\main.py"

Write-Host "Building masterflow-watchdog.exe ..."
pyinstaller --noconfirm --clean --onefile --noconsole `
  --name masterflow-watchdog `
  --paths "src" `
  "src\watchdog\main.py"

Copy-Item "config.yaml"       "dist\config.yaml"       -Force
Copy-Item "policy-notice.txt" "dist\policy-notice.txt" -Force

Write-Host "`nDone. Artifacts in: $root\dist"
Write-Host "  masterflow-collector.exe  (user-session: tray + capture)"
Write-Host "  masterflow-watchdog.exe   (SYSTEM: keeps collector alive)"
Write-Host "  config.yaml, policy-notice.txt"
Write-Host "`nNext: run install.ps1 from an elevated PowerShell."
