/**
 * NCE (Non-Corporate Entity) Financial Statement Line Items
 *
 * Single source of truth shared by:
 *   - Stage 6 COA Mapping  (PipelineStage3.tsx)
 *   - Stage 7 Financial Statements  (PipelineFinancialStatements.tsx)
 *
 * Codes use the NCE_ prefix to avoid any collision with corporate BS_/PL_ codes.
 * Sections use NCE_BS_ / NCE_PL_ prefix so PipelineFinancialStatements can
 * filter them with the same bsPrefix/plPrefix pattern it uses for corporate items.
 */

// ── Shared interface (same shape used by PipelineStage3 + PipelineFinancialStatements) ──
export interface FSLineItem {
  code: string;
  name: string;
  noteRef: number | null;
  section: string;
  children?: FSLineItem[];
  scheduleRef?: string;
  /** Render as a pure section-divider label row — no amounts, no note ref. */
  isDivider?: boolean;
  /** When true, flattenTree outputs children BEFORE this node so it appears
   *  as a "TOTAL" row at the bottom of its group instead of a header at top. */
  showTotalLast?: boolean;
  /** Suppress this row in on-screen renderFSRows (still participates in computation). */
  hideFromDisplay?: boolean;
}

// ═══════════════════════════════════════════════════════════
// NCE Balance Sheet + P&L tree
// ═══════════════════════════════════════════════════════════
export const NCE_FS_ITEMS: FSLineItem[] = [
  // ── BALANCE SHEET — EQUITY AND LIABILITIES ──
  // NCE_EL_HDR: pure section-divider label (no amounts).
  // NCE_EL: accumulates child totals via computeTotal(); showTotalLast so it
  //         renders as "TOTAL EQUITY AND LIABILITIES" at the bottom of the section.
  { code: "NCE_EL_HDR", name: "EQUITY AND LIABILITIES", noteRef: null, section: "NCE_BS_liabilities", isDivider: true },
  { code: "NCE_EL", name: "TOTAL EQUITY AND LIABILITIES", noteRef: null, section: "NCE_BS_liabilities", showTotalLast: true, children: [
    { code: "NCE_OWN", name: "(1) Owners Funds", noteRef: null, section: "NCE_BS_liabilities", children: [
      { code: "NCE_CAP", name: "(a) Owners' Capital Account", noteRef: 2, section: "NCE_BS_liabilities" },
    ]},
    { code: "NCE_NCL", name: "(2) Non-Current Liabilities", noteRef: null, section: "NCE_BS_liabilities", children: [
      { code: "NCE_LTB",  name: "(a) Long-term borrowings",        noteRef: 3, section: "NCE_BS_liabilities" },
      { code: "NCE_OLTL", name: "(b) Other long-term liabilities",  noteRef: 4, section: "NCE_BS_liabilities" },
      { code: "NCE_LTP",  name: "(c) Long-term provisions",         noteRef: 5, section: "NCE_BS_liabilities" },
    ]},
    { code: "NCE_CL", name: "(3) Current Liabilities", noteRef: null, section: "NCE_BS_liabilities", children: [
      { code: "NCE_STB", name: "(a) Short-term borrowings",       noteRef: 6, section: "NCE_BS_liabilities" },
      { code: "NCE_TP",  name: "(b) Trade payables",              noteRef: 7, section: "NCE_BS_liabilities" },
      { code: "NCE_OCL", name: "(c) Other current liabilities",   noteRef: 8, section: "NCE_BS_liabilities" },
      { code: "NCE_STP", name: "(d) Short-term provisions",       noteRef: 9, section: "NCE_BS_liabilities" },
    ]},
  ]},

  // ── BALANCE SHEET — ASSETS ──
  { code: "NCE_AST_HDR", name: "ASSETS", noteRef: null, section: "NCE_BS_assets", isDivider: true },
  { code: "NCE_AST", name: "TOTAL ASSETS", noteRef: null, section: "NCE_BS_assets", showTotalLast: true, children: [
    { code: "NCE_NCA", name: "(1) Non-Current Assets", noteRef: null, section: "NCE_BS_assets", children: [
      { code: "NCE_PPE",   name: "(a)(i)  Property, plant and equipment", noteRef: 10, section: "NCE_BS_assets" },
      { code: "NCE_CWIP",  name: "(a)(ii) Capital work-in-progress",      noteRef: 11, section: "NCE_BS_assets" },
      { code: "NCE_INTG",  name: "(a)(iii) Intangible assets",            noteRef: 12, section: "NCE_BS_assets" },
      { code: "NCE_NCINV", name: "(b) Non-current investments",           noteRef: 13, section: "NCE_BS_assets" },
      { code: "NCE_LTLA",  name: "(c) Long-term loans and advances",      noteRef: 14, section: "NCE_BS_assets" },
      { code: "NCE_ONCA",  name: "(d) Other non-current assets",          noteRef: 15, section: "NCE_BS_assets" },
    ]},
    { code: "NCE_CA", name: "(2) Current Assets", noteRef: null, section: "NCE_BS_assets", children: [
      { code: "NCE_CINV", name: "(a) Current investments",           noteRef: 16, section: "NCE_BS_assets" },
      { code: "NCE_STCK", name: "(b) Inventories",                   noteRef: 17, section: "NCE_BS_assets", scheduleRef: "BS+P&L" },
      { code: "NCE_TR",   name: "(c) Trade receivables",             noteRef: 18, section: "NCE_BS_assets" },
      { code: "NCE_CASH", name: "(d) Cash and bank balances",        noteRef: 19, section: "NCE_BS_assets" },
      { code: "NCE_STLA", name: "(e) Short-term loans and advances", noteRef: 20, section: "NCE_BS_assets" },
      { code: "NCE_OCA",  name: "(f) Other current assets",          noteRef: 21, section: "NCE_BS_assets" },
    ]},
  ]},

  // ── BS FOOTNOTE ──
  { code: "NCE_ACCTPOL", name: "Summary of Significant Accounting Policies", noteRef: 1, section: "NCE_BS_footnote" },

  // ── PROFIT & LOSS — INCOME ──
  // "INCOME" is the section label; NCE_PL_INC is the total that renders after I & II.
  { code: "NCE_PL_INC_HDR", name: "INCOME", noteRef: null, section: "NCE_PL_income", isDivider: true },
  { code: "NCE_PL_INC", name: "III. Total Income (I + II)", noteRef: null, section: "NCE_PL_income", showTotalLast: true, children: [
    { code: "NCE_REV_OPS", name: "I.  Revenue from operations", noteRef: 22, section: "NCE_PL_income" },
    { code: "NCE_REV_OTH", name: "II. Other income",            noteRef: 23, section: "NCE_PL_income" },
  ]},

  // ── PROFIT & LOSS — EXPENSES ──
  // NCE_CII (changes in inventories) is hidden from display — its value is already
  // captured within Cost of goods sold in the Excel template.  It is kept in the
  // tree so inventory dual-posting still functions correctly, but hideFromDisplay
  // suppresses it in renderFSRows.
  { code: "NCE_PL_EXP_HDR", name: "EXPENSES", noteRef: null, section: "NCE_PL_expenses", isDivider: true },
  { code: "NCE_PL_EXP", name: "IV. Total Expenses", noteRef: null, section: "NCE_PL_expenses", showTotalLast: true, children: [
    { code: "NCE_COGS",     name: "(a) Cost of goods sold",          noteRef: 24, section: "NCE_PL_expenses" },
    { code: "NCE_CII",      name: "(a) Changes in inventories",      noteRef: 24, section: "NCE_PL_expenses", hideFromDisplay: true },
    { code: "NCE_EMP_EXP",  name: "(b) Employee benefits expense",   noteRef: 25, section: "NCE_PL_expenses" },
    { code: "NCE_FIN_COST", name: "(c) Finance costs",               noteRef: 26, section: "NCE_PL_expenses" },
    { code: "NCE_DEPR",     name: "(d) Depreciation and amortisation", noteRef: 27, section: "NCE_PL_expenses" },
    { code: "NCE_OTH_EXP",  name: "(e) Other expenses",              noteRef: 28, section: "NCE_PL_expenses" },
  ]},

  // ── PROFIT CHAIN ──
  { code: "NCE_PROF_V",   name: "V.    Profit/(Loss) before exceptional items, partners' remuneration and tax", noteRef: null, section: "NCE_PL_profit" },
  { code: "NCE_EXCEP",    name: "VI.   Exceptional items",                                                     noteRef: null, section: "NCE_PL_profit" },
  { code: "NCE_PROF_VII", name: "VII.  Profit before extraordinary items and tax",                             noteRef: null, section: "NCE_PL_profit" },
  { code: "NCE_EXTORD",   name: "VIII. Extraordinary items",                                                   noteRef: null, section: "NCE_PL_profit" },
  { code: "NCE_PROF_IX",  name: "IX.   Profit before partners' remuneration and tax",                         noteRef: null, section: "NCE_PL_profit" },
  { code: "NCE_PART_REM", name: "X.    Partners' remuneration",                                               noteRef: 29,   section: "NCE_PL_profit" },
  { code: "NCE_PROF_XI",  name: "XI.   Profit before tax (IX − X)",                                          noteRef: null, section: "NCE_PL_profit" },
  // showTotalLast: sub-items render first; tax total renders after.
  { code: "NCE_TAX", name: "XII.  Tax expense", noteRef: null, section: "NCE_PL_profit", showTotalLast: true, children: [
    { code: "NCE_CUR_TAX",   name: "(1) Current tax",                             noteRef: null, section: "NCE_PL_profit" },
    { code: "NCE_PRIOR_TAX", name: "(2) Short/excess provision for earlier years", noteRef: null, section: "NCE_PL_profit" },
    { code: "NCE_DEFER_TAX", name: "(3) Deferred tax charge / (benefit)",          noteRef: null, section: "NCE_PL_profit" },
  ]},
  { code: "NCE_NET_PROF",   name: "XIII. Profit / (Loss) for the year (XI − XII)",                     noteRef: null, section: "NCE_PL_profit" },
  { code: "NCE_DISC_OP",    name: "XIV.  Profit/(loss) from discontinuing operations",                 noteRef: null, section: "NCE_PL_profit" },
  { code: "NCE_DISC_TAX",   name: "XV.   Tax expense of discontinuing operations",                     noteRef: null, section: "NCE_PL_profit" },
  { code: "NCE_DISC_AT",    name: "XVI.  Profit/(loss) from discontinuing operations (after tax) (XIV-XV)", noteRef: null, section: "NCE_PL_profit" },
  { code: "NCE_FINAL_PROF", name: "XVII. Profit/(Loss) for the year (XIII+XVI)",                       noteRef: null, section: "NCE_PL_profit" },
];

// ═══════════════════════════════════════════════════════════
// NCE Auto-Mapping Rules  (used by Stage 6 COA Mapping)
// Keywords → NCE codes.  Prioritised like the corporate rules:
// "high" beats "medium" beats "low" when multiple rules match.
// ═══════════════════════════════════════════════════════════
export const NCE_AUTO_MAP_RULES: {
  keywords: string[];
  code: string;
  confidence: "high" | "medium" | "low";
}[] = [
  // ── Cash / Bank ──────────────────────────────────────────────────────────
  { keywords: ["cash", "bank", "cash in hand", "cash at bank", "cash and bank", "petty cash"], code: "NCE_CASH", confidence: "high" },

  // ── Trade Receivables ─────────────────────────────────────────────────────
  { keywords: ["sundry debtor", "trade receivable", "accounts receivable", "debtors"], code: "NCE_TR", confidence: "high" },

  // ── Trade Payables ────────────────────────────────────────────────────────
  { keywords: ["sundry creditor", "trade payable", "accounts payable", "creditors"], code: "NCE_TP", confidence: "high" },

  // ── Inventories ───────────────────────────────────────────────────────────
  { keywords: ["inventory", "stock", "stock in trade", "raw material", "finished goods", "work in progress", "wip"], code: "NCE_STCK", confidence: "high" },

  // ── Owners / Partners Capital (NCE-specific) ──────────────────────────────
  { keywords: ["capital account", "owners capital", "owner capital", "partner capital", "partners capital",
                "proprietor capital", "proprietors capital", "partner's capital"], code: "NCE_CAP", confidence: "high" },

  // ── Long-term Borrowings ──────────────────────────────────────────────────
  { keywords: ["secured loan", "term loan", "long term borrowing", "long-term loan", "vehicle loan", "machinery loan"], code: "NCE_LTB", confidence: "high" },

  // ── Short-term Borrowings ─────────────────────────────────────────────────
  { keywords: ["unsecured loan", "short term borrowing", "cash credit", "overdraft", "od limit", "cc limit", "working capital loan"], code: "NCE_STB", confidence: "high" },

  // ── PPE (Tangible) ────────────────────────────────────────────────────────
  { keywords: ["fixed asset", "plant", "machinery", "furniture", "vehicle", "computer", "building", "land", "equipment", "property", "ppe"], code: "NCE_PPE", confidence: "medium" },

  // ── Intangibles ───────────────────────────────────────────────────────────
  { keywords: ["goodwill", "software", "patent", "trademark", "intangible"], code: "NCE_INTG", confidence: "medium" },

  // ── CWIP ──────────────────────────────────────────────────────────────────
  { keywords: ["capital work in progress", "cwip", "capital wip"], code: "NCE_CWIP", confidence: "high" },

  // ── Non-current Investments ───────────────────────────────────────────────
  { keywords: ["investment", "mutual fund", "debenture", "bond", "ncd"], code: "NCE_NCINV", confidence: "medium" },

  // ── Long-term Loans & Advances ────────────────────────────────────────────
  { keywords: ["long term advance", "security deposit", "capital advance", "long-term deposit"], code: "NCE_LTLA", confidence: "medium" },

  // ── Short-term Loans & Advances / Other CA ────────────────────────────────
  { keywords: ["advance", "prepaid", "tds receivable", "advance tax", "gst receivable", "input tax credit", "itc"], code: "NCE_STLA", confidence: "medium" },

  // ── Other Current Liabilities ─────────────────────────────────────────────
  { keywords: ["statutory dues", "gst payable", "tds payable", "pf payable", "esi payable", "advance from customer", "duties payable"], code: "NCE_OCL", confidence: "medium" },

  // ── Short-term Provisions ─────────────────────────────────────────────────
  { keywords: ["provision for tax", "provision for gratuity", "provision for leave", "provision"], code: "NCE_STP", confidence: "low" },

  // ── Revenue from Operations ───────────────────────────────────────────────
  { keywords: ["sale", "revenue", "income from operation", "turnover", "service income", "fees received"], code: "NCE_REV_OPS", confidence: "high" },

  // ── Other Income ──────────────────────────────────────────────────────────
  { keywords: ["other income", "interest received", "dividend received", "miscellaneous income", "rent received", "commission income"], code: "NCE_REV_OTH", confidence: "medium" },

  // ── Cost of Goods Sold ────────────────────────────────────────────────────
  { keywords: ["purchase", "cost of goods", "cost of material", "raw material consumed", "stock consumed", "direct expense", "direct cost"], code: "NCE_COGS", confidence: "high" },

  // ── Employee Benefits ─────────────────────────────────────────────────────
  { keywords: ["salary", "wage", "staff", "employee", "bonus", "gratuity expense", "pf contribution", "esi contribution"], code: "NCE_EMP_EXP", confidence: "high" },

  // ── Finance Costs ─────────────────────────────────────────────────────────
  { keywords: ["interest paid", "bank charge", "finance cost", "bank interest", "interest on loan", "loan interest", "processing fee"], code: "NCE_FIN_COST", confidence: "high" },

  // ── Depreciation ─────────────────────────────────────────────────────────
  { keywords: ["depreciation", "amortisation", "amortization"], code: "NCE_DEPR", confidence: "high" },

  // ── Partners' Remuneration (NCE-specific) ─────────────────────────────────
  { keywords: ["partners remuneration", "partner remuneration", "remuneration to partners",
                "salary to partners", "interest to partners", "partner salary", "partner interest on capital"], code: "NCE_PART_REM", confidence: "high" },

  // ── Current Tax ───────────────────────────────────────────────────────────
  { keywords: ["income tax", "current tax", "tax on income", "mat"], code: "NCE_CUR_TAX", confidence: "high" },

  // ── Other Expenses ────────────────────────────────────────────────────────
  { keywords: ["rent", "repair", "maintenance", "electricity", "telephone", "travelling", "conveyance",
                "printing", "stationery", "advertisement", "legal", "professional", "audit fee",
                "insurance", "misc expense", "office expense", "other expense", "general expense"], code: "NCE_OTH_EXP", confidence: "low" },
];
