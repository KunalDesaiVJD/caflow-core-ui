# Tally Sync Migrations

## Apply Order
1. `20260417000001_tally_sync_fix_columns.sql` — adds missing `tally_company` column to existing tally tables
2. `20260417000002_tally_sync_requests.sql` — creates `sync_requests` polling table

## How to Apply
Paste each file's contents into the Supabase SQL Editor:
https://supabase.com/dashboard/project/hubyywmodekfdzhwiumb/sql/new

Or run after creating the `caflow_exec` helper function:
```
node "C:\Users\kvdes\Desktop\CA FLOW\tally-sync\run-migrations.js"
```

## Sync Agent Changes
`sync-engine.js` was updated at `C:\Users\kvdes\Desktop\CA FLOW\tally-sync\sync-engine.js`:
- Added `processPendingSyncRequests()` — checks `sync_requests` table on startup
- `node sync-engine.js` now auto-processes any pending UI-triggered sync requests first
