# CAFlow ⇄ Tally — Billing Sync (Phase 1 forward + Phase 2 reverse)

Two-way sync between CAFlow Billing and the firm's **billing** Tally company.
Runs on the PC where Tally is open (only that PC can reach Tally's `localhost:9000`).

- **Forward** — Invoices & Credit Notes queued in CAFlow → posted to Tally as
  accounting **invoice-mode** vouchers: income **bifurcated** per service ledger,
  party **State/GSTIN from the Tally master**, full break-up in the narration, and a
  `REMOTEID` so re-syncing **updates in place** (delete-by-REMOTEID → create) and
  never duplicates.
- **Reverse** — bank/cash **Receipt** vouchers pulled from Tally, deduped by GUID,
  matched to a CAFlow client, and imported into billing via the `post_receipt` RPC
  (allocations + client ledger stay correct).

## One-time setup

1. `cd tally-sync && npm install`
2. Copy `.env.example` → `.env` and set:
   ```
   SUPABASE_URL=https://hubyywmodekfdzhwiumb.supabase.co
   SUPABASE_SERVICE_KEY=<service_role key>     # Supabase → Project Settings → API
   FIRM_ID=<firm uuid>                          # e.g. V J Desai = be411601-f0f5-4f74-b93d-b87a8ef1b82b
   TALLY_HOST=localhost
   TALLY_PORT=9000
   TALLY_COMPANY=V J Desai & Co LLP             # optional; else read from tally_firm_companies
   ```
3. In Tally: open the billing company, enable the XML server
   (Gateway → F12 → Advanced Config → Enable as Server = Yes, port 9000).

## Daily use

| Command | What it does |
|---|---|
| `npm run push` | Post every invoice/CN queued in CAFlow (Billing → **Tally Sync** tab → *Sync*) to Tally. Idempotent — safe to re-run. |
| `npm run pull-receipts` | Pull Tally bank/cash receipts, dedupe, match clients, stage them for review in the **Tally Sync** tab. |
| `npm run pull-receipts-import` | Same, and auto-import confident (exact-name) matches into billing. |
| `npm run billing-status` | Show queue + staged-receipt counts. |

**Workflow**
1. In CAFlow → **Billing → Tally Sync**: click *Sync* (or *Queue all unsynced*) on the invoices you want in Tally.
2. On the Tally PC: `npm run push`. Re-open the tab — each shows **Synced ✓**.
3. On the Tally PC: `npm run pull-receipts`. Back in the tab, review **Tally receipts**:
   auto-matched rows → *Import*; unmatched rows → pick the client → *Import* (or *Ignore*).

## Scheduling (optional)
Add a Windows Task Scheduler job (or a `.bat` like the existing `auto-sync.bat`) that runs
`npm run push` and `npm run pull-receipts` every N minutes while Tally is open.

## Notes
- Party ledgers are resolved to the **exact Tally casing** automatically (CAFlow stores
  names uppercased). Approved rows in `tally_party_map` override the name match.
- Income ledgers use the firm's verified map (Tax Audit Fees Income / Professional
  Fees-Income / GST Consultancy / RERA Consultancy / …) — see `defaultResolveIncome`
  in `src/voucher-xml.js`; wire to `tally_element_map` once the matcher is built.
- This Tally build only deletes a voucher via a `REMOTEID` it created, so every posted
  document must carry `CAFLOW-<invoiceId>`; the agent always sets it.
