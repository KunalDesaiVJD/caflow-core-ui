# CAFlow WFH Agent — demo (single laptop)

A **visible, disclosed** work-activity agent for a single company-owned Windows
laptop. It captures, every 15 seconds during working hours:

- a full-screen screenshot of every monitor (WebP), stored **unredacted**,
- the foreground application + window title,
- idle vs active state.

Everything is stored **locally on the laptop** (`C:\ProgramData\CAFlowAgent`).
There is no server in this demo.

## This build is deliberately visible

This is monitoring the employee can see, not covert surveillance:

- A **tray icon is always shown** ("Tracking: ON", today's capture count, a
  pause-for-break item). The agent **refuses to capture if the tray can't
  start** — there is no stealth/hidden mode, by design.
- A **policy notice is shown and must be acknowledged on first run**
  (`policy-notice.txt`). The acknowledgement is recorded.
- The process appears normally in Task Manager; nothing is hidden or disguised.

What *is* enforced is **non-removal by a standard user** — on a company laptop
with a non-admin account, the employee can't uninstall it, delete its files, or
permanently stop it. See "Non-removal" below.

> Before using this on a laptop with real client work on screen: screenshots
> are unredacted, so they will contain client data. Keep this demo on the one
> laptop, don't copy the `screens` folder anywhere shared, and wipe it after.
> Screenshots must be named in the signed monitoring policy the employee
> acknowledges — that's what keeps this lawful.

## What gets installed on the laptop

Installed to `C:\Program Files\CAFlowAgent\` (admin to install; non-admin can't modify):

| File | Role |
|------|------|
| `caflow-collector.exe` | **User-session** app: tray indicator + 15s capture loop. Must run in the logged-in session (a SYSTEM service can't see the desktop to screenshot it). |
| `caflow-watchdog.exe`  | **SYSTEM** process: keeps the collector running; relaunches it if the user kills it. |
| `config.yaml`          | Interval, working hours, storage path, retention. |
| `policy-notice.txt`    | Shown + acknowledged on first run. |

Runtime data under `C:\ProgramData\CAFlowAgent\`:

```
db\agent.db                     # SQLite metadata (ts, display, path, sha256, app, title, idle)
screens\<YYYY-MM-DD>\<ts>_<n>.webp
logs\
state\                          # heartbeat, pause flag, consent flag
```

## Build (on Windows — can't be built on Linux/CI)

```powershell
cd wfh-agent
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
.\build.ps1        # PyInstaller -> dist\caflow-collector.exe, dist\caflow-watchdog.exe
```

## Install (run once, as Administrator)

```powershell
.\install.ps1      # copies to Program Files, registers both scheduled tasks,
                   # sets ACLs, shows the policy notice
```

## Viewing in the caflow app (superadmin)

Instead of browsing the `screens` folder, the captures can appear inside caflow
under **Admin → Employee Screenshots** (superadmin only). To enable it, the
agent uploads each batch to a Supabase edge function, which stores the images
in a private bucket and the metadata in a table; the superadmin views them via
short-lived signed URLs.

Pieces (all in this repo):

- `supabase/migrations/20261106120000_wfh_employee_screenshots.sql` — table
  `employee_screenshots` + private bucket `employee-screenshots`, RLS gated on
  `is_superadmin()` only.
- `supabase/functions/wfh-ingest/index.ts` — receives batches, auths with a
  shared device token, writes with the service role.
- `src/pages/admin/AdminScreenshots.tsx` + route `/admin/screenshots` + an
  "Employee Screenshots" item in the admin sidebar.

**Deploy (must be run from a LOCAL session — a cloud session cannot run the
Supabase CLI; see CLAUDE.md §10):**

```bash
# 1. apply the migration to the linked project
npx supabase db query --linked -f supabase/migrations/20261106120000_wfh_employee_screenshots.sql
npx supabase migration repair --status applied 20261106120000

# 2. deploy the ingest function (no user JWT -> disable JWT verification)
npx supabase functions deploy wfh-ingest --no-verify-jwt

# 3. set the shared device token (pick a long random string)
npx supabase secrets set WFH_INGEST_TOKEN=<long-random-string>

# 4. regenerate DB types so employee_screenshots is typed (replaces the `as any`
#    cast in AdminScreenshots.tsx)
npx supabase gen types typescript --linked > src/integrations/supabase/types.ts
```

**Point the agent at it** — in `config.yaml`:

```yaml
server:
  mode: http
  ingest_url: "https://hubyywmodekfdzhwiumb.functions.supabase.co/wfh-ingest"
  ingest_token: "<the same WFH_INGEST_TOKEN value>"
```

The agent always keeps the local copy; upload is best-effort on top.

> Data note: in `http` mode, unredacted screenshots (which can contain client
> data) are stored in the **production** Supabase project alongside firm/client
> data. Access is superadmin-only and URLs expire in 1 hour, but keep the
> bucket's retention short and treat it as sensitive. The `screens` purge on the
> laptop does not delete uploaded copies — prune the bucket/table separately.

## Non-removal (demo-grade)

- Binaries live in `Program Files` → a standard user can't modify or delete them.
- **Watchdog** runs from a SYSTEM scheduled task (startup trigger, highest
  privileges, restart-on-failure). A non-admin can't delete or disable it.
- **Collector** runs from a logon scheduled task in the user session. If the
  user ends it in Task Manager, the watchdog relaunches it within ~15s; the gap
  is recorded.
- Standard (non-admin) account for the employee is what makes all of the above
  stick — that is the core control.

> Production note: the architecture doc specifies real Windows **services**
> (SYSTEM) + Intune enforcement + auto-reinstall. This demo uses scheduled tasks
> as the equivalent so it installs and runs on one laptop without MDM. Swap to
> services + Intune when moving past the demo.

## Uninstall (Administrator only)

```powershell
.\uninstall.ps1
```
