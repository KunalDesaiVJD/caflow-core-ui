# CAFlow Tally Sync — How It Works (Plain Language)

Answers to every question about company selection, period selection,
language translation, and what needs to be open when.

---

## Q1. Which company in Tally gets synced?

There are two ways the sync agent knows which Tally company to fetch data from:

---

### Way 1 — You leave TALLY_COMPANY blank in .env

```env
TALLY_COMPANY=         ← blank
```

**What happens:**
The sync fetches data from **whichever company is currently open and visible**
on the Gateway of Tally screen at the moment you run the sync.

```
Tally Screen (Gateway of Tally)
┌─────────────────────────────────────┐
│  Current Period: 1-Apr-24 to 31-Mar-25 │
│  Current Company: M/s ABC Pvt Ltd   │  ← THIS company gets synced
│                                     │
│  Gateway of Tally                   │
└─────────────────────────────────────┘
```

**Rule:** You MUST have the correct company open on Gateway of Tally before running sync.
If a different company is open, that company's data will sync instead.

---

### Way 2 — You set TALLY_COMPANY in .env

```env
TALLY_COMPANY=M/s ABC Pvt Ltd     ← exact name
```

**What happens:**
The sync fetches data from that specific named company **regardless of which
company is currently visible on the Gateway of Tally screen.**

```
Tally Screen (Gateway of Tally)
┌─────────────────────────────────────┐
│  Current Company: XYZ & Co          │  ← doesn't matter
│                                     │
│  Gateway of Tally                   │
└─────────────────────────────────────┘

But .env says: TALLY_COMPANY=M/s ABC Pvt Ltd
So the sync will fetch ABC's data, not XYZ's.
```

**Rule:** The named company must be in Tally's company list (i.e., it must have
been opened at least once in Tally before — it doesn't need to be active on screen).

**How to find the exact name:**
In Tally, press **F3** (Company) → you will see the list of companies.
Copy the name exactly as shown — spaces, punctuation, and case all matter.

```
Company list in Tally (F3):
  M/s ABC Pvt Ltd          ← copy this exactly into TALLY_COMPANY
  XYZ & Associates
  PQR Trading Co
```

---

### Which way is better?

| Situation | Use |
|-----------|-----|
| You have only 1 company in Tally | Way 1 (leave blank) — simpler |
| You have multiple clients in Tally | Way 2 (set name) — safer, no risk of wrong company |
| Running auto-sync overnight | Way 2 (set name) — so it always gets the right company |
| Syncing multiple clients one after another | Way 2 + separate .env per client |

**Recommendation: Always set TALLY_COMPANY. Do not leave it blank.**
This prevents accidental sync of the wrong company.

---

## Q2. Which period (dates) gets synced?

The period is controlled by two values in your .env file:

```env
FROM_DATE=20240401    ← 1st April 2024 (start of financial year)
TO_DATE=20250331      ← 31st March 2025 (end of financial year)
```

**What this means for the data:**

| Balance | What Tally gives | When Tally calculates it |
|---------|-----------------|--------------------------|
| **Opening Balance** | Balance of each ledger on 31-Mar-2024 (one day before FROM_DATE) | Fixed — does not change |
| **Closing Balance** | Balance of each ledger on 31-Mar-2025 (TO_DATE) | Changes as new entries are posted |
| **Period Debit** | Total of all debit transactions from Apr-24 to Mar-25 | Sum of all journal entries |
| **Period Credit** | Total of all credit transactions from Apr-24 to Mar-25 | Sum of all journal entries |

**Example:**
```
Ledger: HDFC Bank Account
  Opening (01-Apr-24) :  ₹2,50,000 Dr
  Period Debit        :  ₹18,50,000
  Period Credit       :  ₹17,20,000
  Closing (31-Mar-25) :  ₹3,80,000 Dr
```

**Tally does NOT need to have the same period selected on screen.**
Tally always has its own "Current Period" setting, but our XML query
specifies FROM_DATE and TO_DATE directly — Tally ignores its own current period
setting and gives us exactly what we asked for.

**Format rules:**
- Always 8 digits: YYYYMMDD
- No dashes, no slashes
- FY 2024-25 → FROM_DATE=20240401, TO_DATE=20250331
- FY 2023-24 → FROM_DATE=20230401, TO_DATE=20240331

---

## Q3. How does CAFlow (Lovable) understand Tally's language?

Tally has its own vocabulary for account groups. CAFlow uses standard
accounting terminology. The sync agent **automatically translates** between them.

### The Translation Map (Built-In)

Every Tally Primary Group is pre-mapped to standard accounting terms:

| Tally Primary Group | CAFlow Understands It As | BS or P&L | Type |
|---------------------|--------------------------|-----------|------|
| Capital Account | Owner's Equity | Balance Sheet | Equity |
| Reserves & Surplus | Reserves | Balance Sheet | Equity |
| Secured Loans | Long-term Borrowings | Balance Sheet | Liability |
| Unsecured Loans | Unsecured Borrowings | Balance Sheet | Liability |
| Current Liabilities | Current Liabilities | Balance Sheet | Liability |
| Sundry Creditors | Accounts Payable | Balance Sheet | Liability |
| Duties & Taxes | Tax Liabilities | Balance Sheet | Liability |
| Provisions | Provisions | Balance Sheet | Liability |
| Bank OD Accounts | Overdraft (Liability) | Balance Sheet | Liability |
| Fixed Assets | Fixed Assets | Balance Sheet | Asset |
| Investments | Investments | Balance Sheet | Asset |
| Current Assets | Current Assets | Balance Sheet | Asset |
| Sundry Debtors | Accounts Receivable | Balance Sheet | Asset |
| Stock-in-hand | Inventory | Balance Sheet | Asset |
| Cash-in-hand | Cash | Balance Sheet | Asset |
| Bank Accounts | Bank (Asset) | Balance Sheet | Asset |
| Loans & Advances (Asset) | Advances Given | Balance Sheet | Asset |
| Sales Accounts | Revenue / Income | Profit & Loss | Revenue |
| Direct Income | Direct Income | Profit & Loss | Revenue |
| Indirect Income | Other Income | Profit & Loss | Revenue |
| Purchase Accounts | Cost of Goods Sold | Profit & Loss | Expense |
| Direct Expenses | Direct Expenses | Profit & Loss | Expense |
| Indirect Expenses | Overhead Expenses | Profit & Loss | Expense |
| Manufacturing Expenses | Manufacturing Costs | Profit & Loss | Expense |

### What about custom groups created in Tally?

If a client has created their own sub-groups (e.g., "Vehicle Loan" under Secured Loans),
the sync traces back to the **primary group** and classifies from there:

```
Tally Hierarchy:
  Secured Loans (Primary)
    └── Vehicle Loan (custom sub-group)      → still classified as Liability
          └── HDFC Vehicle Loan (ledger)     → still classified as Liability
```

You don't need to do anything — this tracing is automatic.

### What about ledger names?

Ledger names are passed through exactly as they are in Tally.
If Tally has a ledger called "Mohan Bhai Commission Income",
CAFlow will show it as "Mohan Bhai Commission Income" — name unchanged.
Only the classification (BS/PL, type) is translated.

---

## Q4. How do you select the company in CAFlow (Lovable)?

You don't "select" in CAFlow — you configure the mapping once in .env.

The three IDs in .env tell CAFlow exactly where to store the data:

```env
FIRM_ID=xxxxxxxx         ← your CA firm in CAFlow
CLIENT_ID=yyyyyyyy       ← the specific client (e.g., M/s ABC Pvt Ltd)
ENGAGEMENT_ID=zzzzzzzz   ← the specific audit engagement (e.g., FY 2024-25 Audit)
```

Think of it as:
```
FIRM_ID      = "my CA firm"
CLIENT_ID    = "which of my clients"
ENGAGEMENT_ID = "which year's audit for that client"
```

After the sync runs, open CAFlow → go to that client → Audit Engagement → Trial Balance.
The data will appear there automatically.

### Multiple clients in CAFlow?

Each client needs their own set of IDs. Create a separate .env file per client
in the `clients/` folder:

```
tally-sync/
  clients/
    ABC-Pvt-Ltd.env      ← config for M/s ABC Pvt Ltd
    XYZ-Trading.env      ← config for XYZ Trading Co
    PQR-Partners.env     ← config for PQR & Partners
```

Run: `sync-client.bat ABC-Pvt-Ltd` to sync only that client.

---

## Q5. Does Tally need to have the same company open during sync?

**Short answer:**
- If `TALLY_COMPANY` is **set** in .env → No, any company can be open. ✅
- If `TALLY_COMPANY` is **blank** → Yes, the correct company must be open. ⚠️

---

**Detailed explanation:**

The Tally XML API works like a silent background query. When you run the sync:

**Scenario A — TALLY_COMPANY is set:**
```
Tally screen shows: Gateway of Tally — XYZ & Co
Sync runs with:     TALLY_COMPANY=M/s ABC Pvt Ltd

Result: Tally fetches ABC's data in the background.
        XYZ user continues working normally.
        Nobody on any PC sees anything change.
        ✅ Correct data is fetched. ✅ No disruption.
```

**Scenario B — TALLY_COMPANY is blank:**
```
Tally screen shows: Gateway of Tally — XYZ & Co  ← WRONG!
Sync runs with:     TALLY_COMPANY=(blank)

Result: Tally fetches XYZ's data (because XYZ is active).
        ⚠️ Wrong company! ABC's data is NOT fetched.
```

**The professional setup:**
Always put the company name in `TALLY_COMPANY`. This way you can sync any client
without worrying about what is currently open in Tally.

---

## Q6. Can you sync multiple companies one after another?

Yes. Create one .env per client in the `clients/` folder and run them:

```
sync-client.bat ABC-Pvt-Ltd
sync-client.bat XYZ-Trading
sync-client.bat PQR-Partners
```

Or create a `sync-all-clients.bat`:

```bat
@echo off
cd /d "%~dp0"
call sync-client.bat ABC-Pvt-Ltd
call sync-client.bat XYZ-Trading
call sync-client.bat PQR-Partners
echo All clients synced!
pause
```

Each client's data goes to their own CLIENT_ID + ENGAGEMENT_ID in CAFlow.
They never mix.

---

## Q7. What happens in Tally when sync runs?

**Nothing visible happens.** The sync is completely silent from Tally's perspective.

- No popup appears in Tally
- No progress bar shows
- No message to any user on any node PC
- Gateway of Tally screen continues normally
- All node PCs continue working without any interruption

The XML request goes to Tally's background server process (like a silent report request).
Tally processes it, sends back the data, and continues as if nothing happened.

---

## Q8. What does the sync screen look like?

When you run `sync-now.bat`, you will see this on screen:

```
╔══════════════════════════════════════════════════════╗
║           CAFlow Tally Sync — Pre-Sync Summary       ║
╠══════════════════════════════════════════════════════╣
║  WHAT WILL BE SYNCED FROM TALLY:
║
║  Tally Company  : "M/s ABC Pvt Ltd"
║  Period From    : 01-Apr-2024
║  Period To      : 31-Mar-2025
║  Financial Year : 2024-25
║  Tally Server   : localhost:9000
║
║  WHERE DATA WILL GO IN CAFLOW:
║
║  Client ID      : xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
║  Engagement ID  : yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy
║  Firm ID        : zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz
║
║  TRANSLATION (Tally → CAFlow):
║  Tally group names → Standard account types (automatic)
║  e.g. "Sundry Debtors" → Asset | "Capital Account" → Equity
╚══════════════════════════════════════════════════════╝

Step 1: Checking connections...
  ✓ Tally connection OK
  ✓ Supabase connection OK

Step 3: Fetching Groups from Tally...
  ✓ Fetched 32 groups

Step 4: Fetching Ledgers from Tally...
  ✓ Fetched 187 ledgers

Step 5: Building group hierarchy...
  ✓ Built 219 hierarchy nodes

Step 6: Pushing Trial Balance to Supabase...
  ✓ Pushed 187 trial balance snapshots

Step 7: Pushing Hierarchy to Supabase...
  ✓ Pushed 219 hierarchy nodes

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅ Sync complete in 28.4s
     Groups: 32 | Ledgers: 187 | Nodes: 219
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Before running, always check the "Pre-Sync Summary" panel to confirm
the right company and period are shown.

---

## Q9. Does Tally need to be open at all during sync?

**Yes — Tally must be open (running as a program) for the sync to work.**

Specifically:
- Tally application must be running on the server PC
- The company you want to sync must be in Tally's company list
- The XML server must be enabled (F12 setting — done once)

Tally does NOT need to be:
- On any specific screen (Gateway, Voucher, etc.)
- On any specific company (if TALLY_COMPANY is set in .env)
- Actively used by anyone

A useful setup: keep Tally running on the server PC 24/7 (even when no one is
actively using it), and the auto-sync will run every 30 minutes automatically.

---

## Q10. Summary Checklist Before First Sync

```
□ Tally XML server enabled (F12 → Advanced Config → Enable as Server = Yes)
□ TALLY_COMPANY set in .env (exact name as shown in Tally's company list)
□ FROM_DATE and TO_DATE set correctly (YYYYMMDD format)
□ FINANCIAL_YEAR set (e.g., 2024-25)
□ SUPABASE_SERVICE_KEY filled in (service_role key from Supabase dashboard)
□ CLIENT_ID and ENGAGEMENT_ID filled in (from CAFlow client page URL)
□ Run check-config.bat → verify everything looks correct
□ Run test-connection.bat → both Tally and Supabase show ✓
□ Run sync-now.bat → wait for "✅ Sync complete"
□ Open CAFlow → client → Trial Balance → verify data is there
```
