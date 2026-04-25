/**
 * NoteBSLiab — Notes 3–11 (BS Liabilities side).
 *
 * Each note section reads its CY/PY auto values from the Stage5Notes object
 * (populated by notesAutoPopulate) and offers inline-editable cells routed
 * through the parent's updatePath / resetPath helpers. Manual sub-row
 * break-ups are stored under the same path scope as `<noteKey>.breakup`,
 * so the auto total from the registry stays untouched.
 */

import {
  EditableCell, EditableRow, NoteCard, NoteHeaderRow, ListTable, AgeingTable,
  type ListRow, type AgeingMatrix,
} from "./EditableCell";
import type { Stage5Notes } from "@/lib/notesAutoPopulate";

interface Props {
  notes:          Stage5Notes;
  cyYear:         number;
  pyYear:         number;
  updatePath:     (path: string, value: any) => void;
  resetPath:      (path: string) => void;
  isOverridden:   (path: string) => boolean;
}

export default function NoteBSLiab({
  notes, cyYear, pyYear, updatePath, resetPath, isOverridden,
}: Props) {
  const cy = (key: string) => Number(notes.bs_liab[key]?.cy ?? 0);
  const py = (key: string) => Number(notes.bs_liab[key]?.py ?? 0);
  const get = (path: string) => path.split(".").reduce<any>((c, k) => c?.[k], notes);

  // Trade Payables ageing schemas
  const TP_ROWS = [
    { key: "msme",          label: "(i) MSME" },
    { key: "others",        label: "(ii) Others" },
    { key: "disp_msme",     label: "(iii) Disputed dues — MSME" },
    { key: "disp_others",   label: "(iv) Disputed dues — Others" },
  ];
  const TP_BUCKETS = [
    { key: "lt1",  label: "< 1 yr" },
    { key: "1_2",  label: "1-2 yrs" },
    { key: "2_3",  label: "2-3 yrs" },
    { key: "gt3",  label: "> 3 yrs" },
  ];

  return (
    <div className="space-y-4">
      <NoteCard noteNo={3} title="Share capital">
        <NoteHeaderRow cyLabel={`As at 31-Mar-${cyYear}`} pyLabel={`As at 31-Mar-${pyYear}`} />

        <div className="text-[10px] italic text-muted-foreground mt-1">Authorised shares</div>
        <EditableCell
          type="text"
          value={get("bs_liab.share_capital.authorised_text") ?? ""}
          placeholder="e.g. 1,00,000 equity shares of Rs. 10 each"
          onCommit={(v) => updatePath("bs_liab.share_capital.authorised_text", String(v ?? ""))}
        />

        <div className="text-[10px] italic text-muted-foreground mt-2">Issued, subscribed and fully paid up shares</div>
        <EditableRow
          label="Total share capital (per BS)"
          cy={cy("share_capital")} py={py("share_capital")}
          autoCY={cy("share_capital")} autoPY={py("share_capital")}
          isOverriddenCy={isOverridden("bs_liab.share_capital.cy")}
          isOverriddenPy={isOverridden("bs_liab.share_capital.py")}
          onCommitCy={(v) => updatePath("bs_liab.share_capital.cy", v)}
          onCommitPy={(v) => updatePath("bs_liab.share_capital.py", v)}
          onResetCy={() => resetPath("bs_liab.share_capital.cy")}
          onResetPy={() => resetPath("bs_liab.share_capital.py")}
          bold
        />

        <div className="text-[10px] italic text-muted-foreground mt-2">(a) Reconciliation of shares outstanding</div>
        <ListTable
          rows={(get("bs_liab.share_capital.reconciliation") ?? []) as ListRow[]}
          onChange={(next) => updatePath("bs_liab.share_capital.reconciliation", next)}
          descPlaceholder="Opening / Issued during the year / Buyback / Closing"
          addLabel="Add reconciliation row"
        />

        <div className="text-[10px] italic text-muted-foreground mt-2">(b) Particulars of shareholders holding &gt; 5%</div>
        <ListTable
          rows={(get("bs_liab.share_capital.shareholders_5pc") ?? []) as ListRow[]}
          onChange={(next) => updatePath("bs_liab.share_capital.shareholders_5pc", next)}
          descPlaceholder="Shareholder name (no. of shares + %)"
          addLabel="Add shareholder"
        />

        <div className="text-[10px] italic text-muted-foreground mt-2">(c) Promoters' shareholding</div>
        <ListTable
          rows={(get("bs_liab.share_capital.promoters") ?? []) as ListRow[]}
          onChange={(next) => updatePath("bs_liab.share_capital.promoters", next)}
          descPlaceholder="Promoter name (no. of shares + % change vs PY)"
          addLabel="Add promoter"
        />
      </NoteCard>

      <NoteCard noteNo={4} title="Reserves and surplus">
        <NoteHeaderRow cyLabel={`As at 31-Mar-${cyYear}`} pyLabel={`As at 31-Mar-${pyYear}`} />
        <EditableRow
          label="1. General Reserve"
          cy={Number(get("bs_liab.reserves_surplus.general_reserve_cy") ?? 0)}
          py={Number(get("bs_liab.reserves_surplus.general_reserve_py") ?? 0)}
          isOverriddenCy={isOverridden("bs_liab.reserves_surplus.general_reserve_cy")}
          isOverriddenPy={isOverridden("bs_liab.reserves_surplus.general_reserve_py")}
          onCommitCy={(v) => updatePath("bs_liab.reserves_surplus.general_reserve_cy", v)}
          onCommitPy={(v) => updatePath("bs_liab.reserves_surplus.general_reserve_py", v)}
        />
        <EditableRow
          label="2. Share Premium"
          cy={Number(get("bs_liab.reserves_surplus.share_premium_cy") ?? 0)}
          py={Number(get("bs_liab.reserves_surplus.share_premium_py") ?? 0)}
          onCommitCy={(v) => updatePath("bs_liab.reserves_surplus.share_premium_cy", v)}
          onCommitPy={(v) => updatePath("bs_liab.reserves_surplus.share_premium_py", v)}
          isOverriddenCy={isOverridden("bs_liab.reserves_surplus.share_premium_cy")}
          isOverriddenPy={isOverridden("bs_liab.reserves_surplus.share_premium_py")}
        />
        <div className="text-[10px] italic text-muted-foreground mt-2">Surplus in Statement of P&amp;L</div>
        <ListTable
          rows={(get("bs_liab.reserves_surplus.surplus_breakup") ?? []) as ListRow[]}
          onChange={(next) => updatePath("bs_liab.reserves_surplus.surplus_breakup", next)}
          descPlaceholder="Opening / Profit for the year / Deferred tax adj / Excess provision IT / Closing"
          addLabel="Add surplus row"
        />

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

      <NoteCard noteNo={5} title="Long-term borrowings">
        <NoteHeaderRow cyLabel={`As at 31-Mar-${cyYear}`} pyLabel={`As at 31-Mar-${pyYear}`} />

        <div className="text-[10px] italic text-muted-foreground mt-1">(A) Secured Loans → Term loans → (i) From banks</div>
        <ListTable
          rows={(get("bs_liab.lt_borrowings.secured_term_loans") ?? []) as ListRow[]}
          onChange={(next) => updatePath("bs_liab.lt_borrowings.secured_term_loans", next)}
          descPlaceholder="Bank name / loan particulars"
          addLabel="Add term loan"
        />

        <div className="text-[10px] italic text-muted-foreground mt-2">(B) Unsecured</div>
        <ListTable
          rows={(get("bs_liab.lt_borrowings.unsecured") ?? []) as ListRow[]}
          onChange={(next) => updatePath("bs_liab.lt_borrowings.unsecured", next)}
          descPlaceholder="Loans from related parties / Directors / Others"
          addLabel="Add unsecured loan"
        />

        <EditableRow
          label="Total — Long-term borrowings (per BS)"
          cy={cy("lt_borrowings")} py={py("lt_borrowings")}
          autoCY={cy("lt_borrowings")} autoPY={py("lt_borrowings")}
          isOverriddenCy={isOverridden("bs_liab.lt_borrowings.cy")}
          isOverriddenPy={isOverridden("bs_liab.lt_borrowings.py")}
          onCommitCy={(v) => updatePath("bs_liab.lt_borrowings.cy", v)}
          onCommitPy={(v) => updatePath("bs_liab.lt_borrowings.py", v)}
          onResetCy={() => resetPath("bs_liab.lt_borrowings.cy")}
          onResetPy={() => resetPath("bs_liab.lt_borrowings.py")}
          bold
        />
      </NoteCard>

      <NoteCard noteNo={6} title="Other long-term liabilities">
        <NoteHeaderRow cyLabel={`As at 31-Mar-${cyYear}`} pyLabel={`As at 31-Mar-${pyYear}`} />
        <ListTable
          rows={(get("bs_liab.other_lt_liabilities.breakup") ?? []) as ListRow[]}
          onChange={(next) => updatePath("bs_liab.other_lt_liabilities.breakup", next)}
          descPlaceholder="(a) Trade payables / (b) Rent deposit / (c) Others"
          addLabel="Add row"
        />
        <EditableRow
          label="Total (per BS)"
          cy={cy("other_lt_liabilities")} py={py("other_lt_liabilities")}
          autoCY={cy("other_lt_liabilities")} autoPY={py("other_lt_liabilities")}
          isOverriddenCy={isOverridden("bs_liab.other_lt_liabilities.cy")}
          isOverriddenPy={isOverridden("bs_liab.other_lt_liabilities.py")}
          onCommitCy={(v) => updatePath("bs_liab.other_lt_liabilities.cy", v)}
          onCommitPy={(v) => updatePath("bs_liab.other_lt_liabilities.py", v)}
          onResetCy={() => resetPath("bs_liab.other_lt_liabilities.cy")}
          onResetPy={() => resetPath("bs_liab.other_lt_liabilities.py")}
          bold
        />
      </NoteCard>

      <NoteCard noteNo={7} title="Long-term provisions">
        <NoteHeaderRow cyLabel={`As at 31-Mar-${cyYear}`} pyLabel={`As at 31-Mar-${pyYear}`} />
        <ListTable
          rows={(get("bs_liab.lt_provisions.breakup") ?? []) as ListRow[]}
          onChange={(next) => updatePath("bs_liab.lt_provisions.breakup", next)}
          descPlaceholder="(a) Provision for employee benefits / (b) Others"
          addLabel="Add row"
        />
        <EditableRow
          label="Total (per BS)"
          cy={cy("lt_provisions")} py={py("lt_provisions")}
          autoCY={cy("lt_provisions")} autoPY={py("lt_provisions")}
          isOverriddenCy={isOverridden("bs_liab.lt_provisions.cy")}
          isOverriddenPy={isOverridden("bs_liab.lt_provisions.py")}
          onCommitCy={(v) => updatePath("bs_liab.lt_provisions.cy", v)}
          onCommitPy={(v) => updatePath("bs_liab.lt_provisions.py", v)}
          onResetCy={() => resetPath("bs_liab.lt_provisions.cy")}
          onResetPy={() => resetPath("bs_liab.lt_provisions.py")}
          bold
        />
      </NoteCard>

      <NoteCard noteNo={8} title="Short-term borrowings">
        <NoteHeaderRow cyLabel={`As at 31-Mar-${cyYear}`} pyLabel={`As at 31-Mar-${pyYear}`} />
        <div className="text-[10px] italic text-muted-foreground mt-1">(A) Secured (OD / CC / Term loan)</div>
        <ListTable
          rows={(get("bs_liab.st_borrowings.secured") ?? []) as ListRow[]}
          onChange={(next) => updatePath("bs_liab.st_borrowings.secured", next)}
          descPlaceholder="Particulars"
          addLabel="Add secured loan"
        />
        <div className="text-[10px] italic text-muted-foreground mt-2">(B) Unsecured</div>
        <ListTable
          rows={(get("bs_liab.st_borrowings.unsecured") ?? []) as ListRow[]}
          onChange={(next) => updatePath("bs_liab.st_borrowings.unsecured", next)}
          descPlaceholder="Loans from related parties / Other loans"
          addLabel="Add unsecured loan"
        />
        <EditableRow
          label="Total — Short-term borrowings (per BS)"
          cy={cy("st_borrowings")} py={py("st_borrowings")}
          autoCY={cy("st_borrowings")} autoPY={py("st_borrowings")}
          isOverriddenCy={isOverridden("bs_liab.st_borrowings.cy")}
          isOverriddenPy={isOverridden("bs_liab.st_borrowings.py")}
          onCommitCy={(v) => updatePath("bs_liab.st_borrowings.cy", v)}
          onCommitPy={(v) => updatePath("bs_liab.st_borrowings.py", v)}
          onResetCy={() => resetPath("bs_liab.st_borrowings.cy")}
          onResetPy={() => resetPath("bs_liab.st_borrowings.py")}
          bold
        />
      </NoteCard>

      <NoteCard noteNo={9} title="Trade Payables">
        <NoteHeaderRow cyLabel={`As at 31-Mar-${cyYear}`} pyLabel={`As at 31-Mar-${pyYear}`} />
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

        <div className="font-semibold text-[11px] mt-3">Trade Payables Ageing — CY ({cyYear})</div>
        <AgeingTable
          rowDefs={TP_ROWS} bucketDefs={TP_BUCKETS}
          matrix={get("bs_liab.trade_payables.ageing_cy") as AgeingMatrix | undefined}
          onChange={(m) => updatePath("bs_liab.trade_payables.ageing_cy", m)}
        />

        <div className="font-semibold text-[11px] mt-3">Trade Payables Ageing — PY ({pyYear})</div>
        <AgeingTable
          rowDefs={TP_ROWS} bucketDefs={TP_BUCKETS}
          matrix={get("bs_liab.trade_payables.ageing_py") as AgeingMatrix | undefined}
          onChange={(m) => updatePath("bs_liab.trade_payables.ageing_py", m)}
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

      <NoteCard noteNo={10} title="Other current liabilities">
        <NoteHeaderRow cyLabel={`As at 31-Mar-${cyYear}`} pyLabel={`As at 31-Mar-${pyYear}`} />
        <ListTable
          rows={(get("bs_liab.other_curr_liab.breakup") ?? []) as ListRow[]}
          onChange={(next) => updatePath("bs_liab.other_curr_liab.breakup", next)}
          descPlaceholder="Current maturities / Interest accrued / Statutory dues / Advance / Provision for tax"
          addLabel="Add row"
        />
        <EditableRow
          label="Total (per BS)"
          cy={cy("other_curr_liab")} py={py("other_curr_liab")}
          autoCY={cy("other_curr_liab")} autoPY={py("other_curr_liab")}
          isOverriddenCy={isOverridden("bs_liab.other_curr_liab.cy")}
          isOverriddenPy={isOverridden("bs_liab.other_curr_liab.py")}
          onCommitCy={(v) => updatePath("bs_liab.other_curr_liab.cy", v)}
          onCommitPy={(v) => updatePath("bs_liab.other_curr_liab.py", v)}
          onResetCy={() => resetPath("bs_liab.other_curr_liab.cy")}
          onResetPy={() => resetPath("bs_liab.other_curr_liab.py")}
          bold
        />
      </NoteCard>

      <NoteCard noteNo={11} title="Short-term provisions">
        <NoteHeaderRow cyLabel={`As at 31-Mar-${cyYear}`} pyLabel={`As at 31-Mar-${pyYear}`} />
        <ListTable
          rows={(get("bs_liab.st_provisions.breakup") ?? []) as ListRow[]}
          onChange={(next) => updatePath("bs_liab.st_provisions.breakup", next)}
          descPlaceholder="(a) Employee benefits / (b) Income tax / (c) Expenses"
          addLabel="Add row"
        />
        <EditableRow
          label="Total (per BS)"
          cy={cy("st_provisions")} py={py("st_provisions")}
          autoCY={cy("st_provisions")} autoPY={py("st_provisions")}
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
