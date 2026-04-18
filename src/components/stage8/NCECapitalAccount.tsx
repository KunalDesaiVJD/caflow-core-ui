import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Save } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

interface PartnerRow {
  partner_no: number;          // 1 – 4
  partner_name: string;
  profit_share_pct: number;
  opening_balance_cy: number;
  introduced_cy: number;
  remuneration_cy: number;
  interest_cy: number;
  withdrawals_cy: number;
  profit_share_cy: number;
}

interface PyRow {
  opening: number;
  introduced: number;
  remuneration: number;
  interest: number;
  withdrawals: number;
  profit_share: number;
}

// PY aggregate is stored as partner_no = 99 (sentinel value)
const PY_SENTINEL = 99;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emptyPartner(num: number): PartnerRow {
  return {
    partner_no: num, partner_name: "",
    profit_share_pct: 0, opening_balance_cy: 0,
    introduced_cy: 0, remuneration_cy: 0,
    interest_cy: 0, withdrawals_cy: 0, profit_share_cy: 0,
  };
}

const EMPTY_PY: PyRow = {
  opening: 0, introduced: 0, remuneration: 0,
  interest: 0, withdrawals: 0, profit_share: 0,
};

function calcClosing(p: PartnerRow): number {
  return p.opening_balance_cy
    + p.introduced_cy
    + p.remuneration_cy
    + p.interest_cy
    - p.withdrawals_cy
    + p.profit_share_cy;
}

function calcPyClosing(py: PyRow): number {
  return py.opening + py.introduced + py.remuneration
       + py.interest - py.withdrawals + py.profit_share;
}

// Inline numeric input — defined outside component to avoid React warning
function NumInput({
  value, onChange, className,
}: {
  value: number;
  onChange: (v: number) => void;
  className?: string;
}) {
  return (
    <Input
      type="number"
      value={value === 0 ? "" : value}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      className={cn("h-7 text-xs text-right px-1 w-24", className)}
    />
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  engagementId: string;
}

export function NCECapitalAccount({ engagementId }: Props) {
  const [partners, setPartners] = useState<PartnerRow[]>(
    [1, 2, 3, 4].map(emptyPartner)
  );
  const [pyRow, setPyRow]   = useState<PyRow>(EMPTY_PY);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [eng,     setEng]     = useState<any>(null);

  // ── Derived year labels (from self-fetched engagement) ───────────────────
  const fy      = (eng?.financial_year as string) || "";
  const cyYear  = fy ? parseInt(fy.split("-")[1]) + 2000 : new Date().getFullYear();
  const pyYear  = cyYear - 1;
  const clientName: string = eng?.clients?.name || "";

  // ── Load saved rows ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!engagementId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);

      // 1. Fetch engagement — get FY, client name, firm, partner
      const { data: engRow } = await supabase
        .from("audit_engagements")
        .select("financial_year, clients(name), firms(*), partner:users!partner_id(name)")
        .eq("id", engagementId)
        .single();
      if (cancelled) return;
      if (engRow) setEng(engRow);

      const activeFY = (engRow?.financial_year as string) || "";
      if (!activeFY) { setLoading(false); return; }

      // 2. Fetch capital account rows
      const { data, error } = await supabase
        .from("nce_capital_account")
        .select("*")
        .eq("engagement_id", engagementId)
        .eq("financial_year", activeFY);

      if (error) {
        toast.error("Failed to load capital account data");
      } else if (data && data.length > 0) {
        // Populate partner rows 1–4
        setPartners([1, 2, 3, 4].map(num => {
          const row = data.find(r => r.partner_no === num);
          if (!row) return emptyPartner(num);
          return {
            partner_no: num,
            partner_name:       row.partner_name        ?? "",
            profit_share_pct:   row.profit_share_pct    ?? 0,
            opening_balance_cy: row.opening_balance_cy  ?? 0,
            introduced_cy:      row.introduced_cy       ?? 0,
            remuneration_cy:    row.remuneration_cy     ?? 0,
            interest_cy:        row.interest_cy         ?? 0,
            withdrawals_cy:     row.withdrawals_cy      ?? 0,
            profit_share_cy:    row.profit_share_cy     ?? 0,
          };
        }));

        // Populate PY aggregate row (sentinel = 99)
        const py = data.find(r => r.partner_no === PY_SENTINEL);
        if (py) {
          setPyRow({
            opening:     py.opening_balance_cy ?? 0,
            introduced:  py.introduced_cy      ?? 0,
            remuneration:py.remuneration_cy    ?? 0,
            interest:    py.interest_cy        ?? 0,
            withdrawals: py.withdrawals_cy     ?? 0,
            profit_share:py.profit_share_cy    ?? 0,
          });
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [engagementId]);

  // ── Computed totals (CY) ──────────────────────────────────────────────────
  const totals = useMemo(() => ({
    opening:      partners.reduce((s, p) => s + p.opening_balance_cy, 0),
    introduced:   partners.reduce((s, p) => s + p.introduced_cy, 0),
    remuneration: partners.reduce((s, p) => s + p.remuneration_cy, 0),
    interest:     partners.reduce((s, p) => s + p.interest_cy, 0),
    withdrawals:  partners.reduce((s, p) => s + p.withdrawals_cy, 0),
    profit_share: partners.reduce((s, p) => s + p.profit_share_cy, 0),
    closing:      partners.reduce((s, p) => s + calcClosing(p), 0),
    pct:          partners.reduce((s, p) => s + p.profit_share_pct, 0),
  }), [partners]);

  const profitShareWarning =
    totals.pct > 0 && Math.abs(totals.pct - 100) > 0.01;

  // ── Mutators ─────────────────────────────────────────────────────────────
  const setPartnerField = (
    idx: number,
    field: keyof PartnerRow,
    value: string | number
  ) =>
    setPartners(prev =>
      prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p))
    );

  const setPyField = (field: keyof PyRow, value: number) =>
    setPyRow(prev => ({ ...prev, [field]: value }));

  // ── Save ─────────────────────────────────────────────────────────────────
  const save = async () => {
    setSaving(true);
    try {
      const rows = [
        // 4 partner rows
        ...partners.map(p => ({
          engagement_id:      engagementId,
          financial_year:     fy,
          partner_no:         p.partner_no,
          partner_name:       p.partner_name || null,
          profit_share_pct:   p.profit_share_pct,
          opening_balance_cy: p.opening_balance_cy,
          introduced_cy:      p.introduced_cy,
          remuneration_cy:    p.remuneration_cy,
          interest_cy:        p.interest_cy,
          withdrawals_cy:     p.withdrawals_cy,
          profit_share_cy:    p.profit_share_cy,
        })),
        // PY aggregate stored as partner_no = 99
        {
          engagement_id:      engagementId,
          financial_year:     fy,
          partner_no:         PY_SENTINEL,
          partner_name:       "Previous Year",
          profit_share_pct:   null,
          opening_balance_cy: pyRow.opening,
          introduced_cy:      pyRow.introduced,
          remuneration_cy:    pyRow.remuneration,
          interest_cy:        pyRow.interest,
          withdrawals_cy:     pyRow.withdrawals,
          profit_share_cy:    pyRow.profit_share,
        },
      ];

      const { error } = await supabase
        .from("nce_capital_account")
        .upsert(rows, {
          onConflict: "engagement_id,financial_year,partner_no",
        });

      if (error) throw error;
      toast.success("Capital Account saved");
    } catch (e: any) {
      toast.error(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // ── Formatting ────────────────────────────────────────────────────────────
  const fmt = (n: number) =>
    n === 0 ? "—" : n.toLocaleString("en-IN");

  // ── Loading guard ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="text-center space-y-1 pb-3 border-b">
        {clientName && (
          <p className="font-bold text-sm text-foreground">{clientName}</p>
        )}
        <p className="text-xs text-muted-foreground">
          Notes forming part of the Financial Statements for the year ended,
          31st March, {cyYear}
        </p>
        <p className="text-xs text-muted-foreground">
          Notes to Balance Sheet as at 31st March, {cyYear}
        </p>
        <p className="text-sm font-semibold text-foreground mt-1">
          Note: Owners Capital Account
        </p>
      </div>

      {/* ── Profit-share warning ── */}
      {profitShareWarning && (
        <Alert variant="destructive" className="py-2">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Share of profit/loss % totals{" "}
            <strong>{totals.pct.toFixed(2)}%</strong> — must equal 100%.
          </AlertDescription>
        </Alert>
      )}

      {/* ── Table ── */}
      <div className="overflow-x-auto rounded-lg border">
        <Table className="text-xs min-w-[960px]">
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-12 text-center">Sr. No.</TableHead>
              <TableHead className="min-w-[150px]">Name of Partner</TableHead>
              <TableHead className="text-right w-20">
                Share of profit/ (loss)%
              </TableHead>
              <TableHead className="text-right w-28">Opening Balance</TableHead>
              <TableHead className="text-right w-28">
                Introduced/ Contributed
              </TableHead>
              <TableHead className="text-right w-28">
                Remuneration for the year
              </TableHead>
              <TableHead className="text-right w-24">
                Interest for the year
              </TableHead>
              <TableHead className="text-right w-28">
                Withdrawals during the year
              </TableHead>
              <TableHead className="text-right w-28">
                Share of Profit/ (Loss)
              </TableHead>
              <TableHead className="text-right w-28 bg-primary/5 font-semibold">
                Closing Balance
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {/* ── Partner rows 1–4 ── */}
            {partners.map((p, i) => {
              const closing = calcClosing(p);
              return (
                <TableRow key={p.partner_no} className="hover:bg-muted/20">
                  <TableCell className="text-center font-medium">
                    {p.partner_no}
                  </TableCell>

                  {/* Name */}
                  <TableCell>
                    <Input
                      value={p.partner_name}
                      onChange={e =>
                        setPartnerField(i, "partner_name", e.target.value)
                      }
                      placeholder={`Partner ${p.partner_no}`}
                      className="h-7 text-xs w-36"
                    />
                  </TableCell>

                  {/* Share % */}
                  <TableCell className="text-right">
                    <NumInput
                      value={p.profit_share_pct}
                      onChange={v => setPartnerField(i, "profit_share_pct", v)}
                      className="w-16"
                    />
                  </TableCell>

                  {/* Opening */}
                  <TableCell className="text-right">
                    <NumInput
                      value={p.opening_balance_cy}
                      onChange={v =>
                        setPartnerField(i, "opening_balance_cy", v)
                      }
                    />
                  </TableCell>

                  {/* Introduced */}
                  <TableCell className="text-right">
                    <NumInput
                      value={p.introduced_cy}
                      onChange={v => setPartnerField(i, "introduced_cy", v)}
                    />
                  </TableCell>

                  {/* Remuneration */}
                  <TableCell className="text-right">
                    <NumInput
                      value={p.remuneration_cy}
                      onChange={v => setPartnerField(i, "remuneration_cy", v)}
                    />
                  </TableCell>

                  {/* Interest */}
                  <TableCell className="text-right">
                    <NumInput
                      value={p.interest_cy}
                      onChange={v => setPartnerField(i, "interest_cy", v)}
                    />
                  </TableCell>

                  {/* Withdrawals */}
                  <TableCell className="text-right">
                    <NumInput
                      value={p.withdrawals_cy}
                      onChange={v => setPartnerField(i, "withdrawals_cy", v)}
                    />
                  </TableCell>

                  {/* Profit share */}
                  <TableCell className="text-right">
                    <NumInput
                      value={p.profit_share_cy}
                      onChange={v => setPartnerField(i, "profit_share_cy", v)}
                    />
                  </TableCell>

                  {/* Closing — READ-ONLY, auto-calculated */}
                  <TableCell
                    className={cn(
                      "text-right font-semibold bg-primary/5",
                      closing < 0 && "text-destructive"
                    )}
                  >
                    {fmt(closing)}
                  </TableCell>
                </TableRow>
              );
            })}

            {/* ── Total row (CY) ── */}
            <TableRow className="bg-muted/60 border-t-2 font-semibold">
              <TableCell />
              <TableCell className="text-xs uppercase tracking-wide">
                Total
              </TableCell>
              <TableCell className="text-right text-xs">
                {totals.pct > 0 ? (
                  <span
                    className={cn(
                      profitShareWarning && "text-destructive"
                    )}
                  >
                    {totals.pct.toFixed(2)}%
                  </span>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell className="text-right">{fmt(totals.opening)}</TableCell>
              <TableCell className="text-right">
                {fmt(totals.introduced)}
              </TableCell>
              <TableCell className="text-right">
                {fmt(totals.remuneration)}
              </TableCell>
              <TableCell className="text-right">{fmt(totals.interest)}</TableCell>
              <TableCell className="text-right">
                {fmt(totals.withdrawals)}
              </TableCell>
              <TableCell className="text-right">
                {fmt(totals.profit_share)}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right bg-primary/10 font-bold",
                  totals.closing < 0 && "text-destructive"
                )}
              >
                {fmt(totals.closing)}
              </TableCell>
            </TableRow>

            {/* ── Previous Year (PY) row ── */}
            <TableRow className="bg-blue-50/40 text-muted-foreground">
              <TableCell />
              <TableCell className="text-xs font-medium text-foreground italic">
                Previous Year ({pyYear})
              </TableCell>
              <TableCell />

              <TableCell className="text-right">
                <NumInput
                  value={pyRow.opening}
                  onChange={v => setPyField("opening", v)}
                />
              </TableCell>
              <TableCell className="text-right">
                <NumInput
                  value={pyRow.introduced}
                  onChange={v => setPyField("introduced", v)}
                />
              </TableCell>
              <TableCell className="text-right">
                <NumInput
                  value={pyRow.remuneration}
                  onChange={v => setPyField("remuneration", v)}
                />
              </TableCell>
              <TableCell className="text-right">
                <NumInput
                  value={pyRow.interest}
                  onChange={v => setPyField("interest", v)}
                />
              </TableCell>
              <TableCell className="text-right">
                <NumInput
                  value={pyRow.withdrawals}
                  onChange={v => setPyField("withdrawals", v)}
                />
              </TableCell>
              <TableCell className="text-right">
                <NumInput
                  value={pyRow.profit_share}
                  onChange={v => setPyField("profit_share", v)}
                />
              </TableCell>

              {/* PY closing — also auto-calculated */}
              <TableCell
                className={cn(
                  "text-right bg-primary/5 font-semibold",
                  calcPyClosing(pyRow) < 0 && "text-destructive"
                )}
              >
                {fmt(calcPyClosing(pyRow))}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      {/* ── Actions ── */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-muted-foreground">
          Closing Balance = Opening + Introduced + Remuneration + Interest − Withdrawals + Profit Share
        </p>
        <Button onClick={save} disabled={saving} size="sm" className="gap-1.5">
          {saving
            ? <Loader2 size={13} className="animate-spin" />
            : <Save size={13} />}
          Save Capital Account
        </Button>
      </div>

    </div>
  );
}
