# CAFlow Tally Sync — Complete Setup Guide

A robust local bridge that reads **all Groups, Sub-Groups, Ledgers, and Balances**
directly from Tally ERP 9 / Tally Prime and syncs them into CAFlow automatically.

---

## How It Works

```
Tally ERP (localhost:9000)
       ↓  XML API
tally-sync agent (Node.js — runs on your PC)
       ↓  HTTPS
Supabase (CAFlow backend)
       ↓
CAFlow (Lovable — Trial Balance screen)
```

The agent:
1. Connects to Tally's built-in XML server (always running when Tally is open)
2. Fetches all Groups → Sub-Groups → Ledgers with opening/closing balances
3. Builds the full hierarchy tree
4. Pushes everything into Supabase tables used by CAFlow
5. Can auto-repeat every N minutes (watch mode)

---

## Part A — Enable XML Server in Tally

### Tally ERP 9:
1. Open Tally ERP 9
2. Press **F12** (Configure)
3. Go to **Advanced Configuration**
4. Set: **"Enable Tally.ERP9 Act as Server"** → **Yes**
5. Port: **9000** (default — do not change)
6. Press **Enter** to save

### Tally Prime:
1. Open Tally Prime
2. Go to **Help → Settings → Connectivity**
3. Set **"Enable Tally as Server"** → **Yes**
4. Set **"Port"** → **9000**
5. Press **Ctrl+A** to save

### Verify it's working:
Open your browser and go to: `http://localhost:9000`
You should see a Tally response (XML or blank page — either is fine, NOT "connection refused")

---

## Part B — Install Node.js (one-time)

1. Go to: **https://nodejs.org**
2. Download the **LTS** version (e.g., Node 20 LTS)
3. Install with all defaults
4. Verify: open Command Prompt, type `node --version` — should show v16 or higher

---

## Part C — Install the Tally Sync Agent

1. Navigate to the `tally-sync` folder in the CAFlow project
2. Double-click **`install.bat`**
3. It will:
   - Check Node.js
   - Install all dependencies (axios, supabase-js, etc.)
   - Create `.env` from template
   - Open `.env` in Notepad for you to fill in

---

## Part D — Configure .env

Fill in every field in the `.env` file:

```env
# Tally (usually no changes needed)
TALLY_HOST=localhost
TALLY_PORT=9000

# Supabase — from your Supabase dashboard
# Dashboard → Settings → API → service_role key (NOT anon key)
SUPABASE_URL=https://hubyywmodekfdzhwiumb.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGci...  ← service_role key from Supabase dashboard

# CAFlow IDs — from the browser URL when viewing in CAFlow
FIRM_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
ENGAGEMENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# Date range for the financial year
FROM_DATE=20240401
TO_DATE=20250331
FINANCIAL_YEAR=2024-25

# Auto-sync interval (minutes) — used only with auto-sync.bat
SYNC_INTERVAL_MINUTES=30

# Exact company name in Tally (leave blank = currently active company)
TALLY_COMPANY=M/s ABC Pvt Ltd
```

### How to get the IDs from CAFlow:
- **FIRM_ID**: Go to CAFlow → Settings → Your URL will contain the firm ID
- **CLIENT_ID**: Go to CAFlow → Clients → Click the client → copy UUID from URL
- **ENGAGEMENT_ID**: Go to CAFlow → Audit Engagements → Click engagement → copy UUID from URL
- **SUPABASE_SERVICE_KEY**: Supabase Dashboard → Settings → API → `service_role` key

---

## Part E — Run the Sync

### Option 1: One-Time Sync
Double-click **`sync-now.bat`**
- Tally must be open with the correct company
- Takes 10–60 seconds depending on number of ledgers
- On completion, open CAFlow → Trial Balance to see the data

### Option 2: Auto-Sync (every 30 minutes)
Double-click **`auto-sync.bat`**
- Leave this running in the background while Tally is open
- It will auto-sync every N minutes (set in .env)
- Press Ctrl+C to stop

### Option 3: Test Connection First
Double-click **`test-connection.bat`**
- Checks if Tally is reachable
- Checks if Supabase is reachable
- Lists all companies currently open in Tally

---

## What Gets Synced

### From Tally Groups:
- All primary groups (Capital Account, Fixed Assets, Sales, etc.)
- All sub-groups under each primary group
- The full parent→child hierarchy

### From Tally Ledgers:
- Ledger name
- Parent group
- Opening balance (as of FROM_DATE)
- Closing balance (as of TO_DATE)
- Period debit / credit movements
- Classification: BS/PL, Dr/Cr normal balance
- Account type: Asset, Liability, Equity, Revenue, Expense

### Into CAFlow:
- `trial_balance_snapshots` — one row per ledger with all balances
- `tb_hierarchy_nodes` — full group/sub-group/ledger tree
- `ledger_import_batches` — audit trail of each sync run

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Cannot connect to Tally" | Enable XML server in Tally F12 settings. Check port 9000. |
| "Empty response from Tally" | Open a company in Tally first |
| "No ledgers found" | Check FROM_DATE/TO_DATE format (YYYYMMDD) |
| "Supabase connection failed" | Check SUPABASE_SERVICE_KEY — must be service_role, not anon |
| "Missing required .env values" | Fill in all blank values in .env |
| Wrong company syncing | Set TALLY_COMPANY= in .env to exact Tally company name |
| "insert failed" in Supabase | Run the migration SQL in Supabase dashboard |

### Run this SQL in Supabase Dashboard (SQL Editor) if tables are missing:
```sql
-- Check tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('trial_balance_snapshots', 'tb_hierarchy_nodes', 'ledger_import_batches');
```

---

## Command Reference

```bash
node src/index.js sync          # One full sync
node src/index.js watch         # Auto-sync every N minutes
node src/index.js test          # Test Tally + Supabase connection
node src/index.js companies     # List companies open in Tally
```

---

## Firewall Note

The sync agent only makes **outbound** connections:
- Outbound to `localhost:9000` (Tally) — no firewall issue
- Outbound HTTPS to `supabase.co` on port 443 — standard HTTPS

No ports are opened on your machine. No inbound connections are needed.
