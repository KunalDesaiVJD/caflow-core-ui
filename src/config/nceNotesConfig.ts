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
  /**
   * When set, data for this note is read from this other noteType in the DB.
   * Used for LT/ST split display: both borrowings_lt and borrowings_st read
   * from the "borrowings" DB record, extracting _lt or _st suffix values.
   */
  sourceNoteType?: string;
  /**
   * When set, indicates this is one side of a Pattern A split.
   * "lt" → read keys with _lt suffix (long-term column only)
   * "st" → read keys with _st suffix (short-term column only)
   */
  splitSide?: "lt" | "st";
  hidden?: boolean;
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
  borrowings_lt:     { noteNumber: "3",       shortName: "Long-Term Borrowings",          section: "BS" },
  other_lt_liab:     { noteNumber: "4",       shortName: "Other Long-Term Liabilities",   section: "BS" },
  provisions_lt:     { noteNumber: "5",       shortName: "Long-Term Provisions",          section: "BS" },
  borrowings_st:     { noteNumber: "6",       shortName: "Short-Term Borrowings",         section: "BS" },
  trade_payables:    { noteNumber: "7",       shortName: "Trade Payables",                section: "BS" },
  other_cl:          { noteNumber: "8",       shortName: "Other Current Liabilities",     section: "BS" },
  provisions_st:     { noteNumber: "9",       shortName: "Short-Term Provisions",         section: "BS" },
  cwip:              { noteNumber: "11",      shortName: "Capital Work-in-Progress",      section: "BS" },
  investments:       { noteNumber: "13",      shortName: "Non-Current Investments",       section: "BS" },
  loans_advances_lt: { noteNumber: "14",       shortName: "Long-Term Loans and Advances",  section: "BS" },
  loans_advances_st: { noteNumber: "20",       shortName: "Short-Term Loans and Advances", section: "BS" },
  other_nc_assets:   { noteNumber: "15",      shortName: "Other Non-Current Assets",      section: "BS" },
  inventories:       { noteNumber: "17",      shortName: "Inventories",                   section: "BS" },
  trade_receivables: { noteNumber: "18",      shortName: "Trade Receivables",             section: "BS" },
  cash_bank:         { noteNumber: "19",      shortName: "Cash and Bank Balances",        section: "BS" },
  other_ca:          { noteNumber: "21",      shortName: "Other Current Assets",          section: "BS" },
  revenue_ops:       { noteNumber: "22",      shortName: "Revenue from Operations",       section: "PL" },
  other_income:      { noteNumber: "23",      shortName: "Other Income",                  section: "PL" },
  cogs_a:            { noteNumber: "24",      shortName: "Cost of Materials Consumed",                                     section: "PL" },
  cogs_b:            { noteNumber: "25",      shortName: "Purchases of Stock-in-Trade",                                    section: "PL" },
  cogs_c:            { noteNumber: "26",      shortName: "Changes in Inventories of FG, WIP & Stock-in-Trade",             section: "PL" },
  employee_exp:      { noteNumber: "27",      shortName: "Employee Benefits Expense",     section: "PL" },
  finance_costs:     { noteNumber: "28",      shortName: "Finance Costs",                 section: "PL" },
  other_expenses:    { noteNumber: "30",      shortName: "Other Expenses",                section: "PL" },
};

// ─── Helper: given Pattern A data saved under sourceNoteType, produce
//     Pattern B-compatible data by extracting _lt or _st suffixed keys.
export function extractSplitData(
  sourceData: { cy: Record<string, number>; py: Record<string, number> },
  side: "lt" | "st",
): { cy: Record<string, number>; py: Record<string, number> } {
  const suffix = `_${side}`;
  const outCy: Record<string, number> = {};
  const outPy: Record<string, number> = {};
  for (const key of Object.keys(sourceData.cy)) {
    if (key.endsWith(suffix)) {
      outCy[key.slice(0, -suffix.length)] = sourceData.cy[key];
    }
  }
  // Carry over _custom_rows so buildNoteSection / computeDisplayData can include
  // custom-row amounts in section totals. Each custom row's amount was already
  // extracted above (cr.id + suffix → cr.id in outCy); we just need the metadata
  // array so attachedRows() finds the rows and aggB/aggA include them in sums.
  // Without this, split notes (borrowings LT/ST, provisions LT/ST, loans_advances
  // LT/ST) always get customRows = [] → section totals = 0 → "—" in export.
  if (Array.isArray((sourceData.cy as any)._custom_rows)) {
    (outCy as any)._custom_rows = (sourceData.cy as any)._custom_rows;
  }
  for (const key of Object.keys(sourceData.py)) {
    if (key.endsWith(suffix)) {
      outPy[key.slice(0, -suffix.length)] = sourceData.py[key];
    }
  }
  return { cy: outCy, py: outPy };
}

// ─── Shared row definitions for borrowings (used by both LT and ST split notes)
const BORROWINGS_ROWS: NoteRowDef[] = [
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
    id: "sec_total", label: "Total", isTotal: true, sectionTag: "secured",
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
    id: "unsec_total", label: "Total", isTotal: true, sectionTag: "unsecured",
    formulaAdd: ["unsec_term_bank","unsec_term_fi","unsec_term_others","unsec_demand_bank",
                 "unsec_demand_other","unsec_deferred","unsec_related","unsec_other"],
  },
  { id: "total_ab", label: "Total", isTotal: true, formulaAdd: ["sec_total","unsec_total"] },
];

export const NOTES_CONFIG: NoteConfig[] = [
  // ── Note: Long-Term Borrowings (split from borrowings Pattern A) ─────────
  {
    noteType:       "borrowings_lt",
    sourceNoteType: "borrowings",
    splitSide:      "lt",
    title:          "Note 3: Long-Term Borrowings",
    pattern:        "B",
    rows:           BORROWINGS_ROWS,
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

  // ── Note: Long-Term Provisions (split from provisions Pattern A) ─────────
  // Task 5: simplified — all entries grouped under "Other Provisions"
  {
    noteType:       "provisions_lt",
    sourceNoteType: "provisions",
    splitSide:      "lt",
    title:          "Note 5: Long-Term Provisions",
    pattern:        "B",
    rows: [
      { id: "income_tax", label: "Provision for income tax" },
      { id: "other_prov", label: "Other Provisions" },
      {
        id: "total", label: "Total", isTotal: true,
        formulaAdd: ["income_tax","other_prov"],
      },
    ],
  },

  // ── Note: Short-Term Borrowings (split from borrowings Pattern A) ────────
  {
    noteType:       "borrowings_st",
    sourceNoteType: "borrowings",
    splitSide:      "st",
    title:          "Note 6: Short-Term Borrowings",
    pattern:        "B",
    rows:           BORROWINGS_ROWS,
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
  // Task 13: added "Revenue recognised on PCOS" and "Advance from Members" below "Other payables — Others"
  {
    noteType: "other_cl",
    title: "Note 8: Other Current Liabilities",
    pattern: "B",
    rows: [
      { id: "inc_advance",   label: "Income received in advance" },
      { id: "unearned",      label: "Unearned revenue" },
      { id: "gst_payable",   label: "GST payable" },
      { id: "tds_payable",   label: "TDS payable" },
      { id: "emp_payable",   label: "Other payables — Employees" },
      { id: "tax_payable",   label: "Other payables — Tax" },
      { id: "other_cl",      label: "Other payables — Others" },
      { id: "rev_pcos",      label: "Revenue recognised on PCOS" },
      { id: "adv_members",   label: "Advance from Members" },
      {
        id: "total", label: "Total", isTotal: true,
        formulaAdd: ["inc_advance","unearned","gst_payable","tds_payable",
                     "emp_payable","tax_payable","other_cl","rev_pcos","adv_members"],
      },
    ],
  },

  // ── Note: Short-Term Provisions (split from provisions Pattern A) ─────────
  // Task 5: simplified — all entries grouped under "Other Provisions"
  {
    noteType:       "provisions_st",
    sourceNoteType: "provisions",
    splitSide:      "st",
    title:          "Note 9: Short-Term Provisions",
    pattern:        "B",
    rows: [
      { id: "income_tax", label: "Provision for income tax" },
      { id: "other_prov", label: "Other Provisions" },
      {
        id: "total", label: "Total", isTotal: true,
        formulaAdd: ["income_tax","other_prov"],
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
        id: "quot_total", label: "Total Quoted", isTotal: true,
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
        id: "unquot_total", label: "Total Unquoted", isTotal: true,
        formulaAdd: ["unquot_property","unquot_equity","unquot_pref","unquot_govt",
                     "unquot_deb","unquot_mf","unquot_partner","unquot_other"],
      },
      {
        id: "total_ab", label: "Total NC Investments", isTotal: true,
        formulaAdd: ["quot_total","unquot_total"],
      },
    ],
  },

  // ── Note: Loans & Advances — shared row definitions ─────────────────────
  // Task 6: Separated into LT (Note 14) and ST (Note 20), mirroring the
  // borrowings/provisions split pattern. Both notes read from the same
  // "loans_advances" DB record (Pattern A); extractSplitData pulls the
  // _lt or _st suffix keys for each respective note.
  // ── Note: Long-Term Loans & Advances (split from loans_advances Pattern A) ─
  {
    noteType:       "loans_advances_lt",
    sourceNoteType: "loans_advances",
    splitSide:      "lt",
    title:          "Note 14: Long-Term Loans and Advances",
    pattern:        "B",
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
        id: "sec_total", label: "Total", isTotal: true, sectionTag: "secured",
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
        id: "unsec_total", label: "Total", isTotal: true, sectionTag: "unsecured",
        formulaAdd: ["unsec_cap_good","unsec_cap_doubt","unsec_related","unsec_prepaid",
                     "unsec_adv_tax","unsec_gst","unsec_security","unsec_govt","unsec_others"],
        formulaSub: ["unsec_cap_prov"],
      },
      { id: "total_ab", label: "Total", isTotal: true, formulaAdd: ["sec_total","unsec_total"] },
    ],
  },

  // ── Note: Short-Term Loans & Advances (split from loans_advances Pattern A) ─
  {
    noteType:       "loans_advances_st",
    sourceNoteType: "loans_advances",
    splitSide:      "st",
    title:          "Note 20: Short-Term Loans and Advances",
    pattern:        "B",
    rows: [
      { id: "sec_hdr",        label: "Secured",                                      isSectionHeader: true },
      { id: "sec_related",    label: "Advances to related parties",                  indent: 1 },
      { id: "sec_prepaid",    label: "Prepaid expenses",                             indent: 1 },
      { id: "sec_adv_tax",    label: "Advance tax / TDS",                            indent: 1 },
      { id: "sec_gst",        label: "GST input credit receivable",                  indent: 1 },
      { id: "sec_security",   label: "Security deposits",                            indent: 1 },
      { id: "sec_govt",       label: "Advances to government authorities",           indent: 1 },
      { id: "sec_others",     label: "Others",                                       indent: 1 },
      {
        id: "sec_total", label: "Total", isTotal: true, sectionTag: "secured",
        formulaAdd: ["sec_related","sec_prepaid","sec_adv_tax","sec_gst",
                     "sec_security","sec_govt","sec_others"],
      },
      { id: "unsec_hdr",        label: "Unsecured",                                    isSectionHeader: true },
      { id: "unsec_related",    label: "Advances to related parties",                  indent: 1 },
      { id: "unsec_prepaid",    label: "Prepaid expenses",                             indent: 1 },
      { id: "unsec_adv_tax",    label: "Advance tax / TDS",                            indent: 1 },
      { id: "unsec_gst",        label: "GST input credit receivable",                  indent: 1 },
      { id: "unsec_security",   label: "Security deposits",                            indent: 1 },
      { id: "unsec_govt",       label: "Advances to government authorities",           indent: 1 },
      { id: "unsec_others",     label: "Others",                                       indent: 1 },
      {
        id: "unsec_total", label: "Total", isTotal: true, sectionTag: "unsecured",
        formulaAdd: ["unsec_related","unsec_prepaid","unsec_adv_tax","unsec_gst",
                     "unsec_security","unsec_govt","unsec_others"],
      },
      { id: "total_ab", label: "Total", isTotal: true, formulaAdd: ["sec_total","unsec_total"] },
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
        id: "ka_total", label: "Total", isTotal: true, indent: 1,
        formulaAdd: ["ka_secured","ka_unsecured","ka_doubtful"], formulaSub: ["ka_less_prov"],
      },
      { id: "kb_hdr",       label: "(B) Outstanding for more than 6 months",              isSectionHeader: true },
      { id: "kb_secured",   label: "Secured, considered good",                            indent: 1 },
      { id: "kb_unsecured", label: "Unsecured, considered good",                          indent: 1 },
      { id: "kb_doubtful",  label: "Doubtful",                                            indent: 1 },
      { id: "kb_less_prov", label: "Less: Provision for doubtful receivables",            indent: 2 },
      { id: "kb_unbilled",  label: "Unbilled receivables",                                indent: 1 },
      {
        id: "kb_total", label: "Total", isTotal: true, indent: 1,
        formulaAdd: ["kb_secured","kb_unsecured","kb_doubtful","kb_unbilled"],
        formulaSub: ["kb_less_prov"],
      },
      {
        id: "total_ab", label: "Total", isTotal: true,
        formulaAdd: ["ka_total","kb_total"],
      },
    ],
  },

  // ── Note: Cash & Bank Balances (Pattern B) ──────────────────────────────
  // Task 14: removed "(B) Other Bank Balances" section; renamed FD row; renamed total
  {
    noteType: "cash_bank",
    title: "Note 19: Cash and Bank Balances",
    pattern: "B",
    rows: [
      { id: "la_hdr",     label: "(A) Cash and Cash Equivalents",  isSectionHeader: true },
      { id: "la_current", label: "Balance in current account",     indent: 1 },
      { id: "la_cc",      label: "Balance in cash credit account", indent: 1 },
      { id: "la_fd_3m",   label: "Fixed deposits",                 indent: 1 },
      { id: "la_cheques", label: "Cheques / drafts in hand",       indent: 1 },
      { id: "la_cash",    label: "Cash in hand",                   indent: 1 },
      {
        id: "total", label: "Total", isTotal: true,
        formulaAdd: ["la_current","la_cc","la_fd_3m","la_cheques","la_cash"],
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
  // Task 15: net sales presentation with deduction rows; "Other adjustments" → "Other"
  {
    noteType: "revenue_ops",
    title: "Note 22: Revenue from Operations",
    pattern: "B",
    rows: [
      { id: "sale_products",      label: "Sale of products" },
      { id: "less_sale_return",   label: "Less: Sale Return",                    indent: 1 },
      { id: "less_drcr_prod",     label: "Less: Dr/Cr Note & Rate difference",   indent: 1 },
      {
        id: "net_sale_products", label: "Net Sale of products", isTotal: true,
        formulaAdd: ["sale_products"], formulaSub: ["less_sale_return","less_drcr_prod"],
      },
      { id: "sale_services",      label: "Sale of services" },
      { id: "less_drcr_svc",      label: "Less: Dr/Cr Note & Rate difference",   indent: 1 },
      {
        id: "net_sale_services", label: "Net Sale of services", isTotal: true,
        formulaAdd: ["sale_services"], formulaSub: ["less_drcr_svc"],
      },
      { id: "other_op_rev",       label: "Other operating revenue" },
      { id: "other_adj",          label: "Other" },
      {
        id: "total", label: "Total", isTotal: true,
        formulaAdd: ["net_sale_products","net_sale_services","other_op_rev","other_adj"],
      },
    ],
  },

  // ── Note: Other Income (Pattern B) ──────────────────────────────────────
  // Task 16: Interest income broken into subcategories; removed "Interest On Deposit";
  //          "Net gain on sale of investments" → "Net gain / loss on sale of investments"
  {
    noteType: "other_income",
    title: "Note 23: Other Income",
    pattern: "B",
    rows: [
      { id: "interest",        label: "Interest income",                         isSectionHeader: true },
      { id: "bank_interest",   label: "Bank Interest Income",                    indent: 1 },
      { id: "other_interest",  label: "Other Interest Income",                   indent: 1 },
      {
        id: "total_interest", label: "Total Interest Income", isTotal: true,
        formulaAdd: ["bank_interest","other_interest"],
      },
      { id: "dividend",        label: "Dividend income" },
      { id: "net_gain",        label: "Net gain / loss on sale of investments" },
      { id: "other_non_op",    label: "Other non-operating income" },
      {
        id: "total", label: "Total", isTotal: true,
        formulaAdd: ["total_interest","dividend","net_gain","other_non_op"],
      },
    ],
  },

  // ── Note: Cost of Goods Sold (Pattern B — multi-level) ──────────────────
  // hidden: true — used for computation only; not shown in the editor.
  // cogs_a / cogs_b / cogs_c below are the display entries.
  {
    noteType: "cogs",
    title: "Note 24: Cost of Goods Sold",
    pattern: "B",
    hidden: true,
    rows: [
      // Task 7 (doc7): removed all (A)/(B)/(C)/(a)/(b)/(c)/(I)/(II) alphabet prefixes
      { id: "pa_hdr",         label: "Cost of Materials Consumed",                         isSectionHeader: true },
      { id: "raw_open",       label: "Opening stock of raw materials",                     indent: 1 },
      { id: "raw_purch",      label: "Add: Purchases of raw materials",                   indent: 2 },
      { id: "raw_close",      label: "Less: Closing stock of raw materials",              indent: 2 },
      {
        id: "raw_consumed", label: "Total raw material consumed", isTotal: true, indent: 1,
        formulaAdd: ["raw_open","raw_purch"], formulaSub: ["raw_close"],
      },
      { id: "pack_open",      label: "Opening stock of packing materials",                 indent: 1 },
      { id: "pack_purch",     label: "Add: Purchases of packing materials",               indent: 2 },
      { id: "pack_close",     label: "Less: Closing stock of packing materials",          indent: 2 },
      {
        id: "pack_consumed", label: "Total packing material consumed", isTotal: true, indent: 1,
        formulaAdd: ["pack_open","pack_purch"], formulaSub: ["pack_close"],
      },
      { id: "other_open",     label: "Opening stock of other materials",                   indent: 1 },
      { id: "other_purch",    label: "Add: Purchases of other materials",                 indent: 2 },
      { id: "other_close",    label: "Less: Closing stock of other materials",            indent: 2 },
      {
        id: "other_consumed", label: "Total other material consumed", isTotal: true, indent: 1,
        formulaAdd: ["other_open","other_purch"], formulaSub: ["other_close"],
      },
      {
        id: "pa_total", label: "Total", isTotal: true,
        formulaAdd: ["raw_consumed","pack_consumed","other_consumed"],
      },
      { id: "pb_hdr",         label: "Purchases of Stock-in-Trade",                        isSectionHeader: true },
      { id: "pb_row1",        label: "Purchases (category 1)",                            indent: 1 },
      { id: "pb_row2",        label: "Purchases (category 2)",                            indent: 1 },
      { id: "pb_row3",        label: "Purchases (category 3)",                            indent: 1 },
      { id: "pb_total",       label: "Total", isTotal: true, formulaAdd: ["pb_row1","pb_row2","pb_row3"] },
      { id: "pc_hdr",         label: "Changes in Inventories of Finished Goods, WIP & Stock-in-Trade", isSectionHeader: true },
      { id: "pc_i_hdr",       label: "Opening Inventories",                               isSectionHeader: true, indent: 1 },
      { id: "pc_open_trade",  label: "Opening: Stock-in-trade",                           indent: 2 },
      { id: "pc_open_wip",    label: "Opening: Work-in-progress",                         indent: 2 },
      { id: "pc_open_fg",     label: "Opening: Finished goods",                           indent: 2 },
      {
        id: "pc_i_total", label: "Total Opening", isTotal: true, indent: 1,
        formulaAdd: ["pc_open_trade","pc_open_wip","pc_open_fg"],
      },
      { id: "pc_ii_hdr",      label: "Closing Inventories",                               isSectionHeader: true, indent: 1 },
      { id: "pc_close_trade", label: "Closing: Stock-in-trade",                           indent: 2 },
      { id: "pc_close_wip",   label: "Closing: Work-in-progress",                         indent: 2 },
      { id: "pc_close_fg",    label: "Closing: Finished goods",                           indent: 2 },
      {
        id: "pc_ii_total", label: "Total Closing", isTotal: true, indent: 1,
        formulaAdd: ["pc_close_trade","pc_close_wip","pc_close_fg"],
      },
      {
        id: "pc_total", label: "(Increase) / Decrease in Inventories", isTotal: true,
        formulaAdd: ["pc_i_total"], formulaSub: ["pc_ii_total"],
      },
      {
        id: "total_abc", label: "Total", isTotal: true,
        formulaAdd: ["pa_total","pb_total","pc_total"],
      },
    ],
  },

  // ── Note: Cost of Materials Consumed (cogs_a) ──
  {
    noteType: "cogs_a",
    sourceNoteType: "cogs",
    title: "Note 24: Cost of Materials Consumed",
    pattern: "B" as const,
    rows: [
      { id: "pa_hdr",         label: "Cost of Materials Consumed",                         isSectionHeader: true },
      { id: "raw_open",       label: "Opening stock of raw materials",                     indent: 1 },
      { id: "raw_purch",      label: "Add: Purchases of raw materials",                    indent: 2 },
      { id: "raw_close",      label: "Less: Closing stock of raw materials",               indent: 2 },
      {
        id: "raw_consumed", label: "Total raw material consumed", isTotal: true, indent: 1,
        formulaAdd: ["raw_open","raw_purch"], formulaSub: ["raw_close"],
      },
      { id: "pack_open",      label: "Opening stock of packing materials",                 indent: 1 },
      { id: "pack_purch",     label: "Add: Purchases of packing materials",                indent: 2 },
      { id: "pack_close",     label: "Less: Closing stock of packing materials",           indent: 2 },
      {
        id: "pack_consumed", label: "Total packing material consumed", isTotal: true, indent: 1,
        formulaAdd: ["pack_open","pack_purch"], formulaSub: ["pack_close"],
      },
      { id: "other_open",     label: "Opening stock of other materials",                   indent: 1 },
      { id: "other_purch",    label: "Add: Purchases of other materials",                  indent: 2 },
      { id: "other_close",    label: "Less: Closing stock of other materials",             indent: 2 },
      {
        id: "other_consumed", label: "Total other material consumed", isTotal: true, indent: 1,
        formulaAdd: ["other_open","other_purch"], formulaSub: ["other_close"],
      },
      {
        id: "pa_total", label: "Total", isTotal: true,
        formulaAdd: ["raw_consumed","pack_consumed","other_consumed"],
      },
    ],
  },

  // ── Note: Purchases of Stock-in-Trade (cogs_b) ──
  {
    noteType: "cogs_b",
    sourceNoteType: "cogs",
    title: "Note 25: Purchases of Stock-in-Trade",
    pattern: "B" as const,
    rows: [
      { id: "pb_hdr",         label: "Purchases of Stock-in-Trade",                        isSectionHeader: true },
      { id: "pb_row1",        label: "Purchases (category 1)",                             indent: 1 },
      { id: "pb_row2",        label: "Purchases (category 2)",                             indent: 1 },
      { id: "pb_row3",        label: "Purchases (category 3)",                             indent: 1 },
      { id: "pb_total",       label: "Total", isTotal: true, formulaAdd: ["pb_row1","pb_row2","pb_row3"] },
    ],
  },

  // ── Note: Changes in Inventories (cogs_c) ──
  {
    noteType: "cogs_c",
    sourceNoteType: "cogs",
    title: "Note 26: Changes in Inventories of FG, WIP & Stock-in-Trade",
    pattern: "B" as const,
    rows: [
      { id: "pc_hdr",         label: "Changes in Inventories of Finished Goods, WIP & Stock-in-Trade", isSectionHeader: true },
      { id: "pc_i_hdr",       label: "Opening Inventories",                               isSectionHeader: true, indent: 1 },
      { id: "pc_open_trade",  label: "Opening: Stock-in-trade",                           indent: 2 },
      { id: "pc_open_wip",    label: "Opening: Work-in-progress",                         indent: 2 },
      { id: "pc_open_fg",     label: "Opening: Finished goods",                           indent: 2 },
      {
        id: "pc_i_total", label: "Total Opening", isTotal: true, indent: 1,
        formulaAdd: ["pc_open_trade","pc_open_wip","pc_open_fg"],
      },
      { id: "pc_ii_hdr",      label: "Closing Inventories",                               isSectionHeader: true, indent: 1 },
      { id: "pc_close_trade", label: "Closing: Stock-in-trade",                           indent: 2 },
      { id: "pc_close_wip",   label: "Closing: Work-in-progress",                         indent: 2 },
      { id: "pc_close_fg",    label: "Closing: Finished goods",                           indent: 2 },
      {
        id: "pc_ii_total", label: "Total Closing", isTotal: true, indent: 1,
        formulaAdd: ["pc_close_trade","pc_close_wip","pc_close_fg"],
      },
      {
        id: "pc_total", label: "(Increase) / Decrease in Inventories", isTotal: true,
        formulaAdd: ["pc_i_total"], formulaSub: ["pc_ii_total"],
      },
    ],
  },

  // ── Note: Employee Benefits Expense (Pattern B) ─────────────────────────
  {
    noteType: "employee_exp",
    title: "Note 27: Employee Benefits Expense",
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
    title: "Note 28: Finance Costs",
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
    title: "Note 30: Other Expenses",
    pattern: "B",
    // KD8: line items arranged alphabetically (A → Z); Total stays last.
    rows: [
      { id: "advertisement",   label: "Advertisement" },
      { id: "auditor_rem",     label: "Auditor's remuneration" },
      { id: "biz_promotion",   label: "Business promotion expenses" },
      { id: "clearing_fwd",    label: "Clearing and forwarding charges" },
      { id: "commission",      label: "Commission" },
      { id: "communication",   label: "Communication expenses" },
      { id: "contract_cancel", label: "Contract cancellation loss" },
      { id: "fx_loss_ops",     label: "Foreign exchange loss (operations)" },
      { id: "insurance",       label: "Insurance" },
      { id: "labour",          label: "Labour charges" },
      { id: "legal",           label: "Legal and professional charges" },
      { id: "invest_loss",     label: "Loss on investments" },
      { id: "ppe_loss",        label: "Loss on sale / discard of PPE" },
      { id: "miscellaneous",   label: "Miscellaneous expenses" },
      { id: "other_exp",       label: "Other expenses" },
      { id: "power",           label: "Power and fuel" },
      { id: "printing",        label: "Printing and stationery" },
      { id: "diminution",      label: "Provision for diminution in investments" },
      { id: "doubtful_debt",   label: "Provision for doubtful debts" },
      { id: "rates_taxes",     label: "Rates and taxes" },
      { id: "rent",            label: "Rent" },
      { id: "repairs_bldg",    label: "Repairs — Buildings" },
      { id: "repairs_mach",    label: "Repairs — Machinery" },
      { id: "stores_spares",   label: "Stores and spares consumed" },
      { id: "travel",          label: "Travelling and conveyance" },
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
    //     BUT only rows NOT already attached to a static parent (those are counted
    //     via the parent's own contribution in formulaAdd, avoiding double-count).
    //   • Grand-total (last isTotal)       → custom rows with NO section tag
    //   • Intermediate sub-totals          → no custom rows (avoids double-count)
    let extras: string[] = [];
    if (row.sectionTag && customRows?.length) {
      extras = customRows
        .filter(cr => cr.section === row.sectionTag && !cr.attachedTo)
        .map(cr => cr.id);
    } else if (row.id === grandTotalId && customRows?.length) {
      extras = customRows.filter(cr => !cr.section && !cr.attachedTo).map(cr => cr.id);
    }

    if (config.pattern === "B") {
      let cVal = 0, pVal = 0;
      for (const id of adds) {
        cVal += outCy[id] ?? 0; pVal += outPy[id] ?? 0;
        // ROOT-CAUSE FIX (Trade Payables / Other Current Liabilities total = 0):
        // breakup ledgers now attach to a catch-all static row (e.g. "Others"),
        // and that static row's own value is ZEROED to avoid double-count — the
        // children hold the amounts. So the Total MUST add the children of each
        // summed row, exactly like Pattern A does. Without this the note Total
        // and the FS face (which reads this) showed blank even though the
        // ledgers were mapped. Mirrors the Pattern A attached-row logic below.
        if (customRows) {
          for (const cr of customRows) {
            if (cr.attachedTo !== id) continue;
            cVal += outCy[cr.id] ?? 0; pVal += outPy[cr.id] ?? 0;
          }
        }
      }
      for (const id of subs)   { cVal -= outCy[id] ?? 0; pVal -= outPy[id] ?? 0; }
      for (const id of extras) { cVal += outCy[id] ?? 0; pVal += outPy[id] ?? 0; }
      outCy[row.id] = Math.round(cVal * 100) / 100;
      outPy[row.id] = Math.round(pVal * 100) / 100;
    } else {
      let ltC = 0, ltP = 0, stC = 0, stP = 0;
      // ROOT-CAUSE FIX (provisions LT phantom amount): the bare-key fallback
      // (`outCy[cr.id]`) on the LT branch causes amounts saved without a
      // suffix to leak into BOTH columns. e.g. a manual "Unpaid Audit Fees"
      // row saved with cy[id] = 20000 AND cy[id + "_st"] = 20000 produced
      // ltC += 20000 (bare fallback) and stC += 20000 — doubling the total.
      // Use bare-key fallback ONLY when NEITHER _lt NOR _st key exists; if
      // either suffix is present the row is suffix-aware and the bare key
      // is legacy noise. Applies symmetrically to extras (sectionless rows).
      const lookupSuffixed = (
        baseCy: Record<string, number>,
        basePy: Record<string, number>,
        id: string,
      ) => {
        const ltKey = id + "_lt", stKey = id + "_st";
        const hasLt = ltKey in baseCy;
        const hasSt = stKey in baseCy;
        const useBare = !hasLt && !hasSt;
        return {
          ltCy: baseCy[ltKey] ?? (useBare ? baseCy[id] ?? 0 : 0),
          ltPy: basePy[ltKey] ?? (useBare ? basePy[id] ?? 0 : 0),
          stCy: baseCy[stKey] ?? 0,
          stPy: basePy[stKey] ?? 0,
        };
      };
      for (const id of adds) {
        ltC += outCy[id + "_lt"] ?? 0; ltP += outPy[id + "_lt"] ?? 0;
        stC += outCy[id + "_st"] ?? 0; stP += outPy[id + "_st"] ?? 0;
        // Also include custom rows formally attached to this static row.
        // These are excluded from extras (see above) to prevent double-counting.
        if (customRows) {
          for (const cr of customRows) {
            if (cr.attachedTo !== id) continue;
            const v = lookupSuffixed(outCy, outPy, cr.id);
            ltC += v.ltCy; ltP += v.ltPy;
            stC += v.stCy; stP += v.stPy;
          }
        }
      }
      for (const id of subs) {
        ltC -= outCy[id + "_lt"] ?? 0; ltP -= outPy[id + "_lt"] ?? 0;
        stC -= outCy[id + "_st"] ?? 0; stP -= outPy[id + "_st"] ?? 0;
      }
      for (const id of extras) {
        const v = lookupSuffixed(outCy, outPy, id);
        ltC += v.ltCy; ltP += v.ltPy;
        stC += v.stCy; stP += v.stPy;
      }
      outCy[row.id + "_lt"] = Math.round(ltC * 100) / 100;
      outPy[row.id + "_lt"] = Math.round(ltP * 100) / 100;
      outCy[row.id + "_st"] = Math.round(stC * 100) / 100;
      outPy[row.id + "_st"] = Math.round(stP * 100) / 100;
    }
  }
  return { cy: outCy, py: outPy };
}
