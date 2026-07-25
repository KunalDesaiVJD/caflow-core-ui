/**
 * plFaceNpat.ts
 *
 * Live NPAT computation that MIRRORS the P&L face — Revenue - Expenses - Tax
 * — using the same note-level overrides the face applies:
 *
 *   • Cost of Materials Consumed: Opening + Purchases − Closing when the
 *     auditor has entered any of the three fields (else the note headline).
 *   • Changes in Inventories of FG/WIP/SIT: Σ opening − Σ closing where
 *     each of the six sub-cells respects the manual override at
 *     `pl.changes_inventory.override.{fg|wip|sit}_{close|open}_{cy|py}`.
 *   • Every other P&L line: the note headline (`notes.pl.<key>.cy/.py`),
 *     which the note-row loop in autoPopulate keeps in sync with the COA
 *     mapping and any manual-edited breakup row.
 *
 * Consumed by:
 *   • src/components/stage5/notes/NoteBSLiab.tsx — the "Add/(Less): Profit
 *     for the year" line inside the Reserves & Surplus note. Reading the
 *     face NPAT ensures Sub-total [b] ties back to the actual P&L face
 *     value regardless of whether the auditor has manually adjusted CoM
 *     or CII in the note editor.
 *
 * Sign convention:
 *   • Revenue notes (`revenue_from_ops`, `other_income`) are stored NEGATIVE
 *     in the Cr-natural convention (bs_liab / pl-income). `Math.abs()`
 *     flips them to positive to match how the face renders them.
 *   • Expense / tax notes are stored POSITIVE (Dr-natural). Used verbatim.
 */
type Stage5Like = {
  pl?: Record<string, any>;
} | null | undefined;

const num = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const isEntered = (v: any): boolean => v != null && v !== "";

function readCoMTotal(notes: Stage5Like, col: "cy" | "py"): number {
  const cm = (notes?.pl?.cost_materials ?? {}) as Record<string, any>;
  const opening = num(cm[`opening_${col}`]);
  const closing = num(cm[`closing_${col}`]);
  const purchasesStored = cm[`purchases_${col}`];
  const breakup: any[] = Array.isArray(cm.breakup) ? cm.breakup : [];
  const breakupSum = breakup.reduce((s, r) => {
    const n = Number(r?.[`amount_${col}`]);
    return s + (Number.isFinite(n) ? n : 0);
  }, 0);
  const purchases = isEntered(purchasesStored) ? num(purchasesStored) : breakupSum;
  const anyEdited = isEntered(cm[`opening_${col}`])
                 || isEntered(cm[`closing_${col}`])
                 || isEntered(purchasesStored);
  const headline = num(cm[col]);
  return anyEdited ? (opening + purchases - closing) : headline;
}

function readCITotal(notes: Stage5Like, col: "cy" | "py"): number {
  const ci = (notes?.pl?.changes_inventory ?? {}) as Record<string, any>;
  const src = (k: string): number => num(ci[k]);
  const map: Record<"fg"|"wip"|"sit", "fg"|"wip"|"sit"> = {
    fg:  (ci?.bucket_map?.fg  as any) ?? "fg",
    wip: (ci?.bucket_map?.wip as any) ?? "wip",
    sit: (ci?.bucket_map?.sit as any) ?? "sit",
  };
  const feeders = (d: "fg"|"wip"|"sit"): ("fg"|"wip"|"sit")[] =>
    (["fg","wip","sit"] as const).filter(s => map[s] === d);
  const disp = (bucket: "fg"|"wip"|"sit", kind: "close"|"open"): number =>
    feeders(bucket).reduce((sum, s) => sum + src(`${s}_${kind}_${col}`), 0);
  const cell = (bucket: "fg"|"wip"|"sit", kind: "close"|"open"): number => {
    const ov = ci?.override?.[`${bucket}_${kind}_${col}`];
    if (isEntered(ov)) return num(ov);
    return disp(bucket, kind);
  };
  const hasAnyOverride = ci?.override && Object.keys(ci.override).some(k => isEntered((ci.override as any)[k]));
  if (hasAnyOverride) {
    const opens  = cell("fg","open")  + cell("wip","open")  + cell("sit","open");
    const closes = cell("fg","close") + cell("wip","close") + cell("sit","close");
    return opens - closes;
  }
  return num(ci[col]);
}

/** Live face NPAT = Revenue − Expenses − Tax, mirroring the PL face. */
export function computeFaceNpat(notes: Stage5Like, col: "cy" | "py"): number {
  const pl = (notes?.pl ?? {}) as Record<string, any>;
  const readNote = (key: string): number => num(pl[key]?.[col]);

  // Revenue notes are stored NEGATIVE (Cr-natural); flip to positive.
  const revFromOps = Math.abs(readNote("revenue_from_ops"));
  const otherInc   = Math.abs(readNote("other_income"));
  const totRev     = revFromOps + otherInc;

  // Expense notes are stored POSITIVE (Dr-natural).
  const costMat    = readCoMTotal(notes, col);
  const purStock   = readNote("purchases_stock");
  const cii        = readCITotal(notes, col);   // (opening − closing) — can be negative
  const empBen     = readNote("employee_benefits");
  const finCost    = readNote("finance_costs");
  const depre      = readNote("depreciation");
  const othExp     = readNote("other_expenses");
  const totExp     = costMat + purStock + cii + empBen + finCost + depre + othExp;

  // Tax: notes don't hold a dedicated current/deferred tax row, so
  // autoPopulate persists the COA-summed total under pl.eps.total_tax_cy /
  // total_tax_py. See notesAutoPopulate.ts (~L1915). This value is always
  // rewritten on every autoPopulate so it never goes stale.
  const eps = (pl.eps ?? {}) as Record<string, any>;
  const totTax = col === "cy" ? num(eps.total_tax_cy) : num(eps.total_tax_py);

  return totRev - totExp - totTax;
}
