/**
 * nceNoteRegistry — Phase 6: the SINGLE source of truth for NCE note → FS-code
 * wiring + sign nature. Five maps that used to be hand-maintained in three
 * different files (and drifted) are now DERIVED from one table here:
 *
 *   • NCE_NOTE_FS_MAP   (nceAutoPopulate)   ← buildNoteFsMap()
 *   • NOTE_NATURE       (fsSignConvention)  ← buildNoteNature()
 *   • FS_CODE_NATURE    (fsSignConvention, NCE half)  ← buildNceFsCodeNature()
 *   • CANONICAL_NCE_CODE(fsReconciliation)  ← buildCanonicalNceCode()
 *   • NCE_LIAB_CODE_SET (fsReconciliation)  ← buildNceLiabCodeSet()
 *
 * CRITICAL — this module is a STRICT LEAF: it imports NOTHING from
 * fsSignConvention / nceAutoPopulate / fsReconciliation / nceNotesConfig /
 * nceLineItems. A back-edge would close an ES-module init cycle that, under
 * hoisting, leaves NOTE_NATURE/FS_CODE_NATURE `undefined` at first read →
 * resolveNature falls back to "CR" for EVERYTHING → every Dr asset/expense is
 * silently signed Cr → the whole BS mis-states with no error. Keep it a leaf.
 * (nceNoteRegistry.parity.test.ts proves every builder reproduces the current
 * literal byte-for-byte BEFORE any literal is swapped to a builder.)
 *
 * NCE_CODE_TO_NOTE is deliberately NOT derived here — it carries a config
 * discriminator (cogs_a/cogs_c) and the NCE_CII dual-role that the code lists
 * can't express. It stays a hand-literal in nceAutoPopulate; the parity test's
 * dual-role + twin-survival cases keep the two consistent.
 */

export type FsNature = "DR" | "CR";

interface NceNoteDef {
  note:    string;
  nature:  FsNature;
  /** Pattern-B single column. */
  all?:    string[];
  /** Pattern-A long-term column. */
  lt?:     string[];
  /** Pattern-A short-term column. */
  st?:     string[];
}

/**
 * Equity / Capital-Account codes own NO note (they are not in any NCE_NOTE_FS_MAP
 * list). They contribute to FS_CODE_NATURE and NCE_LIAB_CODE_SET, but must NEVER
 * be folded by buildCanonicalNceCode (they are distinct real codes, not twins —
 * NCE_CAP is the Owners' Capital BS line the residual absorber plugs into).
 */
const NCE_EQUITY_CODES: { code: string; nature: FsNature }[] = [
  { code: "NCE_PCAP", nature: "CR" },
  { code: "NCE_RES",  nature: "CR" },
  { code: "NCE_NCB",  nature: "CR" },
  { code: "NCE_CAP",  nature: "CR" },
];

/**
 * RC1 (2026-06-22) — DIRECT Dr-natural codes that own NO note. PPE / Intangibles
 * come from the FA schedule; Depreciation, Partner Remuneration, the tax block
 * and Exceptional / Extraordinary items are direct P&L leaves with no note table.
 * They were ABSENT from NCE_NOTE_REGISTRY, so computeCOATotals (which passes a
 * bare code to signedBalance when CODE_TO_NOTE_TYPE misses) defaulted them to
 * "CR" and signed every Dr balance NEGATIVE — contaminating the COA anchor for
 * PPE/depreciation/tax across ~20 engagements.
 *
 * Like NCE_EQUITY_CODES, these feed ONLY buildNceFsCodeNature (so resolveNature
 * can find them via the FS_CODE_NATURE fallback). They are NEVER folded
 * (buildCanonicalNceCode), never gain a phantom note (buildNoteFsMap), and never
 * enter the liability set (buildNceLiabCodeSet) — they are Dr assets/expenses.
 */
const NCE_DIRECT_CODES: { code: string; nature: FsNature }[] = [
  { code: "NCE_PPE",       nature: "DR" },
  { code: "NCE_INTG",      nature: "DR" },
  { code: "NCE_DEPR",      nature: "DR" },
  { code: "NCE_PART_REM",  nature: "DR" },
  { code: "NCE_CUR_TAX",   nature: "DR" },
  { code: "NCE_PRIOR_TAX", nature: "DR" },
  { code: "NCE_DEFER_TAX", nature: "DR" },
  { code: "NCE_EXCEP",     nature: "DR" },
  { code: "NCE_EXTORD",    nature: "DR" },
];

/**
 * The authoritative table. Each list's FIRST element is the canonical NCE_* code;
 * the rest are corporate / INV twins that a human or the AI mapper may select on
 * an NCE engagement (folded to the canonical code by buildCanonicalNceCode).
 * Transcribed verbatim from NCE_NOTE_FS_MAP (codes) + NOTE_NATURE (nature).
 */
const NCE_NOTE_REGISTRY: NceNoteDef[] = [
  { note: "borrowings",        nature: "CR", lt: ["NCE_LTB", "BS_NCL_LTB"],               st: ["NCE_STB", "BS_CL_STB"] },
  { note: "other_lt_liab",     nature: "CR", all: ["NCE_OLTL", "BS_NCL_OLT", "BS_NCL_DTL"] },
  { note: "provisions",        nature: "CR", lt: ["NCE_LTP", "BS_NCL_LTP"],               st: ["NCE_STP", "BS_CL_STP"] },
  { note: "trade_payables",    nature: "CR", all: ["NCE_TP", "BS_CL_TP", "BS_CL_TP_MSME", "BS_CL_TP_OTH"] },
  { note: "other_cl",          nature: "CR", all: ["NCE_OCL", "BS_CL_OCL"] },
  { note: "cwip",              nature: "DR", all: ["NCE_CWIP", "BS_NCA_FA_WIP"] },
  { note: "investments",       nature: "DR", lt: ["NCE_NCINV", "BS_NCA_INV"],             st: ["NCE_CINV", "BS_CA_CI"] },
  { note: "loans_advances",    nature: "DR", lt: ["NCE_LTLA", "BS_NCA_LLA"],              st: ["NCE_STLA", "BS_CA_SLA"] },
  { note: "other_nc_assets",   nature: "DR", all: ["NCE_ONCA", "BS_NCA_ONA", "BS_NCA_DTA"] },
  { note: "inventories",       nature: "DR", all: ["NCE_STCK", "BS_CA_INV", "INV_RM", "INV_WIP", "INV_FG", "INV_STT", "INV_STOCK"] },
  { note: "trade_receivables", nature: "DR", all: ["NCE_TR", "BS_CA_TR"] },
  { note: "cash_bank",         nature: "DR", all: ["NCE_CASH", "BS_CA_CCE"] },
  { note: "other_ca",          nature: "DR", all: ["NCE_OCA", "BS_CA_OCA"] },
  { note: "revenue_ops",       nature: "CR", all: ["NCE_REV_OPS", "PL_REV_OPS"] },
  { note: "other_income",      nature: "CR", all: ["NCE_REV_OTH", "PL_REV_OI"] },
  { note: "cogs",              nature: "DR", all: ["NCE_COGS", "NCE_CII", "PL_EXP_MAT", "PL_EXP_SIT", "PL_EXP_CII"] },
  { note: "employee_exp",      nature: "DR", all: ["NCE_EMP_EXP", "PL_EXP_EMP"] },
  { note: "finance_costs",     nature: "DR", all: ["NCE_FIN_COST", "PL_EXP_FIN"] },
  { note: "other_expenses",    nature: "DR", all: ["NCE_OTH_EXP", "PL_EXP_OTH", "PL_EXP_OEX"] },
];

const listsOf = (d: NceNoteDef): string[][] =>
  [d.all, d.lt, d.st].filter((l): l is string[] => Array.isArray(l));

// ─── Builders ───────────────────────────────────────────────────────────────

/** ≡ NCE_NOTE_FS_MAP. note → { lt?, st?, all? } (twins included). */
export function buildNoteFsMap(): Record<string, { lt?: string[]; st?: string[]; all?: string[] }> {
  const out: Record<string, { lt?: string[]; st?: string[]; all?: string[] }> = {};
  for (const d of NCE_NOTE_REGISTRY) {
    const e: { lt?: string[]; st?: string[]; all?: string[] } = {};
    if (d.lt)  e.lt = d.lt;
    if (d.st)  e.st = d.st;
    if (d.all) e.all = d.all;
    out[d.note] = e;
  }
  return out;
}

/** ≡ NOTE_NATURE. note → DR/CR. */
export function buildNoteNature(): Record<string, FsNature> {
  const out: Record<string, FsNature> = {};
  for (const d of NCE_NOTE_REGISTRY) out[d.note] = d.nature;
  return out;
}

/** ≡ the NCE half of FS_CODE_NATURE — ONLY NCE_* codes (corporate/INV twins are
 *  excluded; they belong to the hand-kept corporate half) plus the 4 equity
 *  codes. */
export function buildNceFsCodeNature(): Record<string, FsNature> {
  const out: Record<string, FsNature> = {};
  for (const d of NCE_NOTE_REGISTRY) {
    for (const list of listsOf(d)) {
      for (const code of list) {
        if (code.startsWith("NCE_")) out[code] = d.nature;
      }
    }
  }
  for (const e of NCE_EQUITY_CODES) out[e.code] = e.nature;
  for (const e of NCE_DIRECT_CODES) out[e.code] = e.nature;  // RC1: note-less Dr codes
  return out;
}

/** ≡ CANONICAL_NCE_CODE. twin → canonical NCE_* (list[0]). Equity codes are
 *  NEVER folded (they are not in any list). */
export function buildCanonicalNceCode(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of NCE_NOTE_REGISTRY) {
    for (const list of listsOf(d)) {
      if (list.length < 2) continue;
      const canon = list[0];
      for (const code of list.slice(1)) out[code] = canon;
    }
  }
  return out;
}

/** ≡ NCE_LIAB_CODE_SET. CR-natural NCE_* codes (equity + Cr-natural note codes +
 *  income). Twins excluded; assets/expenses excluded. Order-independent (Set). */
export function buildNceLiabCodeSet(): Set<string> {
  const s = new Set<string>();
  for (const e of NCE_EQUITY_CODES) s.add(e.code);
  for (const d of NCE_NOTE_REGISTRY) {
    if (d.nature !== "CR") continue;
    for (const list of listsOf(d)) {
      for (const code of list) {
        if (code.startsWith("NCE_")) s.add(code);
      }
    }
  }
  return s;
}

/**
 * Normalize an engagement's coa_mapping so corporate / INV twin codes are folded
 * to their canonical NCE_* code (e.g. BS_CL_STB → NCE_STB). Pure, persist-only:
 * the intended use is to write the result to audit_engagements.coa_mapping on
 * save (NCE engagements only). NULL-SAFE — a null / undefined / non-object /
 * array input (the wipe/clear save paths) is returned unchanged. Never mutates
 * the input.
 *
 * ⚠️ NOT YET WIRED — do NOT route the COA-save path through this without the
 * exclusion below. `BS_CA_INV` has a SPECIAL migration (PipelineStage3.tsx:734,
 * PipelineFinancialStatements.tsx:2786) that converts it to `INV_STOCK` (a
 * BS+P&L dual-post code), NOT to `NCE_STCK`. This fold would send it to
 * `NCE_STCK` and lose the dual-post behaviour. Any wiring must first exclude the
 * INV dual-post twins (BS_CA_INV / INV_*) — and be validated on real data, since
 * it is a one-way mutation of stored audit mappings. The registry already
 * ACCEPTS both corporate and NCE codes everywhere (NCE_NOTE_FS_MAP lists both),
 * so this normalization is optional hygiene, not required for correctness.
 */
export function normalizeCoaCodes<T>(mapping: T): T {
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) return mapping;
  const canon = buildCanonicalNceCode();
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(mapping as Record<string, any>)) {
    if (v && typeof v === "object" && typeof v.code === "string" && canon[v.code]) {
      out[k] = { ...v, code: canon[v.code] };
    } else {
      out[k] = v;
    }
  }
  return out as T;
}
