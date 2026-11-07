# Master Flow — Complete Guide

Everything about the Master Flow employee activity monitoring system, in one
document: what it is, how it fits together, where to download it, how to install
it on any PC (one click), how to view the screenshots, retention, and
troubleshooting.

- **GitHub repository:** https://github.com/KunalDesaiVJD/caflow-core-ui
- **Agent code + installers:** `wfh-agent/` folder in that repo
- **Download the installer (built automatically):**
  https://github.com/KunalDesaiVJD/caflow-core-ui/actions/workflows/wfh-agent-build.yml
- **View screenshots:** the CAFlow app → log in as **superadmin** → **Employee Screenshots**

---

## 1. What it does

On a company-owned Windows laptop, Master Flow:
- takes a **full-screen screenshot every 15 seconds** (all monitors) plus the
  active app and window title, during working hours (09:30–19:00 by default);
- **uploads** them to CAFlow, where the **superadmin** views them per employee;
- shows a small **tray icon** ("Master Flow") and a one-time on-screen notice the
  employee acknowledges (disclosure — keep it lawful);
- **auto-starts** at login and **restarts within ~1 minute** if it is stopped;
- **permanently deletes** anything older than **7 days**, on the laptop and the server.

## 2. How it fits together

```
Company laptop (Windows)              CAFlow backend (Supabase)            You
  Master Flow agent                     wfh-ingest function                superadmin
   - screenshot every 15s   --upload--> - saves image to private bucket -> Admin ->
   - app + window title                 - saves row to database              Employee
   - tray icon + notice                 - deletes >7 days daily (job)         Screenshots
   - keeps itself running                                                     (newest first,
   - keeps 7 days locally                                                      view 1-by-1,
                                                                               delete)
```

- **Agent:** `wfh-agent/` (Python, built into Windows `.exe` by GitHub Actions).
- **Backend:** Supabase project `hubyywmodekfdzhwiumb` — table `employee_screenshots`,
  private bucket `employee-screenshots`, function `wfh-ingest`, and a daily
  GitHub Actions job that permanently deletes images older than 7 days.
- **App page:** `src/pages/admin/AdminScreenshots.tsx`, route `/admin/screenshots`
  (superadmin only), with newest-first ordering, one-by-one viewing, and delete.

## 3. One-time setup (admin)

1. **Keep the upload token** (a long string; the same one for every laptop).
   It is private — never post it publicly.
2. **Download the installer once and save the ZIP** to a USB stick / shared drive:
   - Sign in to GitHub, open the download link above, click the **top run with a
     green tick**, scroll to **Artifacts**, and download **`masterflow-agent-windows`**.
   - If Chrome blocks it ("dangerous download"): **Settings → Privacy and security →
     Security → Standard protection**, re-download, then **Keep → Keep anyway**.
   - Copy the ZIP to your USB / shared drive. Re-download only when the agent is
     updated (the GitHub link needs a login and expires after ~14 days).

## 4. Install on a laptop — the easy way (one click)

On the laptop (you need Administrator rights to install):

1. Copy the ZIP across, right-click → **Extract All**.
2. Double-click **`Setup-MasterFlow.bat`** → click **Yes** to the Windows prompt.
   (If "smart app blocked" / "Windows protected your PC" appears: **More info →
   Run anyway**, or allow it.)
3. Three small boxes appear — type:
   - **Employee** (e.g. `ramesh-shah`) — used to label this person's screenshots,
   - **Device** (e.g. `ramesh-laptop`),
   - **Token** — paste the upload token.
4. It installs everything and starts — a **green dot** appears near the clock.
   Done.

That single file copies the program into place, locks it down, registers the
keep-alive, adds the login shortcut, and starts it.

> There is also a manual path (`install.bat` + a PowerShell command) documented
> in `INSTALL-SOP.md`, if you ever need it. For normal use, `Setup-MasterFlow.bat`
> is all you need.

## 5. Make it truly un-stoppable (recommended)

The agent auto-starts and restarts itself, so a non-technical employee can't keep
it off. But **a local administrator can stop or remove anything** — this is true
of every monitoring product. To make it genuinely impossible for the employee to
disable:

**Set the employee's Windows account to Standard (non-admin),** and keep a
separate admin account for yourself/IT:
1. Settings → Accounts → Other users → **Add account** → create your own
   **Administrator** account (password only you know).
2. Sign in to it once, then Settings → Accounts → Other users → the employee's
   account → **Change account type → Standard User**.

## 6. View the screenshots

CAFlow → **log in as superadmin** → left menu **Employee Screenshots**:
- pick the **date** and filter by **employee/device**;
- newest screenshots are at the **top**;
- click one to enlarge, then use **Newer / Older** (or the **← / →** keys) to step
  through one-by-one;
- **Delete** (trash icon on a thumbnail, or the Delete button in the viewer)
  removes a screenshot permanently.

## 7. Retention

Screenshots older than **7 days are deleted automatically and permanently** — on
the laptop (daily purge) and on the server (a daily GitHub Actions job removes the
image files and the records). Nothing older than a week is kept anywhere.

## 8. Uninstall (admin only)

Run **`uninstall.ps1`** as administrator, then also remove the
**`MasterFlowCollector`** task (Task Scheduler) and the **MasterFlow** shortcut in
the Startup folder (`shell:startup`) if present. A standard user cannot do this.

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| Chrome "dangerous download blocked", no Keep button | Settings → Privacy & security → Security → **Standard protection**, re-download, **Keep anyway**. |
| "Smart App Control" blocks the program (no "Run anyway") | Settings → Privacy & security → Windows Security → App & browser control → **Smart App Control → Off** (one-way), then re-run setup. Or get a code-signing certificate (removes all warnings). |
| "Windows protected your PC" when starting | Click **More info → Run anyway**. |
| No green dot after setup | Double-click `C:\Program Files\MasterFlowAgent\masterflow-collector.exe`; it should appear. If not, check `C:\ProgramData\MasterFlowAgent\logs\collector.log`. |
| Killed it, didn't come back | Wait up to ~1 minute (Task Scheduler relaunches every minute). Confirm the `MasterFlowCollector` task exists in Task Scheduler. |
| Nothing in the app | Confirm the token was pasted, the laptop is online, and it's within working hours (09:30–19:00, laptop clock). |

## 10. Legal / disclosure

This is disclosed monitoring on company-owned devices. Keep the signed monitoring
policy and the one-time on-screen notice in place (DPDP Act, 2023). Screenshots
are unredacted and may contain client data — access is superadmin-only, URLs
expire in 1 hour, and everything auto-deletes after 7 days; treat the store as
sensitive.

---

*Questions or changes: everything lives in the `wfh-agent/` folder of the repo
above. The two optional upgrades are a one-click **code-signing certificate**
(stops all browser/Windows warnings) and moving employees to **Standard accounts**
(makes it impossible for them to disable).*
