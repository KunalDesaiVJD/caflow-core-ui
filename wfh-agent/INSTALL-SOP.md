# Master Flow Agent — Installation SOP (per PC)

A step-by-step guide any non-technical person can follow to install the Master
Flow activity agent on a **company-owned Windows laptop**. When done, the laptop
captures a screenshot every 15 seconds, uploads to CAFlow (viewable by the
superadmin), **auto-starts at login, restarts within ~1 minute if stopped**, and
deletes anything older than 7 days.

> Keep this on company-owned laptops only, with your signed monitoring policy
> and the one-time on-screen notice in place (DPDP compliance).

---

## PART A — Do this ONCE (admin)

1. **Get the upload token.** It's a long text string (kept privately by the
   admin). The *same* token goes on every PC. Never post it publicly.

2. **Download the agent once, save it to a USB stick or shared drive** (so you
   don't re-download on every laptop):
   - Sign in to GitHub and open:
     `https://github.com/KunalDesaiVJD/caflow-core-ui/actions/workflows/wfh-agent-build.yml`
   - Click the **top run with a green tick** → scroll to **Artifacts** → click
     **`masterflow-agent-windows`** → the ZIP downloads.
   - If Chrome blocks it ("dangerous"): **⋮ → Settings → Privacy and security →
     Security → Standard protection**, re-download, then **Keep → Keep anyway**.
   - Copy that ZIP onto your USB stick / shared folder.
   - (The download link expires after ~14 days and needs a GitHub login — that's
     why you keep your own copy of the ZIP. Re-download only when the agent is updated.)

---

## PART B — On EACH laptop

You need **Administrator access** on the laptop to install.

### 1. Copy & extract
- Copy the ZIP from the USB/shared drive to the laptop (e.g. Desktop) →
  right-click → **Extract All**.

### 2. Set who the laptop belongs to + the token
- Open the extracted folder → right-click **`config.yaml`** → **Open with →
  Notepad**.
- Change these three lines (keep the quotes):
  | Line | Change to |
  |------|-----------|
  | `employee_id: "demo-user-01"` | the person, e.g. `employee_id: "ramesh-shah"` |
  | `device_id:   "demo-laptop-01"` | the laptop, e.g. `device_id: "ramesh-laptop"` |
  | `ingest_token: ""` | the token, e.g. `ingest_token: "sbp_xxxxx..."` |
- **Save** (Ctrl+S). *(The name/device is what lets you tell each employee's
  screenshots apart in the app — use a unique one per laptop.)*

### 3. Install
- Right-click **`install.bat`** → **Run as administrator** → **Yes**.
- If Windows says "smart app blocked" / "Windows protected your PC":
  **More info → Run anyway** (or allow it).
- Wait for **"Installed."**, press Enter.

### 4. Turn on auto-start + self-restart (the important part)
- Start menu → type **powershell** → **right-click Windows PowerShell → Run as
  administrator** → Yes. *(The title bar MUST read "Administrator: Windows
  PowerShell".)*
- Paste this whole block, press Enter (it is identical on every PC):

  ```powershell
  $a = New-ScheduledTaskAction -Execute "C:\Program Files\MasterFlowAgent\masterflow-collector.exe"
  $t = New-ScheduledTaskTrigger -Once -At (Get-Date); $t.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1)).Repetition
  $p = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
  $s = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName "MasterFlowCollector" -Action $a -Trigger $t -Principal $p -Settings $s -Force
  ```

  It should print **`MasterFlowCollector … Ready`**.

- (Optional, for an *instant* start at login) Win+R → type **`shell:startup`** →
  Enter; drop a shortcut to
  `C:\Program Files\MasterFlowAgent\masterflow-collector.exe` into that folder.

### 5. Start it now
- Double-click **`C:\Program Files\MasterFlowAgent\masterflow-collector.exe`** →
  a green dot appears near the clock (behind the `^` arrow). That's it running.

### 6. Verify it works
- In CAFlow → **log in as superadmin → Employee Screenshots** → set today's date,
  filter by the name you set → screenshots appear within ~15 seconds.
- **Restart test:** Task Manager → Details → End task `masterflow-collector.exe`
  → within ~1 minute the green dot returns on its own.
- **Reboot test:** restart the laptop, log in, wait ~1 minute → it starts by
  itself (no double-click).

---

## IMPORTANT

- **To make it truly un-stoppable, the employee's Windows account must be
  Standard (non-admin)** — you/IT keep a separate admin account. If the employee
  is a local administrator, it still auto-starts and self-restarts, but an admin
  *could* disable or remove it (true of any monitoring tool).
- **Retention:** screenshots older than 7 days are deleted automatically, on the
  laptop and on the server.
- **Uninstall (admin only):** run `uninstall.ps1` as administrator, then also
  delete the `MasterFlowCollector` task (Task Scheduler) and the `shell:startup`
  shortcut if you added one.

---

## Quick checklist (per laptop)
- [ ] Copied + extracted the agent
- [ ] Edited `config.yaml` — employee_id, device_id, ingest_token
- [ ] Ran `install.bat` as administrator → "Installed."
- [ ] Ran the keep-alive PowerShell block (admin) → "MasterFlowCollector … Ready"
- [ ] Green dot showing
- [ ] Screenshots visible in the app under that name
- [ ] Employee account is Standard (non-admin) — for full lockdown
