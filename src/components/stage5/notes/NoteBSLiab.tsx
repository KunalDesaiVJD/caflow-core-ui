/**
 * NoteBSLiab — BS Liabilities notes (share_capital→st_provisions).
 * Note numbers come from NOTE_REGISTRY — never hardcode them here.
 *
 * Note 1 (Share Capital) — full Schedule III structure:
 *   Main table (Authorised / Issued / Total) + 3 sub-sections:
 *   (a) Reconciliation of shares outstanding
 *   (b) Shareholders holding > 5%
 *   (c) Promoters' shareholding with % Change
 *
 * Note 2 (Reserves and Surplus) — structured per FS_NOTES.xlsx:
 *   General Reserve + Securities Premium → sub-total [a]
 *   Surplus in P&L (Opening / Profit / Deferred adj / Excess tax) → sub-total [b]
 *   Total [a]+[b]  (= COA-mapped BS total, overrideable)
 */

import {
  EditableCell, EditableRow, NoteCard, NoteHeaderRow,
  ListTable, AgeingTable, formatINR,
  type ListRow, type AgeingMatrix,
} from "./EditableCell";
import type { Stage5Notes } from "@/lib/notesAutoPopulate";
import { useDynamicNoteRegistry } from "@/lib/noteNumberRegistry";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// ── Row types (Share Capital sub-tables) ─────────────────────────────────────
interface ShareholderRow {
  name:      string;
  cy_shares: string;   // stored as string (user types "1,00,000")
  cy_pct:    number;
  py_shares: string;
  py_pct:    number;
}
interface PromoterRow {
  name:      string;
  cy_shares: string;
  cy_pct:    number;
  py_shares: string;
  py_pct:    number;
}

/** Parse a potentially-comma-formatted number string into a float. */
const parseNum = (v: any): number => {
  if (v == null || v === "") return 0;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
};

/** Format an integer share count in Indian numbering (no decimals). */
const fmtShares = (n: number) =>
  n === 0 ? "-" : Math.round(n).toLocaleString("en-IN");

/** Format a percentage, showing "-" for zero. */
const fmtPct = (n: number) => (n === 0 ? "-" : `${n.toFixed(2)}%`);

/** Format a % change with a leading + for positives. */
const fmtPctChange = (n: number) =>
  n === 0 ? "-" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;

// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  notes:           Stage5Notes;
  cyYear:          number;
  pyYear:          number;
  updatePath:      (path: string, value: any) => void;
  resetPath:       (path: string) => void;
  isOverridden:    (path: string) => boolean;
  engagementId:    string;
  collapseControl?: boolean;
  onRemapLedger?:  (ledgerName: string, newCode: string) => void;
  /** Issue 4 (Aesha) — clears this ledger from coa_mapping (DB) and re-syncs.
   *  Wired to ListTable so the unmap menu action propagates to Stage 6. */
  onUnmapLedger?:  (ledgerName: string) => void;
}

export default function NoteBSLiab({
  engagementId, notes, cyYear, pyYear, updatePath, resetPath, isOverridden, collapseControl, onRemapLedger, onUnmapLedger,
}: Props) {
  // Bug 4 — Sign-convention bridge for Notes display
  // ─────────────────────────────────────────────────────────────────────────
  // bs_liab note headline totals (.cy / .py) may be stored in either sign:
  //   • POSITIVE — auto-populated AFTER the sectionSign fix in
  //     notesAutoPopulate.ts (line 1072), or manually entered by an auditor.
  //   • NEGATIVE — auto-populated BEFORE the sectionSign fix (legacy
  //     engagements like KWIKTEAM where the stored value is in Tally CR
  //     convention), or pulled from raw TB without the sign flip.
  //
  // The "Total per BS" row on every liability note must display the same
  // POSITIVE figure that appears on the face of the Balance Sheet. The BS
  // face already does this via negL(value). The Notes UI now mirrors that:
  // when the stored value is negative (Tally CR convention), flip it
  // positive so the auditor sees a consistent number across BS and Notes.
  //
  // This handles every client with stale negative-stored bs_liab totals
  // without requiring a one-time DB migration. Newly auto-populated values
  // are already positive and pass through unchanged.
  // ── Breakup-aware total resolution with sign awareness ────────────────────
  // The "Total — <Note> (per BS)" row must match the BS face exactly. The BS
  // face uses ncyOf() which prefers the breakup sum over the stored headline,
  // and applies negL() so:
  //   • CR-balance liability  (stored < 0)  → display POSITIVE
  //   • DR-balance liability  (stored > 0)  → display NEGATIVE
  // (Issue 1 — Aesha: Deferred tax with a DR balance in Tally must show
  // negative on the note, just like it does on the BS face.)
  //
  // Implementation: prefer breakup sum for the magnitude, then take the
  // SIGN from the stored .cy/.py (which carries the Tally DR/CR convention).
  // Stored zero / null defaults to CR-positive (the normal liability case).
  const sumBreakup = (key: string, col: "amount_cy"|"amount_py"): { sum: number; hasAny: boolean } => {
    const arr = (notes.bs_liab[key] as any)?.breakup;
    if (!Array.isArray(arr)) return { sum: 0, hasAny: false };
    const populated = arr.filter((r: any) => r != null && r[col] != null && r[col] !== "");
    if (populated.length === 0) return { sum: 0, hasAny: false };
    const sum = populated.reduce((s: number, r: any) => {
      const n = Number(r[col]);
      return s + (Number.isFinite(n) ? n : 0);
    }, 0);
    return { sum, hasAny: true };
  };

  /** Sign convention for bs_liab notes — auto-populate stores values AFTER
   *  the sectionSign flip (× -1 in notesAutoPopulate.ts:1072), so a normal
   *  CR-balance liability lands as POSITIVE in storage and an abnormal
   *  DR-balance liability lands as NEGATIVE.  Display rule (matches both
   *  the BS face and the auditor's mental model):
   *    • Stored ≥ 0   →  CR balance (normal)   →  display POSITIVE
   *    • Stored < 0   →  DR balance (abnormal) →  display NEGATIVE
   *  When the breakup is populated we use its (always-positive) sum as the
   *  magnitude and take the sign from the stored value. */
  const signedTotal = (storedRaw: number, magnitude: number): number =>
    storedRaw < 0 ? -magnitude : magnitude;

  const cy = (key: string) => {
    const stored = Number(notes.bs_liab[key]?.cy ?? 0);
    const { sum, hasAny } = sumBreakup(key, "amount_cy");
    const magnitude = hasAny ? sum : Math.abs(stored);
    return signedTotal(stored, magnitude);
  };
  const py = (key: string) => {
    const stored = Number(notes.bs_liab[key]?.py ?? 0);
    const { sum, hasAny } = sumBreakup(key, "amount_py");
    const magnitude = hasAny ? sum : Math.abs(stored);
    return signedTotal(stored, magnitude);
  };
  const get = (path: string) => path.split(".").reduce<any>((c, k) => c?.[k], notes);

  // effectivePY: same logic — prefer breakup sum over stored headline.
  const effectivePY = (key: string): number => py(key);

  // Smart note: only show a note number when at least one year has data.
  // dataKey = key into notes.bs_liab; regKey = key into noteNumberRegistry
  // (defaults to dataKey when they match, e.g. lt_borrowings → lt_borrowings).
  const { getNoteNo: dn } = useDynamicNoteRegistry(engagementId);
  const sn = (_dataKey: string, regKey: string = _dataKey): number | null =>
    dn(regKey) ?? null;

  // ── Trade Payables ageing schemas ─────────────────────────────────────────
  const TP_ROWS = [
    { key: "msme",        label: "(i) MSME" },
    { key: "others",      label: "(ii) Others" },
    { key: "disp_msme",   label: "(iii) Disputed dues — MSME" },
    { key: "disp_others", label: "(iv) Disputed dues — Others" },
  ];
  const TP_BUCKETS = [
    { key: "lt1", label: "< 1 yr" },
    { key: "1_2", label: "1-2 yrs" },
    { key: "2_3", label: "2-3 yrs" },
    { key: "gt3", label: "> 3 yrs" },
  ];

  // ── Note 1: Share Capital computed values ─────────────────────────────────
  const reconOpenCyNum  = parseNum(get("bs_liab.share_capital.recon_open_cy_num"));
  const reconMoveCyNum  = parseNum(get("bs_liab.share_capital.recon_move_cy_num"));
  const reconCloseCyNum = reconOpenCyNum + reconMoveCyNum;
  const reconOpenCyAmt  = Number(get("bs_liab.share_capital.recon_open_cy_amt")  ?? 0);
  const reconMoveCyAmt  = Number(get("bs_liab.share_capital.recon_move_cy_amt")  ?? 0);
  const reconCloseCyAmt = reconOpenCyAmt + reconMoveCyAmt;

  const reconOpenPyNum  = parseNum(get("bs_liab.share_capital.recon_open_py_num"));
  const reconMovePyNum  = parseNum(get("bs_liab.share_capital.recon_move_py_num"));
  const reconClosePyNum = reconOpenPyNum + reconMovePyNum;
  const reconOpenPyAmt  = Number(get("bs_liab.share_capital.recon_open_py_amt")  ?? 0);
  const reconMovePyAmt  = Number(get("bs_liab.share_capital.recon_move_py_amt")  ?? 0);
  const reconClosePyAmt = reconOpenPyAmt + reconMovePyAmt;

  const shareholders: ShareholderRow[] =
    (get("bs_liab.share_capital.shareholders") ?? []) as ShareholderRow[];

  const promoters: PromoterRow[] =
    (get("bs_liab.share_capital.promoters_list") ?? []) as PromoterRow[];

  const totalPromCyShares = promoters.reduce((s, r) => s + parseNum(r.cy_shares), 0);
  const totalPromCyPct    = promoters.reduce((s, r) => s + (r.cy_pct || 0), 0);
  const totalPromPyShares = promoters.reduce((s, r) => s + parseNum(r.py_shares), 0);
  const totalPromPyPct    = promoters.reduce((s, r) => s + (r.py_pct || 0), 0);

  const updSH = (next: ShareholderRow[]) =>
    updatePath("bs_liab.share_capital.shareholders", next);
  const updPR = (next: PromoterRow[]) =>
    updatePath("bs_liab.share_capital.promoters_list", next);

  // ── Note 2: Reserves and Surplus computed values ──────────────────────────
  const genReserveCy  = Number(get("bs_liab.reserves_surplus.gen_reserve_cy")   ?? 0);
  const genReservePy  = Number(get("bs_liab.reserves_surplus.gen_reserve_py")   ?? 0);
  const sharePremCy   = Number(get("bs_liab.reserves_surplus.share_premium_cy") ?? 0);
  const sharePremPy   = Number(get("bs_liab.reserves_surplus.share_premium_py") ?? 0);
  const subtotalACy   = genReserveCy + sharePremCy;
  const subtotalAPy   = genReservePy + sharePremPy;

  // Profit for the year — auto-pulled from P&L EPS note (NPAT)
  const profitCy      = Number(get("pl.eps.npat")    ?? 0);
  const profitPy      = Number(get("pl.eps.npat_py") ?? 0);

  // Issue 2 (Aesha) — Carry-forward of closing balance for Reserves & Surplus.
  // CY "Opening balance" of Surplus in P&L should AUTOMATICALLY equal the
  // prior-year closing balance of Reserves & Surplus (i.e. PY column of the
  // headline) when the auditor hasn't manually entered a value.  This
  // matches the standard accounting carry-forward rule:
  //   Opening balance (CY) = Closing balance (PY)
  // Implementation: read the raw stored value (preserves explicit "" / null
  // distinction). If unset, fall back to abs(reserves_surplus.py) which is
  // the prior-year closing carried in stage5_notes.  The value remains
  // editable; an explicit auditor entry overrides the auto carry-forward.
  const surpOpenCyRaw   = get("bs_liab.reserves_surplus.surplus_opening_cy");
  const surpOpenPyRaw   = get("bs_liab.reserves_surplus.surplus_opening_py");
  const reservesPyMagn  = Math.abs(Number(get("bs_liab.reserves_surplus.py") ?? 0));
  const surpOpenCy      = surpOpenCyRaw != null && surpOpenCyRaw !== ""
    ? Number(surpOpenCyRaw)
    : reservesPyMagn;
  const surpOpenPy      = surpOpenPyRaw != null && surpOpenPyRaw !== ""
    ? Number(surpOpenPyRaw)
    : 0;
  const surpDeferCy   = Number(get("bs_liab.reserves_surplus.surplus_deferred_adj_cy") ?? 0);
  const surpDeferPy   = Number(get("bs_liab.reserves_surplus.surplus_deferred_adj_py") ?? 0);
  const surpExcessCy  = Number(get("bs_liab.reserves_surplus.surplus_excess_short_cy") ?? 0);
  const surpExcessPy  = Number(get("bs_liab.reserves_surplus.surplus_excess_short_py") ?? 0);

  const subtotalBCy   = surpOpenCy + profitCy + surpDeferCy + surpExcessCy;
  const subtotalBPy   = surpOpenPy + profitPy + surpDeferPy + surpExcessPy;

  // Year label helpers
  const cyLbl = `FY ${cyYear - 1}-${String(cyYear).slice(-2)}`;
  const pyLbl = `FY ${pyYear - 1}-${String(pyYear).slice(-2)}`;
  const cyDateLbl = `As at 31-Mar-${cyYear}`;
  const pyDateLbl = `As at 31-Mar-${pyYear}`;

  // Reusable sub-total row (non-editable computed display).
  // Mirrors the 6/3/2/1 grid used by ListTable + EditableRow so CY/PY values
  // line up vertically with the breakup rows above.
  const SubTotalRow = ({ label, cVal, pVal }: { label: string; cVal: number; pVal: number }) => (
    <div className="grid grid-cols-12 gap-2 items-center py-0.5 font-semibold border-t border-dashed border-muted-foreground/30">
      <div className="col-span-6 italic text-muted-foreground text-[10px]">{label}</div>
      <div className="col-span-3 text-right tabular-nums">{formatINR(cVal)}</div>
      <div className="col-span-2 text-right tabular-nums">{formatINR(pVal)}</div>
      <div className="col-span-1" />
    </div>
  );

  return (
    <div className="space-y-4">

      {/* ════════════════════════════════════════════════════════════════════
          NOTE 1 — SHARE CAPITAL
      ════════════════════════════════════════════════════════════════════ */}
      <NoteCard collapseControl={collapseControl} noteNo={sn("share_capital")} title="Share capital">

        {/* ── Main amounts table ──────────────────────────────────────────── */}
        <div className="overflow-x-auto">
          <table className="w-full text-[10px] border-collapse">
            <thead>
              <tr className="bg-muted/30">
                <th className="text-left p-1 border w-[58%]">Particulars</th>
                <th className="text-right p-1 border">{cyDateLbl}</th>
                <th className="text-right p-1 border">{pyDateLbl}</th>
              </tr>
            </thead>
            <tbody>
              {/* (a) Authorised */}
              <tr>
                <td colSpan={3} className="p-1 border font-semibold bg-muted/10 text-[10px]">
                  (a) Authorised shares
                </td>
              </tr>
              <tr>
                <td className="p-0.5 border pl-4">
                  <EditableCell
                    type="text"
                    value={get("bs_liab.share_capital.authorised_text") ?? ""}
                    placeholder="e.g. 1,00,000 equity shares of face value ₹10 each"
                    onCommit={(v) => updatePath("bs_liab.share_capital.authorised_text", String(v ?? ""))}
                  />
                </td>
                <td className="p-0.5 border">
                  <EditableCell
                    value={Number(get("bs_liab.share_capital.authorised_cy") ?? 0)}
                    isOverridden={isOverridden("bs_liab.share_capital.authorised_cy")}
                    onCommit={(v) => updatePath("bs_liab.share_capital.authorised_cy", v == null ? 0 : Number(v))}
                  />
                </td>
                <td className="p-0.5 border">
                  <EditableCell
                    value={Number(get("bs_liab.share_capital.authorised_py") ?? 0)}
                    isOverridden={isOverridden("bs_liab.share_capital.authorised_py")}
                    onCommit={(v) => updatePath("bs_liab.share_capital.authorised_py", v == null ? 0 : Number(v))}
                  />
                </td>
              </tr>

              {/* (b) Issued, subscribed and fully paid up */}
              <tr>
                <td colSpan={3} className="p-1 border font-semibold bg-muted/10 text-[10px]">
                  (b) Issued, subscribed and fully paid up shares
                </td>
              </tr>
              <tr>
                <td className="p-0.5 border pl-4">
                  <EditableCell
                    type="text"
                    value={get("bs_liab.share_capital.issued_text") ?? ""}
                    placeholder="e.g. 1,00,000 equity shares of face value ₹10 each, fully paid up"
                    onCommit={(v) => updatePath("bs_liab.share_capital.issued_text", String(v ?? ""))}
                  />
                </td>
                <td className="p-0.5 border">
                  <EditableCell
                    value={cy("share_capital")}
                    autoValue={cy("share_capital")}
                    isAutoFilled={!isOverridden("bs_liab.share_capital.cy")}
                    isOverridden={isOverridden("bs_liab.share_capital.cy")}
                    onCommit={(v) => updatePath("bs_liab.share_capital.cy", v == null ? 0 : Number(v))}
                    onResetToAuto={() => resetPath("bs_liab.share_capital.cy")}
                  />
                </td>
                <td className="p-0.5 border">
                  <EditableCell
                    value={py("share_capital")}
                    autoValue={py("share_capital")}
                    isAutoFilled={!isOverridden("bs_liab.share_capital.py")}
                    isOverridden={isOverridden("bs_liab.share_capital.py")}
                    onCommit={(v) => updatePath("bs_liab.share_capital.py", v == null ? 0 : Number(v))}
                    onResetToAuto={() => resetPath("bs_liab.share_capital.py")}
                  />
                </td>
              </tr>

              {/* Total */}
              <tr className="font-semibold bg-muted/30">
                <td className="p-1 border">Total</td>
                <td className="p-1 border text-right tabular-nums">{formatINR(cy("share_capital"))}</td>
                <td className="p-1 border text-right tabular-nums">{formatINR(py("share_capital"))}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ── (a) Reconciliation of shares outstanding ─────────────────────── */}
        <div className="mt-3 text-[10px] font-semibold">(a) Reconciliation of number of shares outstanding</div>
        <div className="overflow-x-auto mt-1">
          <table className="w-full text-[10px] border-collapse">
            <thead>
              <tr className="bg-muted/30">
                <th className="text-left p-1 border" rowSpan={2}>Particulars</th>
                <th className="text-center p-1 border" colSpan={2}>{cyLbl}</th>
                <th className="text-center p-1 border" colSpan={2}>{pyLbl}</th>
              </tr>
              <tr className="bg-muted/20">
                <th className="text-right p-1 border">No. of Equity Shares</th>
                <th className="text-right p-1 border">Amount (₹)</th>
                <th className="text-right p-1 border">No. of Equity Shares</th>
                <th className="text-right p-1 border">Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              {/* Opening */}
              <tr>
                <td className="p-1 border">Opening balance at the beginning of the year</td>
                <td className="p-0.5 border">
                  <EditableCell
                    type="text" className="text-right tabular-nums"
                    value={get("bs_liab.share_capital.recon_open_cy_num") ?? ""}
                    placeholder="0"
                    onCommit={(v) => updatePath("bs_liab.share_capital.recon_open_cy_num", v)}
                  />
                </td>
                <td className="p-0.5 border">
                  <EditableCell
                    value={reconOpenCyAmt}
                    onCommit={(v) => updatePath("bs_liab.share_capital.recon_open_cy_amt", v == null ? 0 : Number(v))}
                  />
                </td>
                <td className="p-0.5 border">
                  <EditableCell
                    type="text" className="text-right tabular-nums"
                    value={get("bs_liab.share_capital.recon_open_py_num") ?? ""}
                    placeholder="0"
                    onCommit={(v) => updatePath("bs_liab.share_capital.recon_open_py_num", v)}
                  />
                </td>
                <td className="p-0.5 border">
                  <EditableCell
                    value={reconOpenPyAmt}
                    onCommit={(v) => updatePath("bs_liab.share_capital.recon_open_py_amt", v == null ? 0 : Number(v))}
                  />
                </td>
              </tr>

              {/* Movement */}
              <tr>
                <td className="p-1 border">Add/(Less): Movement during the year</td>
                <td className="p-0.5 border">
                  <EditableCell
                    type="text" className="text-right tabular-nums"
                    value={get("bs_liab.share_capital.recon_move_cy_num") ?? ""}
                    placeholder="0"
                    onCommit={(v) => updatePath("bs_liab.share_capital.recon_move_cy_num", v)}
                  />
                </td>
                <td className="p-0.5 border">
                  <EditableCell
                    value={reconMoveCyAmt}
                    onCommit={(v) => updatePath("bs_liab.share_capital.recon_move_cy_amt", v == null ? 0 : Number(v))}
                  />
                </td>
                <td className="p-0.5 border">
                  <EditableCell
                    type="text" className="text-right tabular-nums"
                    value={get("bs_liab.share_capital.recon_move_py_num") ?? ""}
                    placeholder="0"
                    onCommit={(v) => updatePath("bs_liab.share_capital.recon_move_py_num", v)}
                  />
                </td>
                <td className="p-0.5 border">
                  <EditableCell
                    value={reconMovePyAmt}
                    onCommit={(v) => updatePath("bs_liab.share_capital.recon_move_py_amt", v == null ? 0 : Number(v))}
                  />
                </td>
              </tr>

              {/* Closing — computed */}
              <tr className="font-semibold bg-muted/20">
                <td className="p-1 border">Outstanding at the end of the year</td>
                <td className="p-1 border text-right tabular-nums">{fmtShares(reconCloseCyNum)}</td>
                <td className="p-1 border text-right tabular-nums">{formatINR(reconCloseCyAmt)}</td>
                <td className="p-1 border text-right tabular-nums">{fmtShares(reconClosePyNum)}</td>
                <td className="p-1 border text-right tabular-nums">{formatINR(reconClosePyAmt)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ── (b) Shareholders holding more than 5% ────────────────────────── */}
        <div className="mt-3 text-[10px] font-semibold">
          (b) Particulars of shareholders holding more than 5% shares
        </div>
        <div className="overflow-x-auto mt-1">
          <table className="w-full text-[10px] border-collapse">
            <thead>
              <tr className="bg-muted/30">
                <th className="text-left p-1 border" rowSpan={2}>Name of shareholder</th>
                <th className="text-center p-1 border" colSpan={2}>{cyDateLbl}</th>
                <th className="text-center p-1 border" colSpan={2}>{pyDateLbl}</th>
                <th className="p-1 border w-[24px]" rowSpan={2}></th>
              </tr>
              <tr className="bg-muted/20">
                <th className="text-right p-1 border">No. of Shares</th>
                <th className="text-right p-1 border">% of Holding</th>
                <th className="text-right p-1 border">No. of Shares</th>
                <th className="text-right p-1 border">% of Holding</th>
              </tr>
            </thead>
            <tbody>
              {shareholders.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-2 italic text-muted-foreground text-center">
                    No entries yet — click "Add shareholder" below.
                  </td>
                </tr>
              )}
              {shareholders.map((r, i) => (
                <tr key={i}>
                  <td className="p-0.5 border">
                    <EditableCell
                      type="text"
                      value={r.name ?? ""}
                      placeholder="Shareholder name"
                      onCommit={(v) => { const n = shareholders.slice(); n[i] = { ...n[i], name: String(v ?? "") }; updSH(n); }}
                    />
                  </td>
                  <td className="p-0.5 border">
                    <EditableCell
                      type="text" className="text-right tabular-nums"
                      value={r.cy_shares ?? ""}
                      placeholder="0"
                      onCommit={(v) => { const n = shareholders.slice(); n[i] = { ...n[i], cy_shares: String(v ?? "") }; updSH(n); }}
                    />
                  </td>
                  <td className="p-0.5 border">
                    <EditableCell
                      type="text" className="text-right"
                      value={r.cy_pct ? String(r.cy_pct) : ""}
                      placeholder="0.00"
                      onCommit={(v) => { const n = shareholders.slice(); n[i] = { ...n[i], cy_pct: parseNum(v) }; updSH(n); }}
                    />
                  </td>
                  <td className="p-0.5 border">
                    <EditableCell
                      type="text" className="text-right tabular-nums"
                      value={r.py_shares ?? ""}
                      placeholder="0"
                      onCommit={(v) => { const n = shareholders.slice(); n[i] = { ...n[i], py_shares: String(v ?? "") }; updSH(n); }}
                    />
                  </td>
                  <td className="p-0.5 border">
                    <EditableCell
                      type="text" className="text-right"
                      value={r.py_pct ? String(r.py_pct) : ""}
                      placeholder="0.00"
                      onCommit={(v) => { const n = shareholders.slice(); n[i] = { ...n[i], py_pct: parseNum(v) }; updSH(n); }}
                    />
                  </td>
                  <td className="p-0.5 border text-center">
                    <button
                      type="button"
                      onClick={() => { const n = shareholders.slice(); n.splice(i, 1); updSH(n); }}
                      className="p-0.5 rounded hover:bg-destructive/10 text-destructive"
                      title="Remove"
                    >
                      <Trash2 size={11} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button
          type="button" variant="outline" size="sm"
          onClick={() => updSH([...shareholders, { name: "", cy_shares: "", cy_pct: 0, py_shares: "", py_pct: 0 }])}
          className="h-6 text-[10px] gap-1 mt-1"
        >
          <Plus size={11} /> Add shareholder
        </Button>

        {/* ── (c) Promoters' shareholding ──────────────────────────────────── */}
        <div className="mt-3 text-[10px] font-semibold">(c) Promoters' shareholding</div>
        <div className="overflow-x-auto mt-1">
          <table className="w-full text-[10px] border-collapse">
            <thead>
              <tr className="bg-muted/30">
                <th className="text-left p-1 border" rowSpan={2}>Promoter name</th>
                <th className="text-center p-1 border" colSpan={2}>{cyDateLbl}</th>
                <th className="text-center p-1 border" colSpan={2}>{pyDateLbl}</th>
                <th className="text-center p-1 border" rowSpan={2}>% Change<br />(CY − PY)</th>
                <th className="p-1 border w-[24px]" rowSpan={2}></th>
              </tr>
              <tr className="bg-muted/20">
                <th className="text-right p-1 border">No. of Shares</th>
                <th className="text-right p-1 border">%</th>
                <th className="text-right p-1 border">No. of Shares</th>
                <th className="text-right p-1 border">%</th>
              </tr>
            </thead>
            <tbody>
              {promoters.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-2 italic text-muted-foreground text-center">
                    No entries yet — click "Add promoter" below.
                  </td>
                </tr>
              )}
              {promoters.map((r, i) => {
                const pctChg = (r.cy_pct || 0) - (r.py_pct || 0);
                return (
                  <tr key={i}>
                    <td className="p-0.5 border">
                      <EditableCell
                        type="text"
                        value={r.name ?? ""}
                        placeholder="Promoter name"
                        onCommit={(v) => { const n = promoters.slice(); n[i] = { ...n[i], name: String(v ?? "") }; updPR(n); }}
                      />
                    </td>
                    <td className="p-0.5 border">
                      <EditableCell
                        type="text" className="text-right tabular-nums"
                        value={r.cy_shares ?? ""}
                        placeholder="0"
                        onCommit={(v) => { const n = promoters.slice(); n[i] = { ...n[i], cy_shares: String(v ?? "") }; updPR(n); }}
                      />
                    </td>
                    <td className="p-0.5 border">
                      <EditableCell
                        type="text" className="text-right"
                        value={r.cy_pct ? String(r.cy_pct) : ""}
                        placeholder="0.00"
                        onCommit={(v) => { const n = promoters.slice(); n[i] = { ...n[i], cy_pct: parseNum(v) }; updPR(n); }}
                      />
                    </td>
                    <td className="p-0.5 border">
                      <EditableCell
                        type="text" className="text-right tabular-nums"
                        value={r.py_shares ?? ""}
                        placeholder="0"
                        onCommit={(v) => { const n = promoters.slice(); n[i] = { ...n[i], py_shares: String(v ?? "") }; updPR(n); }}
                      />
                    </td>
                    <td className="p-0.5 border">
                      <EditableCell
                        type="text" className="text-right"
                        value={r.py_pct ? String(r.py_pct) : ""}
                        placeholder="0.00"
                        onCommit={(v) => { const n = promoters.slice(); n[i] = { ...n[i], py_pct: parseNum(v) }; updPR(n); }}
                      />
                    </td>
                    <td className="p-1 border text-right tabular-nums">{fmtPctChange(pctChg)}</td>
                    <td className="p-0.5 border text-center">
                      <button
                        type="button"
                        onClick={() => { const n = promoters.slice(); n.splice(i, 1); updPR(n); }}
                        className="p-0.5 rounded hover:bg-destructive/10 text-destructive"
                        title="Remove"
                      >
                        <Trash2 size={11} />
                      </button>
                    </td>
                  </tr>
                );
              })}

              {/* Total row */}
              <tr className="font-semibold bg-muted/30">
                <td className="p-1 border">Total</td>
                <td className="p-1 border text-right tabular-nums">{fmtShares(totalPromCyShares)}</td>
                <td className="p-1 border text-right tabular-nums">{fmtPct(totalPromCyPct)}</td>
                <td className="p-1 border text-right tabular-nums">{fmtShares(totalPromPyShares)}</td>
                <td className="p-1 border text-right tabular-nums">{fmtPct(totalPromPyPct)}</td>
                <td className="p-1 border text-right tabular-nums">{fmtPctChange(totalPromCyPct - totalPromPyPct)}</td>
                <td className="p-1 border"></td>
              </tr>
            </tbody>
          </table>
        </div>
        <Button
          type="button" variant="outline" size="sm"
          onClick={() => updPR([...promoters, { name: "", cy_shares: "", cy_pct: 0, py_shares: "", py_pct: 0 }])}
          className="h-6 text-[10px] gap-1 mt-1"
        >
          <Plus size={11} /> Add promoter
        </Button>
      </NoteCard>

      {/* ════════════════════════════════════════════════════════════════════
          NOTE 2 — RESERVES AND SURPLUS
      ════════════════════════════════════════════════════════════════════ */}
      <NoteCard collapseControl={collapseControl} noteNo={sn("reserves_surplus")} title="Reserves and surplus">
        <NoteHeaderRow cyLabel={cyDateLbl} pyLabel={pyDateLbl} />

        {/* 1. General Reserve — auto from COA mapping */}
        <EditableRow
          label="1. General Reserve"
          cy={genReserveCy} py={genReservePy}
          autoCY={genReserveCy} autoPY={genReservePy}
          isOverriddenCy={isOverridden("bs_liab.reserves_surplus.gen_reserve_cy")}
          isOverriddenPy={isOverridden("bs_liab.reserves_surplus.gen_reserve_py")}
          onCommitCy={(v) => updatePath("bs_liab.reserves_surplus.gen_reserve_cy", v)}
          onCommitPy={(v) => updatePath("bs_liab.reserves_surplus.gen_reserve_py", v)}
          onResetCy={() => resetPath("bs_liab.reserves_surplus.gen_reserve_cy")}
          onResetPy={() => resetPath("bs_liab.reserves_surplus.gen_reserve_py")}
        />

        {/* 2. Securities Premium — auto from COA mapping */}
        <EditableRow
          label="2. Securities Premium"
          cy={sharePremCy} py={sharePremPy}
          autoCY={sharePremCy} autoPY={sharePremPy}
          isOverriddenCy={isOverridden("bs_liab.reserves_surplus.share_premium_cy")}
          isOverriddenPy={isOverridden("bs_liab.reserves_surplus.share_premium_py")}
          onCommitCy={(v) => updatePath("bs_liab.reserves_surplus.share_premium_cy", v)}
          onCommitPy={(v) => updatePath("bs_liab.reserves_surplus.share_premium_py", v)}
          onResetCy={() => resetPath("bs_liab.reserves_surplus.share_premium_cy")}
          onResetPy={() => resetPath("bs_liab.reserves_surplus.share_premium_py")}
        />

        {/* Sub-total [a] */}
        <SubTotalRow label="Sub-total [a]" cVal={subtotalACy} pVal={subtotalAPy} />

        {/* Surplus in P&L section */}
        <div className="text-[10px] italic text-muted-foreground mt-2">
          Surplus in the Statement of Profit and Loss
        </div>

        {/* Issues 3/6 (today) — Surplus Opening:
             CY auto-fills from prior year R&S closing (already stored via
             `reservesPyMagn` fallback at line 229).
             PY auto-fills from prior year stage5_notes.bs_liab.reserves_surplus.surplus_opening_cy
             OR prior-year TB BS_EQ_RS opening_balance (seeded by autoPopulateNotes).
             User can override either side; explicit entry wins. */}
        <EditableRow
          label="Opening balance"
          cy={surpOpenCy} py={surpOpenPy}
          autoCY={reservesPyMagn || undefined}
          autoPY={surpOpenPy || undefined}
          isOverriddenCy={isOverridden("bs_liab.reserves_surplus.surplus_opening_cy")}
          isOverriddenPy={isOverridden("bs_liab.reserves_surplus.surplus_opening_py")}
          onCommitCy={(v) => updatePath("bs_liab.reserves_surplus.surplus_opening_cy", v)}
          onCommitPy={(v) => updatePath("bs_liab.reserves_surplus.surplus_opening_py", v)}
          onResetCy={() => resetPath("bs_liab.reserves_surplus.surplus_opening_cy")}
          onResetPy={() => resetPath("bs_liab.reserves_surplus.surplus_opening_py")}
        />

        {/* Issue 5 (today) — Profit for the Year auto-linked from
             P&L line item XV. Profit/(Loss) for the Period (NPAT). */}
        <EditableRow
          label="Add/(Less): Profit for the year"
          cy={profitCy} py={profitPy}
          autoCY={profitCy} autoPY={profitPy}
          isOverriddenCy={isOverridden("pl.eps.npat")}
          isOverriddenPy={isOverridden("pl.eps.npat_py")}
          onCommitCy={(v) => updatePath("pl.eps.npat", v)}
          onCommitPy={(v) => updatePath("pl.eps.npat_py", v)}
          onResetCy={() => resetPath("pl.eps.npat")}
          onResetPy={() => resetPath("pl.eps.npat_py")}
        />

        {/* Issue 4 (today) — Adjustments for Deferred Tax auto-populates
             from any Tally ledger under BS_EQ_RS whose name matches the
             /deferred tax/i pattern (seeded by autoPopulateNotes). */}
        <EditableRow
          label="Add/(Less): Adjustments for deferred tax"
          cy={surpDeferCy} py={surpDeferPy}
          autoCY={surpDeferCy || undefined}
          autoPY={surpDeferPy || undefined}
          isOverriddenCy={isOverridden("bs_liab.reserves_surplus.surplus_deferred_adj_cy")}
          isOverriddenPy={isOverridden("bs_liab.reserves_surplus.surplus_deferred_adj_py")}
          onCommitCy={(v) => updatePath("bs_liab.reserves_surplus.surplus_deferred_adj_cy", v)}
          onCommitPy={(v) => updatePath("bs_liab.reserves_surplus.surplus_deferred_adj_py", v)}
          onResetCy={() => resetPath("bs_liab.reserves_surplus.surplus_deferred_adj_cy")}
          onResetPy={() => resetPath("bs_liab.reserves_surplus.surplus_deferred_adj_py")}
        />

        {/* Issue 4 (today) — Excess/(Short) Provision for Income Tax auto-
             populates from any Tally ledger under BS_EQ_RS whose name
             matches /provision.*income tax/i etc. (seeded by autoPopulateNotes). */}
        <EditableRow
          label="Add/(Less): Excess/(Short) provision for income tax"
          cy={surpExcessCy} py={surpExcessPy}
          autoCY={surpExcessCy || undefined}
          autoPY={surpExcessPy || undefined}
          isOverriddenCy={isOverridden("bs_liab.reserves_surplus.surplus_excess_short_cy")}
          isOverriddenPy={isOverridden("bs_liab.reserves_surplus.surplus_excess_short_py")}
          onCommitCy={(v) => updatePath("bs_liab.reserves_surplus.surplus_excess_short_cy", v)}
          onCommitPy={(v) => updatePath("bs_liab.reserves_surplus.surplus_excess_short_py", v)}
          onResetCy={() => resetPath("bs_liab.reserves_surplus.surplus_excess_short_cy")}
          onResetPy={() => resetPath("bs_liab.reserves_surplus.surplus_excess_short_py")}
        />

        {/* Sub-total [b] */}
        <SubTotalRow label="Sub-total [b]" cVal={subtotalBCy} pVal={subtotalBPy} />

        {/* Total — authoritative COA-mapped figure (overrideable) */}
        <EditableRow
          label="Total — Reserves and surplus (per BS)"
          cy={cy("reserves_surplus")} py={py("reserves_surplus")}
          autoCY={cy("reserves_surplus")} autoPY={py("reserves_surplus")}
          isOverriddenCy={isOverridden("bs_liab.reserves_surplus.cy")}
          isOverriddenPy={isOverridden("bs_liab.reserves_surplus.py")}
          onCommitCy={(v) => updatePath("bs_liab.reserves_surplus.cy", v)}
          onCommitPy={(v) => updatePath("bs_liab.reserves_surplus.py", v)}
          onResetCy={() => resetPath("bs_liab.reserves_surplus.cy")}
          onResetPy={() => resetPath("bs_liab.reserves_surplus.py")}
          bold
        />
      </NoteCard>

      {/* ════════════════════════════════════════════════════════════════════
          NOTES 3–10 (unchanged)
      ════════════════════════════════════════════════════════════════════ */}

      <NoteCard collapseControl={collapseControl} noteNo={sn("lt_borrowings")} title="Long-term borrowings">
        <NoteHeaderRow cyLabel={cyDateLbl} pyLabel={pyDateLbl} />
        <ListTable
          rows={(get("bs_liab.lt_borrowings.breakup") ?? []) as ListRow[]}
          onChange={(next) => updatePath("bs_liab.lt_borrowings.breakup", next)}
          descPlaceholder="Bank / party / loan particulars (Secured / Unsecured)"
          addLabel="Add row"
          showSubtotal
          onRemapLedger={onRemapLedger}
          onUnmapLedger={onUnmapLedger}
        />
        <EditableRow
          label="Total — Long-term borrowings (per BS)"
          cy={cy("lt_borrowings")} py={effectivePY("lt_borrowings")}
          autoCY={cy("lt_borrowings")} autoPY={effectivePY("lt_borrowings")}
          isOverriddenCy={isOverridden("bs_liab.lt_borrowings.cy")}
          isOverriddenPy={isOverridden("bs_liab.lt_borrowings.py")}
          onCommitCy={(v) => updatePath("bs_liab.lt_borrowings.cy", v)}
          onCommitPy={(v) => updatePath("bs_liab.lt_borrowings.py", v)}
          onResetCy={() => resetPath("bs_liab.lt_borrowings.cy")}
          onResetPy={() => resetPath("bs_liab.lt_borrowings.py")}
          bold
        />
      </NoteCard>

      <NoteCard collapseControl={collapseControl} noteNo={sn("deferred_tax_liab")} title="Deferred tax liabilities (Net)">
        <NoteHeaderRow cyLabel={cyDateLbl} pyLabel={pyDateLbl} />
        <EditableRow
          label="Excess of depreciation claimed in IT Act over books"
          cy={Number(get("bs_liab.deferred_tax_liab.depr_excess_cy") ?? 0)}
          py={Number(get("bs_liab.deferred_tax_liab.depr_excess_py") ?? 0)}
          isOverriddenCy={isOverridden("bs_liab.deferred_tax_liab.depr_excess_cy")}
          isOverriddenPy={isOverridden("bs_liab.deferred_tax_liab.depr_excess_py")}
          onCommitCy={(v) => updatePath("bs_liab.deferred_tax_liab.depr_excess_cy", v)}
          onCommitPy={(v) => updatePath("bs_liab.deferred_tax_liab.depr_excess_py", v)}
        />
        <ListTable
          rows={(get("bs_liab.deferred_tax_liab.breakup") ?? []) as ListRow[]}
          onChange={(next) => updatePath("bs_liab.deferred_tax_liab.breakup", next)}
          descPlaceholder="Other timing differences"
          addLabel="Add row"
          onRemapLedger={onRemapLedger}
          onUnmapLedger={onUnmapLedger}
        />
        <EditableRow
          label="Total — Deferred tax liabilities (per BS)"
          cy={cy("deferred_tax_liab")} py={effectivePY("deferred_tax_liab")}
          autoCY={cy("deferred_tax_liab")} autoPY={effectivePY("deferred_tax_liab")}
          isOverriddenCy={isOverridden("bs_liab.deferred_tax_liab.cy")}
          isOverriddenPy={isOverridden("bs_liab.deferred_tax_liab.py")}
          onCommitCy={(v) => updatePath("bs_liab.deferred_tax_liab.cy", v)}
          onCommitPy={(v) => updatePath("bs_liab.deferred_tax_liab.py", v)}
          onResetCy={() => resetPath("bs_liab.deferred_tax_liab.cy")}
          onResetPy={() => resetPath("bs_liab.deferred_tax_liab.py")}
          bold
        />
      </NoteCard>

      <NoteCard collapseControl={collapseControl} noteNo={sn("other_lt_liabilities", "other_lt_liab")} title="Other long-term liabilities">
        <NoteHeaderRow cyLabel={cyDateLbl} pyLabel={pyDateLbl} />
        <ListTable
          rows={(get("bs_liab.other_lt_liabilities.breakup") ?? []) as ListRow[]}
          onChange={(next) => updatePath("bs_liab.other_lt_liabilities.breakup", next)}
          descPlaceholder="(a) Trade payables / (b) Rent deposit / (c) Others"
          addLabel="Add row"
          onRemapLedger={onRemapLedger}
          onUnmapLedger={onUnmapLedger}
        />
        <EditableRow
          label="Total (per BS)"
          cy={cy("other_lt_liabilities")} py={effectivePY("other_lt_liabilities")}
          autoCY={cy("other_lt_liabilities")} autoPY={effectivePY("other_lt_liabilities")}
          isOverriddenCy={isOverridden("bs_liab.other_lt_liabilities.cy")}
          isOverriddenPy={isOverridden("bs_liab.other_lt_liabilities.py")}
          onCommitCy={(v) => updatePath("bs_liab.other_lt_liabilities.cy", v)}
          onCommitPy={(v) => updatePath("bs_liab.other_lt_liabilities.py", v)}
          onResetCy={() => resetPath("bs_liab.other_lt_liabilities.cy")}
          onResetPy={() => resetPath("bs_liab.other_lt_liabilities.py")}
          bold
        />
      </NoteCard>

      <NoteCard collapseControl={collapseControl} noteNo={sn("lt_provisions")} title="Long-term provisions">
        <NoteHeaderRow cyLabel={cyDateLbl} pyLabel={pyDateLbl} />
        <ListTable
          rows={(get("bs_liab.lt_provisions.breakup") ?? []) as ListRow[]}
          onChange={(next) => updatePath("bs_liab.lt_provisions.breakup", next)}
          descPlaceholder="(a) Provision for employee benefits / (b) Others"
          addLabel="Add row"
          onRemapLedger={onRemapLedger}
          onUnmapLedger={onUnmapLedger}
        />
        <EditableRow
          label="Total (per BS)"
          cy={cy("lt_provisions")} py={effectivePY("lt_provisions")}
          autoCY={cy("lt_provisions")} autoPY={effectivePY("lt_provisions")}
          isOverriddenCy={isOverridden("bs_liab.lt_provisions.cy")}
          isOverriddenPy={isOverridden("bs_liab.lt_provisions.py")}
          onCommitCy={(v) => updatePath("bs_liab.lt_provisions.cy", v)}
          onCommitPy={(v) => updatePath("bs_liab.lt_provisions.py", v)}
          onResetCy={() => resetPath("bs_liab.lt_provisions.cy")}
          onResetPy={() => resetPath("bs_liab.lt_provisions.py")}
          bold
        />
      </NoteCard>

      <NoteCard collapseControl={collapseControl} noteNo={sn("st_borrowings")} title="Short-term borrowings">
        <NoteHeaderRow cyLabel={cyDateLbl} pyLabel={pyDateLbl} />
        <ListTable
          rows={(get("bs_liab.st_borrowings.breakup") ?? []) as ListRow[]}
          onChange={(next) => updatePath("bs_liab.st_borrowings.breakup", next)}
          descPlaceholder="Bank OD / CC / Term loan / party (Secured / Unsecured)"
          addLabel="Add row"
          showSubtotal
          onRemapLedger={onRemapLedger}
          onUnmapLedger={onUnmapLedger}
        />
        <EditableRow
          label="Total — Short-term borrowings (per BS)"
          cy={cy("st_borrowings")} py={effectivePY("st_borrowings")}
          autoCY={cy("st_borrowings")} autoPY={effectivePY("st_borrowings")}
          isOverriddenCy={isOverridden("bs_liab.st_borrowings.cy")}
          isOverriddenPy={isOverridden("bs_liab.st_borrowings.py")}
          onCommitCy={(v) => updatePath("bs_liab.st_borrowings.cy", v)}
          onCommitPy={(v) => updatePath("bs_liab.st_borrowings.py", v)}
          onResetCy={() => resetPath("bs_liab.st_borrowings.cy")}
          onResetPy={() => resetPath("bs_liab.st_borrowings.py")}
          bold
        />
      </NoteCard>

      <NoteCard collapseControl={collapseControl} noteNo={sn("trade_payables")} title="Trade Payables">
        <NoteHeaderRow cyLabel={cyDateLbl} pyLabel={pyDateLbl} />
        <EditableRow
          label="Total outstanding dues of Micro and Small Enterprises"
          cy={Number(get("bs_liab.trade_payables.msme_cy") ?? 0)}
          py={Number(get("bs_liab.trade_payables.msme_py") ?? 0)}
          isOverriddenCy={isOverridden("bs_liab.trade_payables.msme_cy")}
          isOverriddenPy={isOverridden("bs_liab.trade_payables.msme_py")}
          onCommitCy={(v) => updatePath("bs_liab.trade_payables.msme_cy", v)}
          onCommitPy={(v) => updatePath("bs_liab.trade_payables.msme_py", v)}
        />
        <EditableRow
          label="Total outstanding dues of others"
          cy={Number(get("bs_liab.trade_payables.others_cy") ?? cy("trade_payables"))}
          py={Number(get("bs_liab.trade_payables.others_py") ?? py("trade_payables"))}
          autoCY={cy("trade_payables")} autoPY={py("trade_payables")}
          isOverriddenCy={isOverridden("bs_liab.trade_payables.others_cy")}
          isOverriddenPy={isOverridden("bs_liab.trade_payables.others_py")}
          onCommitCy={(v) => updatePath("bs_liab.trade_payables.others_cy", v)}
          onCommitPy={(v) => updatePath("bs_liab.trade_payables.others_py", v)}
          onResetCy={() => resetPath("bs_liab.trade_payables.others_cy")}
          onResetPy={() => resetPath("bs_liab.trade_payables.others_py")}
        />
        <EditableRow
          label="Total — Trade Payables (per BS)"
          cy={cy("trade_payables")} py={py("trade_payables")}
          autoCY={cy("trade_payables")} autoPY={py("trade_payables")}
          isOverriddenCy={isOverridden("bs_liab.trade_payables.cy")}
          isOverriddenPy={isOverridden("bs_liab.trade_payables.py")}
          onCommitCy={(v) => updatePath("bs_liab.trade_payables.cy", v)}
          onCommitPy={(v) => updatePath("bs_liab.trade_payables.py", v)}
          onResetCy={() => resetPath("bs_liab.trade_payables.cy")}
          onResetPy={() => resetPath("bs_liab.trade_payables.py")}
          bold
        />

        <div className="text-[10px] italic text-muted-foreground mt-3">Notes (free text)</div>
        <EditableCell
          type="text"
          value={get("bs_liab.trade_payables.note_1") ?? "1. There are no Unbilled and Not due trade payables."}
          onCommit={(v) => updatePath("bs_liab.trade_payables.note_1", String(v ?? ""))}
        />
        <EditableCell
          type="text"
          value={get("bs_liab.trade_payables.note_2") ?? "2. As declared and certified by the management."}
          onCommit={(v) => updatePath("bs_liab.trade_payables.note_2", String(v ?? ""))}
        />
      </NoteCard>

      <NoteCard collapseControl={collapseControl} noteNo={sn("other_curr_liab", "other_current_liab")} title="Other current liabilities">
        <NoteHeaderRow cyLabel={cyDateLbl} pyLabel={pyDateLbl} />
        <ListTable
          rows={(get("bs_liab.other_curr_liab.breakup") ?? []) as ListRow[]}
          onChange={(next) => updatePath("bs_liab.other_curr_liab.breakup", next)}
          descPlaceholder="Current maturities / Interest accrued / Statutory dues / Advance / Provision for tax"
          addLabel="Add row"
          onRemapLedger={onRemapLedger}
          onUnmapLedger={onUnmapLedger}
        />
        <EditableRow
          label="Total (per BS)"
          cy={cy("other_curr_liab")} py={effectivePY("other_curr_liab")}
          autoCY={cy("other_curr_liab")} autoPY={effectivePY("other_curr_liab")}
          isOverriddenCy={isOverridden("bs_liab.other_curr_liab.cy")}
          isOverriddenPy={isOverridden("bs_liab.other_curr_liab.py")}
          onCommitCy={(v) => updatePath("bs_liab.other_curr_liab.cy", v)}
          onCommitPy={(v) => updatePath("bs_liab.other_curr_liab.py", v)}
          onResetCy={() => resetPath("bs_liab.other_curr_liab.cy")}
          onResetPy={() => resetPath("bs_liab.other_curr_liab.py")}
          bold
        />
      </NoteCard>

      <NoteCard collapseControl={collapseControl} noteNo={sn("st_provisions")} title="Short-term provisions">
        <NoteHeaderRow cyLabel={cyDateLbl} pyLabel={pyDateLbl} />
        <ListTable
          rows={(get("bs_liab.st_provisions.breakup") ?? []) as ListRow[]}
          onChange={(next) => updatePath("bs_liab.st_provisions.breakup", next)}
          descPlaceholder="(a) Employee benefits / (b) Income tax / (c) Expenses"
          addLabel="Add row"
          onRemapLedger={onRemapLedger}
          onUnmapLedger={onUnmapLedger}
        />
        <EditableRow
          label="Total (per BS)"
          cy={cy("st_provisions")} py={effectivePY("st_provisions")}
          autoCY={cy("st_provisions")} autoPY={effectivePY("st_provisions")}
          isOverriddenCy={isOverridden("bs_liab.st_provisions.cy")}
          isOverriddenPy={isOverridden("bs_liab.st_provisions.py")}
          onCommitCy={(v) => updatePath("bs_liab.st_provisions.cy", v)}
          onCommitPy={(v) => updatePath("bs_liab.st_provisions.py", v)}
          onResetCy={() => resetPath("bs_liab.st_provisions.cy")}
          onResetPy={() => resetPath("bs_liab.st_provisions.py")}
          bold
        />
      </NoteCard>
    </div>
  );
}
