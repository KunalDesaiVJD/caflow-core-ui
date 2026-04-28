// Shared config for NCE Detailed Notes — the single source of truth for:
//   • Row IDs used as keys in `nce_financial_notes.cy_data` / `py_data`
//   • Section headers, indentation, and total formulas
//   • Column pattern (A = parallel Long-Term / Short-Term; B = single CY/PY)
//
// Used by:
//   • `src/components/stage8/NCEDetailedNotes.tsx` — the editor (user input)
//   • `src/components/pipeline/PipelineFinancialStatements.tsx` — the Excel
//      exporter which MUST read the same keys back so what the user typed
//      is what lands in the exported "Notes to Accounts" sheet.

export type ColPattern = "A" | "B";

export interface NoteRowDef {
  id: string;
  label: string;
  indent?: number;
  isSectionHeader?: boolean;
  isTotal?: boolean;
  formulaAdd?: string[];
  formulaSub?: string[];
  naLT?: boolean;
  naST?: boolean;
  naAll?: boolean;
  /** For section-total rows in Pattern A: tag to match NCECustomRow.section.
   *  Custom rows with this section tag are added into THIS total (not the grand total). */
  sectionTag?: string;
}

export interface NoteConfig {
  noteType: string;
  title: string;
  pattern: ColPattern;
  rows: NoteRowDef[];
}

export interface NoteData {
  cy: Record<string, number>;
  py: Record<string, number>;
}

// Section heading shown in the exporter above each note — mirrors the NCE
// Financials.xlsx layout (BS vs P&L grouping).
export type NoteSection = "BS" | "PL";

export interface NoteMeta {
  // Display note number matching the NCE Financials template (e.g. "3", "7",
  // "5 & 9" for the LT/ST parallel pair, "22").
  noteNumber: string;
  // Short name used in the title row ("Borrowings", "Trade payables").
  shortName: string;
  section: NoteSection;
}

// Metadata keyed by `noteType` — kept separate from NOTES_CONFIG so the
// editor stays layout-agnostic.
export const NOTE_META: Record<string, NoteMeta> = {
  borrowings:        { noteNumber: "3 & 6",   shortName: "Borrowings",                    section: "BS" },
  other_lt_liab:     { noteNumber: "4",       shortName: "Other Long-Term Liabilities",   section: "BS" },
  provisions:        { noteNumber: "5 & 9",   shortName: "Provisions",                    section: "BS" },
  trade_payables:    { noteNumber: "7",       shortName: "Trade Payables",                section: "BS" },
  other_cl:          { noteNumber: "8",       shortName: "Other Current Liabilities",     section: "BS" },
  cwip:              { noteNumber: "11",      shortName: "Capital Work-in-Progress",      section: "BS" },
  investments:       { noteNumber: "13",      shortName: "Non-Current Investments",       section: "BS" },
  loans_advances:    { noteNumber: "14",      shortName: "Long-Term Loans and Advances",  section: "BS" },
  other_nc_assets:   { noteNumber: "15",      shortName: "Other Non-Current Assets",      section: "BS" },
  inventories:       { noteNumber: "17",      shortName: "Inventories",                   section: "BS" },
  trade_receivables: { noteNumber: "18",      shortName: "Trade Receivables",             section: "BS" },
  cash_bank:         { noteNumber: "19",      shortName: "Cash and Bank Balances",        section: "BS" },
  other_ca:          { noteNumber: "21",      shortName: "Other Current Assets",          section: "BS" },
  revenue_ops:       { noteNumber: "22",      shortName: "Revenue from Operations",       section: "PL" },
  other_income:      { noteNumber: "23",      shortName: "Other Income",                  section: "PL" },
  cogs:              { noteNumber: "24",      shortName: "Cost of Goods Sold",            section: "PL" },
  employee_exp:      { noteNumber: "25",      shortName: "Employee Benefits Expense",     section: "PL" },
  finance_costs:     { noteNumber: "26",      shortName: "Finance Costs",                 section: "PL" },
  other_expenses:    { noteNumber: "28",      shortName: "Other Expenses",                section: "PL" },
};

export const NOTES_CONFIG: NoteConfig[] = [
  // ── Note: Borrowings (Pattern A) ────────────────────────────────────────
  {
    noteType: "borrowings",
    title: "Note 3: Borrowings",
    pattern: "A",
    rows: [
      { id: "sec_hdr",           label: "Secured",                                          isSectionHeader: true },
      { id: "sec_term_bank",     label: "Term loans — Banks",                               indent: 1 },
      { id: "sec_term_fi",       label: "Term loans — Financial institutions",              indent: 1 },
      { id: "sec_term_others",   label: "Term loans — Others",                              indent: 1 },
      { id: "sec_demand_bank",   label: "Loans on demand — Banks",                          indent: 1 },
      { id: "sec_demand_other",  label: "Loans on demand — Others",                         indent: 1 },
      { id: "sec_deferred",      label: "Deferred payment liabilities",                     indent: 1 },
      { id: "sec_related",       label: "Loans from related parties",                       indent: 1 },
      { id: "sec_other",         label: "Other secured loans",                              indent: 1 },
      {
        id: "sec_total", label: "Total (A)", isTotal: true, sectionTag: "secured",
        formulaAdd: ["sec_term_bank","sec_term_fi","sec_term_others","sec_demand_bank",
                     "sec_demand_other","sec_deferred","sec_related","sec_other"],
      },
      { id: "unsec_hdr",           label: "Unsecured",                                        isSectionHeader: true },
      { id: "unsec_term_bank",     label: "Term loans — Banks",                               indent: 1 },
      { id: "unsec_term_fi",       label: "Term loans — Financial institutions",              indent: 1 },
      { id: "unsec_term_others",   label: "Term loans — Others",                              indent: 1 },
      { id: "unsec_demand_bank",   label: "Loans on demand — Banks",                          indent: 1 },
      { id: "unsec_demand_other",  label: "Loans on demand — Others",                         indent: 1 },
      { id: "unsec_deferred",      label: "Deferred payment liabilities",                     indent: 1 },
      { id: "unsec_related",       label: "Loans from related parties",                       indent: 1 },
      { id: "unsec_other",         label: "Other unsecured loans",                            indent: 1 },
      {
        id: "unsec_total", label: "Total (B)", isTotal: true, sectionTag: "unsecured",
        formulaAdd: ["unsec_term_bank","unsec_term_fi","unsec_term_others","unsec_demand_bank",
                     "unsec_demand_other","unsec_deferred","unsec_related","unsec_other"],
      },
      { id: "total_ab", label: "Total (A + B)", isTotal: true, formulaAdd: ["sec_total","unsec_total"] },
    ],
  },

  // ── Note: Other Long-Term Liabilities (Pattern B) ───────────────────────
  {
    noteType: "other_lt_liab",
    title: "Note 4: Other Long-Term Liabilities",
    pattern: "B",
    rows: [
      { id: "adv_customers", label: "(a) Advance from customers" },
      { id: "others",        label: "(b) Others (please specify)" },
      { id: "total",         label: "Total", isTotal: true, formulaAdd: ["adv_customers","others"] },
    ],
  },

  // ── Note: Provisions (Pattern A) ────────────────────────────────────────
  {
    noteType: "provisions",
    title: "Note 5 & 9: Provisions (Long-Term & Short-Term)",
    pattern: "A",
    rows: [
      { id: "gratuity",   label: "Provision for gratuity" },
      { id: "leave_enc",  label: "Provision for leave encashment" },
      { id: "income_tax", label: "Provision for income tax" },
      { id: "other_prov", label: "Other provisions" },
      { id: "specify",    label: "Others (please specify)" },
      {
        id: "total", label: "Total", isTotal: true,
        formulaAdd: ["gratuity","leave_enc","income_tax","other_prov","specify"],
      },
    ],
  },

  // ── Note: Trade Payables (Pattern B) ────────────────────────────────────
  {
    noteType: "trade_payables",
    title: "Note 7: Trade Payables",
    pattern: "B",
    rows: [
      { id: "msme",   label: "(a) Dues to Micro and Small Enterprises (MSME)" },
      { id: "others", label: "(b) Others" },
      { id: "total",  label: "Total", isTotal: true, formulaAdd: ["msme","others"] },
    ],
  },

  // ── Note: Other Current Liabilities (Pattern B) ─────────────────────────
  {
    noteType: "other_cl",
    title: "Note 8: Other Current Liabilities",
    pattern: "B",
    rows: [
      { id: "inc_advance", label: "Income received in advance" },
      { id: "unearned",    label: "Unearned revenue" },
      { id: "gst_payable", label: "GST payable" },
      { id: "tds_payable", label: "TDS payable" },
      { id: "emp_payable", label: "Other payables — Employees" },
      { id: "tax_payable", label: "Other payables — Tax" },
      { id: "other_cl",    label: "Other payables — Others" },
      {
        id: "total", label: "Total", isTotal: true,
        formulaAdd: ["inc_advance","unearned","gst_payable","tds_payable",
                     "emp_payable","tax_payable","other_cl"],
      },
    ],
  },

  // ── Note: Capital Work-in-Progress (Pattern B) ──────────────────────────
  {
    noteType: "cwip",
    title: "Note 11: Capital Work-in-Progress",
    pattern: "B",
    rows: [
      { id: "opening",     label: "Opening balance" },
      { id: "additions",   label: "Add: Additions during the year",         indent: 1 },
      { id: "capitalized", label: "Less: Capitalised during the year",      indent: 1 },
      {
        id: "closing", label: "Closing balance", isTotal: true,
        formulaAdd: ["opening","additions"], formulaSub: ["capitalized"],
      },
    ],
  },

  // ── Note: Non-Current Investments (Pattern A) ───────────────────────────
  {
    noteType: "investments",
    title: "Note 13: Non-Current Investments",
    pattern: "A",
    rows: [
      { id: "quot_hdr",      label: "Quoted Investments",              isSectionHeader: true },
      { id: "quot_property", label: "Investment in property",          indent: 1 },
      { id: "quot_equity",   label: "Equity shares",                   indent: 1 },
      { id: "quot_pref",     label: "Preference shares",               indent: 1 },
      { id: "quot_govt",     label: "Govt & trust securities",         indent: 1 },
      { id: "quot_deb",      label: "Debentures / bonds",              indent: 1 },
      { id: "quot_mf",       label: "Mutual funds",                    indent: 1 },
      { id: "quot_partner",  label: "Partnership interests",           indent: 1 },
      { id: "quot_other",    label: "Other NC investments",            indent: 1 },
      {
        id: "quot_total", label: "Total Quoted (A)", isTotal: true,
        formulaAdd: ["quot_property","quot_equity","quot_pref","quot_govt",
                     "quot_deb","quot_mf","quot_partner","quot_other"],
      },
      { id: "unquot_hdr",      label: "Unquoted Investments",            isSectionHeader: true },
      { id: "unquot_property", label: "Investment in property",          indent: 1 },
      { id: "unquot_equity",   label: "Equity shares",                   indent: 1 },
      { id: "unquot_pref",     label: "Preference shares",               indent: 1 },
      { id: "unquot_govt",     label: "Govt & trust securities",         indent: 1 },
      { id: "unquot_deb",      label: "Debentures / bonds",              indent: 1 },
      { id: "unquot_mf",       label: "Mutual funds",                    indent: 1 },
      { id: "unquot_partner",  label: "Partnership interests",           indent: 1 },
      { id: "unquot_other",    label: "Other NC investments",            indent: 1 },
      {
        id: "unquot_total", label: "Total Unquoted (B)", isTotal: true,
        formulaAdd: ["unquot_property","unquot_equity","unquot_pref","unquot_govt",
                     "unquot_deb","unquot_mf","unquot_partner","unquot_other"],
      },
      {
        id: "total_ab", label: "Total NC Investments (A + B)", isTotal: true,
        formulaAdd: ["quot_total","unquot_total"],
      },
    ],
  },

  // ── Note: Loans & Advances (Pattern A) ──────────────────────────────────
  {
    noteType: "loans_advances",
    title: "Note 14: Long-Term Loans and Advances",
    pattern: "A",
    rows: [
      { id: "sec_hdr",        label: "Secured",                                      isSectionHeader: true },
      { id: "sec_cap_good",   label: "Capital advances — good",                      indent: 1 },
      { id: "sec_cap_doubt",  label: "Capital advances — doubtful",                  indent: 1 },
      { id: "sec_cap_prov",   label: "Less: Provision for doubtful advances",        indent: 2 },
      { id: "sec_related",    label: "Advances to related parties",                  indent: 1 },
      { id: "sec_prepaid",    label: "Prepaid expenses",                             indent: 1 },
      { id: "sec_adv_tax",    label: "Advance tax / TDS",                            indent: 1 },
      { id: "sec_gst",        label: "GST input credit receivable",                  indent: 1 },
      { id: "sec_security",   label: "Security deposits",                            indent: 1 },
      { id: "sec_govt",       label: "Advances to government authorities",           indent: 1 },
      { id: "sec_others",     label: "Others",                                       indent: 1 },
      {
        id: "sec_total", label: "Total (A)", isTotal: true, sectionTag: "secured",
        formulaAdd: ["sec_cap_good","sec_cap_doubt","sec_related","sec_prepaid",
                     "sec_adv_tax","sec_gst","sec_security","sec_govt","sec_others"],
        formulaSub: ["sec_cap_prov"],
      },
      { id: "unsec_hdr",        label: "Unsecured",                                    isSectionHeader: true },
      { id: "unsec_cap_good",   label: "Capital advances — good",                      indent: 1 },
      { id: "unsec_cap_doubt",  label: "Capital advances — doubtful",                  indent: 1 },
      { id: "unsec_cap_prov",   label: "Less: Provision for doubtful advances",        indent: 2 },
      { id: "unsec_related",    label: "Advances to related parties",                  indent: 1 },
      { id: "unsec_prepaid",    label: "Prepaid expenses",                             indent: 1 },
      { id: "unsec_adv_tax",    label: "Advance tax / TDS",                            indent: 1 },
      { id: "unsec_gst",        label: "GST input credit receivable",                  indent: 1 },
      { id: "unsec_security",   label: "Security deposits",                            indent: 1 },
      { id: "unsec_govt",       label: "Advances to government authorities",           indent: 1 },
      { id: "unsec_others",     label: "Others",                                       indent: 1 },
      {
        id: "unsec_total", label: "Total (B)", isTotal: true, sectionTag: "unsecured",
        formulaAdd: ["unsec_cap_good","unsec_cap_doubt","unsec_related","unsec_prepaid",
                     "unsec_adv_tax","unsec_gst","unsec_security","unsec_govt","unsec_others"],
        formulaSub: ["unsec_cap_prov"],
      },
      {
        id: "total_ab", label: "Total (A + B)", isTotal: true,
        formulaAdd: ["sec_total","unsec_total"],
      },
    ],
  },

  // ── Note: Other Non-Current Assets (Pattern B) ──────────────────────────
  {
    noteType: "other_nc_assets",
    title: "Note 15: Other Non-Current Assets",
    pattern: "B",
    rows: [
      { id: "security_dep", label: "Security deposits" },
      { id: "prepaid",      label: "Prepaid expenses" },
      { id: "others",       label: "Others" },
      { id: "total", label: "Total", isTotal: true, formulaAdd: ["security_dep","prepaid","others"] },
    ],
  },

  // ── Note: Inventories (Pattern B) ───────────────────────────────────────
  {
    noteType: "inventories",
    title: "Note 17: Inventories",
    pattern: "B",
    rows: [
      { id: "raw_mat",     label: "Raw materials" },
      { id: "wip",         label: "Work-in-progress" },
      { id: "finished",    label: "Finished goods" },
      { id: "stock_trade", label: "Stock-in-trade" },
      { id: "stores",      label: "Stores and spares" },
      { id: "loose_tools", label: "Loose tools" },
      { id: "others",      label: "Others" },
      {
        id: "total", label: "Total", isTotal: true,
        formulaAdd: ["raw_mat","wip","finished","stock_trade","stores","loose_tools","others"],
      },
    ],
  },

  // ── Note: Trade Receivables (Pattern B) ─────────────────────────────────
  {
    noteType: "trade_receivables",
    title: "Note 18: Trade Receivables",
    pattern: "B",
    rows: [
      { id: "ka_hdr",       label: "(A) Outstanding for less than 6 months",              isSectionHeader: true },
      { id: "ka_secured",   label: "Secured, considered good",                            indent: 1 },
      { id: "ka_unsecured", label: "Unsecured, considered good",                          indent: 1 },
      { id: "ka_doubtful",  label: "Doubtful",                                            indent: 1 },
      { id: "ka_less_prov", label: "Less: Provision for doubtful receivables",            indent: 2 },
      {
        id: "ka_total", label: "Total (A)", isTotal: true, indent: 1,
        formulaAdd: ["ka_secured","ka_unsecured","ka_doubtful"], formulaSub: ["ka_less_prov"],
      },
      { id: "kb_hdr",       label: "(B) Outstanding for more than 6 months",              isSectionHeader: true },
      { id: "kb_secured",   label: "Secured, considered good",                            indent: 1 },
      { id: "kb_unsecured", label: "Unsecured, considered good",                          indent: 1 },
      { id: "kb_doubtful",  label: "Doubtful",                                            indent: 1 },
      { id: "kb_less_prov", label: "Less: Provision for doubtful receivables",            indent: 2 },
      { id: "kb_unbilled",  label: "Unbilled receivables",                                indent: 1 },
      {
        id: "kb_total", label: "Total (B)", isTotal: true, indent: 1,
        formulaAdd: ["kb_secured","kb_unsecured","kb_doubtful","kb_unbilled"],
        formulaSub: ["kb_less_prov"],
      },
      {
        id: "total_ab", label: "Total (A + B)", isTotal: true,
        formulaAdd: ["ka_total","kb_total"],
      },
    ],
  },

  // ── Note: Cash & Bank Balances (Pattern B) ──────────────────────────────
  {
    noteType: "cash_bank",
    title: "Note 19: Cash and Bank Balances",
    pattern: "B",
    rows: [
      { id: "la_hdr",       label: "(A) Cash and Cash Equivalents",               isSectionHeader: true },
      { id: "la_current",   label: "Balance in current account",                  indent: 1 },
      { id: "la_cc",        label: "Balance in cash credit account",              indent: 1 },
      { id: "la_fd_3m",     label: "Fixed deposits with maturity < 3 months",     indent: 1 },
      { id: "la_cheques",   label: "Cheques / drafts in hand",                    indent: 1 },
      { id: "la_cash",      label: "Cash in hand",                                indent: 1 },
      {
        id: "la_total", label: "Total (A)", isTotal: true, indent: 1,
        formulaAdd: ["la_current","la_cc","la_fd_3m","la_cheques","la_cash"],
      },
      { id: "lb_hdr",       label: "(B) Other Bank Balances",                     isSectionHeader: true },
      { id: "lb_earmarked", label: "Earmarked balances (e.g., unpaid dividends)", indent: 1 },
      { id: "lb_fd_3_12",   label: "Fixed deposits with maturity 3–12 months",    indent: 1 },
      { id: "lb_margin",    label: "Margin money deposits",                        indent: 1 },
      { id: "lb_others",    label: "Others",                                       indent: 1 },
      {
        id: "lb_total", label: "Total (B)", isTotal: true, indent: 1,
        formulaAdd: ["lb_earmarked","lb_fd_3_12","lb_margin","lb_others"],
      },
      {
        id: "total_ab", label: "Total (A + B)", isTotal: true,
        formulaAdd: ["la_total","lb_total"],
      },
    ],
  },

  // ── Note: Other Current Assets (Pattern B) ──────────────────────────────
  {
    noteType: "other_ca",
    title: "Note 21: Other Current Assets",
    pattern: "B",
    rows: [
      { id: "specify", label: "Specify nature" },
      { id: "total",   label: "Total", isTotal: true, formulaAdd: ["specify"] },
    ],
  },

  // ── Note: Revenue from Operations (Pattern B) ───────────────────────────
  {
    noteType: "revenue_ops",
    title: "Note 22: Revenue from Operations",
    pattern: "B",
    rows: [
      { id: "sale_products", label: "Sale of products" },
      { id: "sale_services", label: "Sale of services" },
      { id: "other_ops",     label: "Other operations" },
      { id: "other_op_rev",  label: "Other operating revenue" },
      { id: "other_adj",     label: "Other adjustments" },
      {
        id: "total", label: "Total", isTotal: true,
        formulaAdd: ["sale_products","sale_services","other_ops","other_op_rev","other_adj"],
      },
    ],
  },

  // ── Note: Other Income (Pattern B) ──────────────────────────────────────
  {
    noteType: "other_income",
    title: "Note 23: Other Income",
    pattern: "B",
    rows: [
      { id: "interest",     label: "Interest income" },
      { id: "dividend",     label: "Dividend income" },
      { id: "net_gain",     label: "Net gain on sale of investments" },
      { id: "other_non_op", label: "Other non-operating income" },
      {
        id: "total", label: "Total", isTotal: true,
        formulaAdd: ["interest","dividend","net_gain","other_non_op"],
      },
    ],
  },

  // ── Note: Cost of Goods Sold (Pattern B — multi-level) ──────────────────
  {
    noteType: "cogs",
    title: "Note 24: Cost of Goods Sold",
    pattern: "B",
    rows: [
      { id: "pa_hdr",         label: "(A) Cost of Materials Consumed",                     isSectionHeader: true },
      { id: "raw_open",       label: "Opening stock of raw materials",                     indent: 1 },
      { id: "raw_purch",      label: "Add: Purchases of raw materials",                   indent: 2 },
      { id: "raw_close",      label: "Less: Closing stock of raw materials",              indent: 2 },
      {
        id: "raw_consumed", label: "Raw material consumed (a)", isTotal: true, indent: 1,
        formulaAdd: ["raw_open","raw_purch"], formulaSub: ["raw_close"],
      },
      { id: "pack_open",      label: "Opening stock of packing materials",                 indent: 1 },
      { id: "pack_purch",     label: "Add: Purchases of packing materials",               indent: 2 },
      { id: "pack_close",     label: "Less: Closing stock of packing materials",          indent: 2 },
      {
        id: "pack_consumed", label: "Packing material consumed (b)", isTotal: true, indent: 1,
        formulaAdd: ["pack_open","pack_purch"], formulaSub: ["pack_close"],
      },
      { id: "other_open",     label: "Opening stock of other materials",                   indent: 1 },
      { id: "other_purch",    label: "Add: Purchases of other materials",                 indent: 2 },
      { id: "other_close",    label: "Less: Closing stock of other materials",            indent: 2 },
      {
        id: "other_consumed", label: "Other material consumed (c)", isTotal: true, indent: 1,
        formulaAdd: ["other_open","other_purch"], formulaSub: ["other_close"],
      },
      {
        id: "pa_total", label: "Total (A = a + b + c)", isTotal: true,
        formulaAdd: ["raw_consumed","pack_consumed","other_consumed"],
      },
      { id: "pb_hdr",         label: "(B) Purchases of Stock-in-Trade",                    isSectionHeader: true },
      { id: "pb_row1",        label: "Purchases (category 1)",                            indent: 1 },
      { id: "pb_row2",        label: "Purchases (category 2)",                            indent: 1 },
      { id: "pb_row3",        label: "Purchases (category 3)",                            indent: 1 },
      { id: "pb_total",       label: "Total (B)", isTotal: true, formulaAdd: ["pb_row1","pb_row2","pb_row3"] },
      { id: "pc_hdr",         label: "(C) Changes in Inventories of Finished Goods, WIP & Stock-in-Trade", isSectionHeader: true },
      { id: "pc_i_hdr",       label: "Opening Inventories (I)",                           isSectionHeader: true, indent: 1 },
      { id: "pc_open_trade",  label: "Opening: Stock-in-trade",                           indent: 2 },
      { id: "pc_open_wip",    label: "Opening: Work-in-progress",                         indent: 2 },
      { id: "pc_open_fg",     label: "Opening: Finished goods",                           indent: 2 },
      {
        id: "pc_i_total", label: "Total Opening (I)", isTotal: true, indent: 1,
        formulaAdd: ["pc_open_trade","pc_open_wip","pc_open_fg"],
      },
      { id: "pc_ii_hdr",      label: "Closing Inventories (II)",                          isSectionHeader: true, indent: 1 },
      { id: "pc_close_trade", label: "Closing: Stock-in-trade",                           indent: 2 },
      { id: "pc_close_wip",   label: "Closing: Work-in-progress",                         indent: 2 },
      { id: "pc_close_fg",    label: "Closing: Finished goods",                           indent: 2 },
      {
        id: "pc_ii_total", label: "Total Closing (II)", isTotal: true, indent: 1,
        formulaAdd: ["pc_close_trade","pc_close_wip","pc_close_fg"],
      },
      {
        id: "pc_total", label: "(Increase) / Decrease in Inventories  (C = I − II)", isTotal: true,
        formulaAdd: ["pc_i_total"], formulaSub: ["pc_ii_total"],
      },
      {
        id: "total_abc", label: "Total (A + B + C)", isTotal: true,
        formulaAdd: ["pa_total","pb_total","pc_total"],
      },
    ],
  },

  // ── Note: Employee Benefits Expense (Pattern B) ─────────────────────────
  {
    noteType: "employee_exp",
    title: "Note 25: Employee Benefits Expense",
    pattern: "B",
    rows: [
      { id: "salaries",      label: "Salaries, wages and bonus" },
      { id: "pf",            label: "Contribution to provident fund" },
      { id: "gratuity",      label: "Gratuity" },
      { id: "staff_welfare", label: "Staff welfare expenses" },
      { id: "other_allow",   label: "Other allowances" },
      {
        id: "total", label: "Total", isTotal: true,
        formulaAdd: ["salaries","pf","gratuity","staff_welfare","other_allow"],
      },
    ],
  },

  // ── Note: Finance Costs (Pattern B) ─────────────────────────────────────
  {
    noteType: "finance_costs",
    title: "Note 26: Finance Costs",
    pattern: "B",
    rows: [
      { id: "int_bank",        label: "Interest on bank borrowings" },
      { id: "int_lease",       label: "Interest on finance leases" },
      { id: "int_other",       label: "Interest on other borrowings" },
      { id: "bank_charges",    label: "Bank charges" },
      { id: "disc_charges",    label: "Finance charges — Discounting" },
      { id: "guarantee",       label: "Finance charges — Guarantee" },
      { id: "other_fin",       label: "Finance charges — Other" },
      { id: "int_partners",    label: "Interest on partners' capital" },
      { id: "other_borrowing", label: "Other borrowing costs" },
      { id: "fx_loss",         label: "Foreign exchange loss on financing" },
      {
        id: "total", label: "Total", isTotal: true,
        formulaAdd: ["int_bank","int_lease","int_other","bank_charges","disc_charges",
                     "guarantee","other_fin","int_partners","other_borrowing","fx_loss"],
      },
    ],
  },

  // ── Note: Other Expenses (Pattern B) ────────────────────────────────────
  {
    noteType: "other_expenses",
    title: "Note 28: Other Expenses",
    pattern: "B",
    rows: [
      { id: "stores_spares",   label: "Stores and spares consumed" },
      { id: "power",           label: "Power and fuel" },
      { id: "rent",            label: "Rent" },
      { id: "repairs_bldg",    label: "Repairs — Buildings" },
      { id: "repairs_mach",    label: "Repairs — Machinery" },
      { id: "insurance",       label: "Insurance" },
      { id: "rates_taxes",     label: "Rates and taxes" },
      { id: "labour",          label: "Labour charges" },
      { id: "travel",          label: "Travelling and conveyance" },
      { id: "auditor_rem",     label: "Auditor's remuneration" },
      { id: "printing",        label: "Printing and stationery" },
      { id: "communication",   label: "Communication expenses" },
      { id: "legal",           label: "Legal and professional charges" },
      { id: "advertisement",   label: "Advertisement" },
      { id: "biz_promotion",   label: "Business promotion expenses" },
      { id: "commission",      label: "Commission" },
      { id: "clearing_fwd",    label: "Clearing and forwarding charges" },
      { id: "ppe_loss",        label: "Loss on sale / discard of PPE" },
      { id: "fx_loss_ops",     label: "Foreign exchange loss (operations)" },
      { id: "contract_cancel", label: "Contract cancellation loss" },
      { id: "invest_loss",     label: "Loss on investments" },
      { id: "diminution",      label: "Provision for diminution in investments" },
      { id: "doubtful_debt",   label: "Provision for doubtful debts" },
      { id: "miscellaneous",   label: "Miscellaneous expenses" },
      { id: "other_exp",       label: "Other expenses" },
      {
        id: "total", label: "Total", isTotal: true,
        formulaAdd: ["stores_spares","power","rent","repairs_bldg","repairs_mach",
                     "insurance","rates_taxes","labour","travel","auditor_rem","printing",
                     "communication","legal","advertisement","biz_promotion","commission",
                     "clearing_fwd","ppe_loss","fx_loss_ops","contract_cancel","invest_loss",
                     "diminution","doubtful_debt","miscellaneous","other_exp"],
      },
    ],
  },
];

/**
 * Compute auto-calculated totals from raw data.
 *   Pattern B: cy[rowId], py[rowId]
 *   Pattern A: cy[rowId + "_lt"], cy[rowId + "_st"], py[rowId + "_lt"], py[rowId + "_st"]
 * Rows must be ordered so dependent totals come after their sources.
 *
 * @param customRows  Custom rows (auto + manual). Each may carry an optional
 *   `section` tag (e.g. "secured" | "unsecured") that routes its amount into
 *   the matching section-total row (identified by `NoteRowDef.sectionTag`)
 *   rather than the grand total. Untagged rows go into the grand total only.
 */
export function computeDisplayData(
  config: NoteConfig,
  cy: Record<string, number>,
  py: Record<string, number>,
  customRows?: Array<{ id: string; section?: string }>,
): { cy: Record<string, number>; py: Record<string, number> } {
  const outCy = { ...cy };
  const outPy = { ...py };

  // Find the ID of the grand-total row (last isTotal row in the config)
  const grandTotalId = [...config.rows].reverse().find(r => r.isTotal)?.id ?? null;

  for (const row of config.rows) {
    if (!row.isTotal) continue;
    const adds = row.formulaAdd ?? [];
    const subs = row.formulaSub ?? [];

    // Determine which custom rows contribute to THIS total:
    //   • Section-total (sectionTag set)  → custom rows tagged with that section
    //   • Grand-total (last isTotal)       → custom rows with NO section tag
    //   • Intermediate sub-totals          → no custom rows (avoids double-count)
    let extras: string[] = [];
    if (row.sectionTag && customRows?.length) {
      extras = customRows.filter(cr => cr.section === row.sectionTag).map(cr => cr.id);
    } else if (row.id === grandTotalId && customRows?.length) {
      extras = customRows.filter(cr => !cr.section).map(cr => cr.id);
    }

    if (config.pattern === "B") {
      let cVal = 0, pVal = 0;
      for (const id of adds)   { cVal += outCy[id] ?? 0; pVal += outPy[id] ?? 0; }
      for (const id of subs)   { cVal -= outCy[id] ?? 0; pVal -= outPy[id] ?? 0; }
      for (const id of extras) { cVal += outCy[id] ?? 0; pVal += outPy[id] ?? 0; }
      outCy[row.id] = Math.round(cVal * 100) / 100;
      outPy[row.id] = Math.round(pVal * 100) / 100;
    } else {
      let ltC = 0, ltP = 0, stC = 0, stP = 0;
      for (const id of adds) {
        ltC += outCy[id + "_lt"] ?? 0; ltP += outPy[id + "_lt"] ?? 0;
        stC += outCy[id + "_st"] ?? 0; stP += outPy[id + "_st"] ?? 0;
      }
      for (const id of subs) {
        ltC -= outCy[id + "_lt"] ?? 0; ltP -= outPy[id + "_lt"] ?? 0;
        stC -= outCy[id + "_st"] ?? 0; stP -= outPy[id + "_st"] ?? 0;
      }
      for (const id of extras) {
        ltC += outCy[id + "_lt"] ?? 0; ltP += outPy[id + "_lt"] ?? 0;
        stC += outCy[id + "_st"] ?? 0; stP += outPy[id + "_st"] ?? 0;
      }
      outCy[row.id + "_lt"] = Math.round(ltC * 100) / 100;
      outPy[row.id + "_lt"] = Math.round(ltP * 100) / 100;
      outCy[row.id + "_st"] = Math.round(stC * 100) / 100;
      outPy[row.id + "_st"] = Math.round(stP * 100) / 100;
    }
  }
  return { cy: outCy, py: outPy };
}
