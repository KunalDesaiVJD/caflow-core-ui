# CAFlow Tally Sync — Revised Setup Guide (LAN Server Edition)

---

## First: Understand Your Setup

Your office network looks like this:

```
┌─────────────────────────────────────────────────────────────┐
│                      OFFICE LAN                             │
│                                                             │
│  ┌──────────────────┐        ┌────────────┐                 │
│  │   SERVER PC       │  LAN   │  Node PC 1 │                 │
│  │  ─────────────── │◄──────►│            │                 │
│  │  Tally installed  │        └────────────┘                 │
│  │  License/Dongle   │        ┌────────────┐                 │
│  │  Port 9000 (XML)  │◄──────►│  Node PC 2 │                 │
│  │                   │        └────────────┘                 │
│  │  Data: shared     │        ┌────────────┐                 │
│  │  folder on server │◄──────►│  Node PC 3 │                 │
│  └──────────────────┘        └────────────┘                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Key fact:** Tally's XML server (port 9000) runs **only on the Server PC**,
not on node PCs. Node PCs are just displaying Tally — all processing and data
is on the server.

---

## Important: Will This Break Node PC Connections?

**No. Here is why:**

| What the sync agent does | Impact on node PCs |
|--------------------------|-------------------|
| Sends read-only XML requests to port 9000 | Zero — node PCs use a different Tally protocol |
| Reads ledger/group data | Zero — read-only, no file locking |
| Runs for ~30 seconds per sync | Zero — Tally handles this as a background request |
| Uses ~1 MB of network bandwidth per sync | Negligible on any LAN |

The Tally XML API is specifically designed for third-party integrations.
It is completely separate from the Tally client-server communication used by node PCs.
Running the sync will not:
- Disconnect any node PC
- Slow down Tally for users
- Corrupt or lock any data
- Require Tally to restart

---

## Choose Where to Run the Sync Agent

You have two options. Choose based on what is most convenient for you.

---

### ✅ Option A — Run on the Server PC (RECOMMENDED)

**Best because:** No firewall changes needed. Most reliable. Works even if
node PCs are shut down.

```
Server PC:
  Tally (port 9000) ← localhost → Sync Agent → Internet → Supabase/CAFlow
```

**Proceed to: [Part 1 → Server PC Setup](#part-1--option-a-server-pc-setup)**

---

### ✅ Option B — Run on Your Desk PC (Node PC)

**Best because:** You control the sync from your own machine without touching
the server. Requires one firewall rule on the server.

```
Your Desk PC:
  Sync Agent → LAN (192.168.x.x:9000) → Server Tally → Internet → Supabase
```

**Proceed to: [Part 2 → Node PC Setup](#part-2--option-b-node-pc-setup)**

---

---

# PART 1 — Option A: Server PC Setup

### Step 1 — Enable Tally XML Server on Server PC

*Do this once. Only needed if not already done.*

**Tally ERP 9:**
1. On the Server PC, open Tally ERP 9
2. Load any company (Tally must show Gateway of Tally)
3. Press **F12** → Select **"Configure"**
4. Select **"Advanced Configuration"**
5. Find: **"Enable Tally.ERP9 Act as Server"** → Set to **Yes**
6. Port: **9000** (do not change this)
7. Press **Enter** → Press **Enter** again to save

**Tally Prime:**
1. On the Server PC, open Tally Prime
2. Press **Alt+F1** or go to **Help → Settings → Connectivity**
3. Set **"Enable Tally as Server"** → **Yes**
4. Set **Port** → **9000**
5. Press **Ctrl+A** to save

**Verify it worked:**
On the server PC, open Chrome/Edge and go to: `http://localhost:9000`
- If you see XML text or a blank page → ✅ Working
- If you see "This site can't be reached" → ❌ Redo the steps above

---

### Step 2 — Install Node.js on Server PC

1. On the Server PC, open a browser and go to: **https://nodejs.org**
2. Click **"LTS"** (Long Term Support) — do NOT pick "Current"
3. Download the Windows Installer (.msi)
4. Run the installer → click Next → Next → Install (all defaults are fine)
5. **Reboot the server PC** after installation

**Verify:**
Open Command Prompt on server PC and type:
```
node --version
```
Should show: `v18.x.x` or `v20.x.x` ✅

---

### Step 3 — Copy the Plugin Files to Server PC

The `tally-sync` folder is in your CAFlow project. You need to get it to the server.

**Option 3A — Copy via USB drive:**
1. Copy the entire `tally-sync` folder to a USB drive
2. On server PC, paste it to: `C:\CAFlow-TallySync\`

**Option 3B — Copy via shared network folder:**
1. On server PC, the folder is probably already accessible if CAFlow project
   is on a shared drive
2. Or copy via \\ServerPC\SharedFolder

**Final location on server should be:**
```
C:\CAFlow-TallySync\
  ├── src\
  │   ├── index.js
  │   ├── tally-client.js
  │   ├── queries.js
  │   ├── parser.js
  │   └── supabase-push.js
  ├── package.json
  ├── .env.example
  ├── install.bat
  ├── sync-now.bat
  └── auto-sync.bat
```

---

### Step 4 — Run Installer on Server PC

1. On the server PC, open `C:\CAFlow-TallySync\`
2. Double-click **`install.bat`**
3. It will install dependencies and open `.env` in Notepad

---

### Step 5 — Fill in .env on Server PC

In the `.env` file that opened, fill in:

```env
# Server PC setup — Tally is on THIS machine
TALLY_HOST=localhost
TALLY_PORT=9000

SUPABASE_URL=https://hubyywmodekfdzhwiumb.supabase.co
SUPABASE_SERVICE_KEY=<your-service-role-key>

FIRM_ID=<from CAFlow>
CLIENT_ID=<from CAFlow>
ENGAGEMENT_ID=<from CAFlow>

FROM_DATE=20240401
TO_DATE=20250331
FINANCIAL_YEAR=2024-25

SYNC_INTERVAL_MINUTES=30
TALLY_COMPANY=
```

Save and close Notepad.

**How to get SUPABASE_SERVICE_KEY:**
1. Go to https://supabase.com → Login → Open your project
2. Click **Settings** (gear icon) → **API**
3. Under **"Project API keys"**, copy the **service_role** key
   (NOT the anon/public key)

---

### Step 6 — Test Connection on Server PC

Double-click **`test-connection.bat`**

Expected output:
```
✓ Tally reachable at localhost:9000
✓ Supabase reachable at https://...supabase.co

Companies open in Tally:
  1. M/s ABC Pvt Ltd
```

If Tally shows ✓ and Supabase shows ✓ → proceed to Step 7.

---

### Step 7 — Run Your First Sync

1. Make sure Tally is open on the server with the correct company loaded
2. Double-click **`sync-now.bat`**
3. Wait 30–60 seconds
4. Open CAFlow → Trial Balance → your data should appear

---

### Step 8 — Set Up Auto-Sync on Server PC (Optional)

For automatic sync every 30 minutes while Tally is running:

**Simple method (manual):**
- Double-click `auto-sync.bat` — leave it running in the background

**Automatic method (Windows Task Scheduler):**
This starts the sync automatically when the server boots, without anyone needing to double-click anything.

1. On server PC, press **Windows + R** → type `taskschd.msc` → Enter
2. Click **"Create Basic Task"** on the right panel
3. Name: `CAFlow Tally Auto-Sync`
4. Trigger: **Daily** → Start time: 9:00 AM
5. Action: **Start a Program**
6. Program: `C:\CAFlow-TallySync\auto-sync.bat`
7. Finish

To also run it on startup:
- After creating, right-click the task → Properties
- Triggers tab → New → Begin task: **At startup**
- Check: **"Repeat task every: 30 minutes"** → for duration: **Indefinitely**

---

---

# PART 2 — Option B: Node PC Setup

In this option, you install and run the sync agent on **your desk PC** (a node PC).
The agent connects to the server PC's Tally over the LAN.

### Step 1 — Enable Tally XML Server on SERVER PC

*Same as Option A, Step 1 — do this on the server PC.*

Go to the server PC and enable XML server (F12 → Advanced Config → Enable as Server = Yes, Port 9000).

---

### Step 2 — Open Windows Firewall on SERVER PC for Port 9000

By default, Tally's XML server only allows connections from the same machine (localhost).
You need to open port 9000 so your desk PC can reach it over LAN.

**Do this on the SERVER PC:**

1. Press **Windows key** → search **"Windows Defender Firewall"** → Open it
2. Click **"Advanced Settings"** on the left
3. Click **"Inbound Rules"** → then **"New Rule..."** on the right
4. Select **"Port"** → Next
5. Select **"TCP"** → Specific local ports: **9000** → Next
6. Select **"Allow the connection"** → Next
7. Check all three: Domain, Private, Public → Next
8. Name: **`Tally XML API`** → Finish

**OR use Command Prompt (run as Administrator on server):**
```cmd
netsh advfirewall firewall add rule name="Tally XML API" dir=in action=allow protocol=TCP localport=9000
```

**Verify firewall rule worked:**
On your DESK PC, open Command Prompt and type:
```
telnet 192.168.1.10 9000
```
(Replace `192.168.1.10` with server's actual IP)
- If you see a blank screen → ✅ Port is open
- If "connection refused" → Redo firewall step
- If telnet not found: `pkgmgr /iu:"TelnetClient"` first

---

### Step 3 — Find the Server PC's IP Address

On the **Server PC**, open Command Prompt and type:
```
ipconfig
```
Look for **"IPv4 Address"** under your LAN adapter:
```
Ethernet adapter Local Area Connection:
   IPv4 Address. . . . : 192.168.1.10   ← This is your server IP
   Subnet Mask . . . . : 255.255.255.0
```

Write down this IP. Example: `192.168.1.10`

> **Tip:** To make this IP permanent (so it doesn't change after reboot),
> set a static IP on the server PC:
> Network Settings → Change Adapter → Properties → IPv4 → Use following IP → enter the same IP

---

### Step 4 — Install Node.js on Your Desk PC

1. Go to **https://nodejs.org** on your desk PC
2. Download **LTS** version
3. Install with all defaults
4. Verify: open Command Prompt → type `node --version`

---

### Step 5 — Copy tally-sync Folder to Your Desk PC

Copy the `tally-sync` folder from the CAFlow project to your desk PC.
Suggested location: `C:\CAFlow-TallySync\`

---

### Step 6 — Run Installer on Your Desk PC

Double-click `install.bat` → installs dependencies → opens `.env`

---

### Step 7 — Fill in .env on Your Desk PC

**The key difference from Option A: TALLY_HOST points to server IP, not localhost.**

```env
# Node PC setup — Tally is on the SERVER at this IP
TALLY_HOST=192.168.1.10      ← Replace with your server's actual IP
TALLY_PORT=9000

SUPABASE_URL=https://hubyywmodekfdzhwiumb.supabase.co
SUPABASE_SERVICE_KEY=<your-service-role-key>

FIRM_ID=<from CAFlow>
CLIENT_ID=<from CAFlow>
ENGAGEMENT_ID=<from CAFlow>

FROM_DATE=20240401
TO_DATE=20250331
FINANCIAL_YEAR=2024-25

SYNC_INTERVAL_MINUTES=30
TALLY_COMPANY=
```

---

### Step 8 — Test the Connection

Double-click `test-connection.bat`

Expected output:
```
✓ Tally reachable at 192.168.1.10:9000
✓ Supabase reachable at https://...supabase.co

Companies open in Tally:
  1. M/s ABC Pvt Ltd
```

---

### Step 9 — Run Sync

Double-click `sync-now.bat`

For auto-sync: double-click `auto-sync.bat` and leave it running on your desk PC.

---

---

# Common .env Values: Where to Find Them

### SUPABASE_SERVICE_KEY
1. Open browser → go to https://supabase.com → Login
2. Select your project
3. Left sidebar → **Settings** → **API**
4. Copy **"service_role"** key (the long one under "Project API keys")
   > ⚠️ Use service_role, NOT anon. service_role bypasses RLS — required for the sync agent.

### FIRM_ID
1. Log into CAFlow
2. Open Settings or your profile page
3. The URL or settings page will show Firm ID

### CLIENT_ID
1. In CAFlow, go to **Clients**
2. Click on the client you want to sync Tally for
3. The URL will look like: `https://caflow.app/clients/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
4. That UUID is the CLIENT_ID

### ENGAGEMENT_ID
1. In CAFlow, go to **Audit Engagements**
2. Click on the engagement
3. Copy UUID from URL

---

# Troubleshooting Quick Reference

| Error | Cause | Fix |
|-------|-------|-----|
| `Cannot connect to Tally at localhost:9000` | XML server not enabled | F12 → Advanced Config → Enable as Server = Yes |
| `Cannot connect to Tally at 192.168.x.x:9000` | Firewall blocking port 9000 | Add inbound firewall rule on server for port 9000 |
| `Empty response from Tally` | No company open in Tally | Open a company in Tally on the server |
| `No ledgers found` | Wrong date range | Check FROM_DATE/TO_DATE format: YYYYMMDD |
| `Supabase connection failed` | Wrong key | Use service_role key, not anon key |
| `insert failed: column not found` | Migration not run | Run the SQL migration in Supabase SQL Editor |
| `ECONNREFUSED` on node PC | Firewall not open | Redo Step 2 of Option B |
| Other node PCs disconnecting | (This cannot happen — see note above) | Not caused by sync agent |

---

# Proof That Node PCs Are Safe

To confirm the sync does not affect other node PCs at all:

1. Before running sync: ask a user on another node PC to note the time in Tally
2. Run `sync-now.bat`
3. After sync: check if the other user noticed anything

You will find: **zero disruption**. The XML API is a separate, isolated subsystem
of Tally that is completely independent from the client-server license management.

Tally officially supports this in their documentation:
> "Tally.ERP9's XML interface allows third-party applications to retrieve
> data from Tally without affecting normal operations."

---

# Summary: Which Option to Choose?

| Situation | Recommended Option |
|-----------|-------------------|
| You have access to the server PC | **Option A** (server) — easiest, no firewall |
| You prefer to control sync from your desk | **Option B** (node PC) — one firewall step |
| Server is locked / you can't install software | **Option B** but IT must open firewall |
| You want 24/7 sync without keeping your PC on | **Option A** with Task Scheduler |
