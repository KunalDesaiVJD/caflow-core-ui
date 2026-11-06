# Remove the CAFlow WFH agent. Run from an ELEVATED PowerShell (admin only — a
# standard user cannot do this, which is the point).
#   .\uninstall.ps1              keeps captured data
#   .\uninstall.ps1 -PurgeData   also deletes C:\ProgramData\CAFlowAgent

#Requires -RunAsAdministrator
param([switch]$PurgeData)
$ErrorActionPreference = "SilentlyContinue"
$target = "C:\Program Files\CAFlowAgent"
$data   = "C:\ProgramData\CAFlowAgent"

Write-Host "Stopping and removing scheduled tasks ..."
schtasks /End    /TN "CAFlowCollector" | Out-Null
schtasks /End    /TN "CAFlowWatchdog"  | Out-Null
schtasks /Delete /TN "CAFlowCollector" /F | Out-Null
schtasks /Delete /TN "CAFlowWatchdog"  /F | Out-Null

# Stop any running processes.
Get-Process caflow-collector, caflow-watchdog -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "Removing program files ..."
Remove-Item -Recurse -Force $target

if ($PurgeData) {
    Write-Host "Purging captured data ..."
    Remove-Item -Recurse -Force $data
} else {
    Write-Host "Kept captured data in $data (use -PurgeData to delete)."
}

Write-Host "Uninstalled."
