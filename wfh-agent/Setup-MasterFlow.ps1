# Master Flow - one-click setup (run via Setup-MasterFlow.bat, which elevates).
# Does everything in one go: copy to Program Files, ask for employee/device/token,
# lock the folder, register the per-minute keep-alive task, add a login shortcut,
# and start it now. ASCII only (PowerShell mis-parses non-ASCII .ps1 files).

#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"

$distDir = Join-Path $PSScriptRoot "dist"
$src = if (Test-Path (Join-Path $distDir "masterflow-collector.exe")) { $distDir } else { $PSScriptRoot }
$target = "C:\Program Files\MasterFlowAgent"
$data   = "C:\ProgramData\MasterFlowAgent"

if (-not (Test-Path (Join-Path $src "masterflow-collector.exe"))) {
    throw "masterflow-collector.exe not found next to this script. Extract the ZIP fully and run again."
}

Write-Host "1/6 Copying files to $target ..."
New-Item -ItemType Directory -Force -Path $target | Out-Null
foreach ($f in @("masterflow-collector.exe","masterflow-watchdog.exe","config.yaml","policy-notice.txt")) {
    $p = Join-Path $src $f
    if (Test-Path $p) { Copy-Item $p $target -Force }
}
foreach ($d in @("db","screens","logs","state")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $data $d) | Out-Null
}

Write-Host "2/6 Asking for this laptop's details ..."
Add-Type -AssemblyName Microsoft.VisualBasic
$emp = [Microsoft.VisualBasic.Interaction]::InputBox("Employee name/id for THIS laptop (e.g. ramesh-shah):", "Master Flow - Employee", "")
$dev = [Microsoft.VisualBasic.Interaction]::InputBox("A short name for THIS laptop (e.g. ramesh-laptop):", "Master Flow - Device", "")
$tok = [Microsoft.VisualBasic.Interaction]::InputBox("Paste the Master Flow upload token:", "Master Flow - Token", "")

$cfgPath = Join-Path $target "config.yaml"
$cfg = Get-Content $cfgPath -Raw
if ($emp -and $emp.Trim()) { $cfg = $cfg -replace 'employee_id:\s*".*"', ('employee_id: "' + $emp.Trim() + '"') }
if ($dev -and $dev.Trim()) { $cfg = $cfg -replace 'device_id:\s*".*"',   ('device_id: "'   + $dev.Trim() + '"') }
if ($tok -and $tok.Trim()) { $cfg = $cfg -replace 'ingest_token:\s*".*"', ('ingest_token: "' + $tok.Trim() + '"') }
Set-Content -Path $cfgPath -Value $cfg -Encoding UTF8
if (-not ($tok -and $tok.Trim())) {
    Write-Host "   WARNING: no token entered - it will capture locally but not upload until you add the token." -ForegroundColor Yellow
}

Write-Host "3/6 Locking the program folder (Users = read/execute only) ..."
icacls $target /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-32-545:(OI)(CI)RX" | Out-Null

$collectorExe = Join-Path $target "masterflow-collector.exe"

Write-Host "4/6 Registering keep-alive task (runs every minute; restarts if killed) ..."
$a = New-ScheduledTaskAction -Execute $collectorExe
$t = New-ScheduledTaskTrigger -Once -At (Get-Date)
$t.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1)).Repetition
$p = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$s = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "MasterFlowCollector" -Action $a -Trigger $t -Principal $p -Settings $s -Force | Out-Null

Write-Host "5/6 Adding a login shortcut (instant start at sign-in) ..."
$startup = [Environment]::GetFolderPath('Startup')
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path $startup "MasterFlow.lnk"))
$lnk.TargetPath = $collectorExe
$lnk.Save()

Write-Host "6/6 Starting Master Flow now ..."
Start-ScheduledTask -TaskName "MasterFlowCollector"

Write-Host ""
Write-Host "DONE. Master Flow is installed and running." -ForegroundColor Green
Write-Host "  - A green dot appears near the clock (behind the ^ arrow)."
Write-Host "  - It starts at every login and relaunches within ~1 minute if stopped."
Write-Host "  - Screenshots upload to CAFlow and auto-delete after 7 days."
Write-Host "  - For a truly un-stoppable setup, the employee's Windows account must be Standard (non-admin)."
Write-Host ""
Read-Host "Press Enter to close"
