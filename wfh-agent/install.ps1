# Install the CAFlow WFH agent on this laptop. Run from an ELEVATED PowerShell.
# Copies binaries to Program Files, locks them down, and registers two scheduled
# tasks: the watchdog (SYSTEM, at startup) and the collector (user, at logon).

#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"
$src    = Join-Path $PSScriptRoot "dist"
$target = "C:\Program Files\CAFlowAgent"

if (-not (Test-Path (Join-Path $src "caflow-collector.exe"))) {
    throw "dist\caflow-collector.exe not found. Run build.ps1 first."
}

Write-Host "Installing to $target ..."
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item (Join-Path $src "caflow-collector.exe") $target -Force
Copy-Item (Join-Path $src "caflow-watchdog.exe")  $target -Force
Copy-Item (Join-Path $src "config.yaml")          $target -Force
Copy-Item (Join-Path $src "policy-notice.txt")    $target -Force

# --- Ask for the upload token so you never have to edit a text file ---
$cfgPath = Join-Path $target "config.yaml"
$cfg = Get-Content $cfgPath -Raw
if ($cfg -match 'ingest_token:\s*""') {
    Write-Host ""
    Write-Host "Paste the WFH upload token (Claude saved it for you), then press Enter."
    $tok = Read-Host "Token"
    if ($tok.Trim()) {
        $cfg = $cfg -replace 'ingest_token:\s*".*"', ('ingest_token: "' + $tok.Trim() + '"')
        Set-Content -Path $cfgPath -Value $cfg -Encoding UTF8
        Write-Host "Token saved. Uploads to caflow are ON." -ForegroundColor Green
    } else {
        Write-Host "No token entered — the agent will still run and store locally;" -ForegroundColor Yellow
        Write-Host "add the token to $cfgPath later to turn on uploads." -ForegroundColor Yellow
    }
}

# Create the runtime data tree up front.
$data = "C:\ProgramData\CAFlowAgent"
foreach ($d in @("db","screens","logs","state")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $data $d) | Out-Null
}

# Lock the program folder: standard Users get read/execute only, no modify/delete.
# This is what stops a non-admin employee from altering or removing the agent.
Write-Host "Applying ACLs (Users = read/execute only) ..."
icacls $target /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" `
       "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-32-545:(OI)(CI)RX" | Out-Null
# S-1-5-18 SYSTEM (Full), S-1-5-32-544 Administrators (Full), S-1-5-32-545 Users (Read/Execute)

$collectorExe = Join-Path $target "caflow-collector.exe"
$watchdogExe  = Join-Path $target "caflow-watchdog.exe"

# Watchdog: SYSTEM, at startup, highest privileges. A standard user cannot
# delete or disable a task that runs as SYSTEM.
Write-Host "Registering watchdog task (SYSTEM, at startup) ..."
schtasks /Create /TN "CAFlowWatchdog" /TR "`"$watchdogExe`"" `
  /SC ONSTART /RU "SYSTEM" /RL HIGHEST /F | Out-Null

# Collector: runs in the interactive user's session at logon (needed to see the
# desktop for screenshots). Runs as whoever logs on, limited rights.
Write-Host "Registering collector task (current user, at logon) ..."
schtasks /Create /TN "CAFlowCollector" /TR "`"$collectorExe`"" `
  /SC ONLOGON /RL LIMITED /F | Out-Null

# Start now so you can demo without rebooting / re-logging in.
Write-Host "Starting tasks ..."
schtasks /Run /TN "CAFlowWatchdog"  | Out-Null
schtasks /Run /TN "CAFlowCollector" | Out-Null

Write-Host "`nInstalled."
Write-Host "  - The collector shows a tray icon and the policy notice on first run."
Write-Host "  - Screenshots + metadata land in $data"
Write-Host "  - To prove non-removal: log in as a standard (non-admin) user and try"
Write-Host "    to delete $target or end the task from that account."
Write-Host "`nProduction: replace the tasks with real SYSTEM Windows services + Intune"
Write-Host "enforcement and auto-reinstall, per the architecture document."

Write-Host ""
Read-Host "Setup finished. Press Enter to close this window"
