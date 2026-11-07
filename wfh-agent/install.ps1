# Install the Master Flow agent on this laptop. Run from an ELEVATED PowerShell.
# Copies binaries to Program Files, locks them down, auto-starts the collector
# at login, and keeps it alive with a per-minute Task Scheduler task (so if it
# is killed it relaunches within ~1 minute).

#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"
$distDir = Join-Path $PSScriptRoot "dist"
$src = if (Test-Path (Join-Path $distDir "masterflow-collector.exe")) {
    $distDir
} else {
    # GitHub Actions artifacts place the executables beside this installer.
    $PSScriptRoot
}
$target = "C:\Program Files\MasterFlowAgent"

if (-not (Test-Path (Join-Path $src "masterflow-collector.exe"))) {
    throw "dist\masterflow-collector.exe not found. Run build.ps1 first."
}

Write-Host "Installing to $target ..."
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item (Join-Path $src "masterflow-collector.exe") $target -Force
Copy-Item (Join-Path $src "masterflow-watchdog.exe")  $target -Force
Copy-Item (Join-Path $src "config.yaml")          $target -Force
Copy-Item (Join-Path $src "policy-notice.txt")    $target -Force

# --- Ask for the upload token in a simple pop-up box (Ctrl+V works here) ---
$cfgPath = Join-Path $target "config.yaml"
$cfg = Get-Content $cfgPath -Raw
if ($cfg -match 'ingest_token:\s*""') {
    Add-Type -AssemblyName Microsoft.VisualBasic
    $tok = [Microsoft.VisualBasic.Interaction]::InputBox(
        "Paste the Master Flow upload token below and click OK.`r`n(It's the long text after WFH_INGEST_TOKEN= in the file Claude sent you.)",
        "Master Flow setup", "")
    if ($tok -and $tok.Trim()) {
        $cfg = $cfg -replace 'ingest_token:\s*".*"', ('ingest_token: "' + $tok.Trim() + '"')
        Set-Content -Path $cfgPath -Value $cfg -Encoding UTF8
        Write-Host "Token saved. Master Flow uploads are ON." -ForegroundColor Green
    } else {
        Write-Host "No token entered - the agent will still run and store locally;" -ForegroundColor Yellow
        Write-Host "re-run this installer later to add the token." -ForegroundColor Yellow
    }
}

# Create the runtime data tree up front.
$data = "C:\ProgramData\MasterFlowAgent"
foreach ($d in @("db","screens","logs","state")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $data $d) | Out-Null
}

# Lock the program folder: standard Users get read/execute only, no modify/delete.
# This is what stops a non-admin employee from altering or removing the agent.
Write-Host "Applying ACLs (Users = read/execute only) ..."
icacls $target /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" `
       "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-32-545:(OI)(CI)RX" | Out-Null
# S-1-5-18 SYSTEM (Full), S-1-5-32-544 Administrators (Full), S-1-5-32-545 Users (Read/Execute)

$collectorExe = Join-Path $target "masterflow-collector.exe"
$watchdogExe  = Join-Path $target "masterflow-watchdog.exe"

# Keep-alive via Task Scheduler itself (more reliable than a separate watchdog
# process): run the collector every minute. Windows ignores the trigger while an
# instance is already running, and the collector's own single-instance lock
# backs that up - so this does nothing while it is alive, but RELAUNCHES it
# within ~1 minute if it was killed. Interactive + limited so the tray can show.
Write-Host "Registering collector keep-alive task (every minute) ..."
schtasks /Create /TN "MasterFlowCollector" /TR "`"$collectorExe`"" `
  /SC MINUTE /MO 1 /RL LIMITED /F | Out-Null

# Reliable per-user auto-start at EVERY login. A tray app must run in the
# interactive session, which a Run-key launch provides reliably (scheduled-task
# launches of tray apps often don't show the icon). This is what makes it start
# on its own without anyone double-clicking it.
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
New-ItemProperty -Path $runKey -Name "MasterFlow" -Value ('"' + $collectorExe + '"') -PropertyType String -Force | Out-Null

# Start now so you do not have to reboot / log out first.
Write-Host "Starting Master Flow ..."
Start-Process -FilePath $collectorExe

Write-Host "`nInstalled."
Write-Host "  - Master Flow starts at login and relaunches within ~1 minute if stopped."
Write-Host "  - Screenshots + metadata land in $data"
Write-Host "  - Only running uninstall.ps1 as administrator removes it."
Write-Host "`nNote: a local administrator can still stop it; a Standard (non-admin)"
Write-Host "employee account is what makes it truly un-stoppable."

Write-Host ""
Read-Host "Setup finished. Press Enter to close this window"
