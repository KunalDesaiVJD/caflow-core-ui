/**
 * PartyRateConfigModal
 *
 * Auditor confirms the APPLICABLE TDS rate for every 194C / 194J party
 * BEFORE reconciliation. Rendered from the Reconciliation panel: when
 * the auditor hits "Run Reconciliation" and there are unset overrides,
 * the modal opens with a pre-filled table of parties.
 *
 * Layout per row:
 *    TB ledger  |  Deductee (26Q)  |  Section  |  Gross | TDS filed
 *    (implied actual rate)                                 [radio row]
 *
 * Radio options per section:
 *   • 194C — 1 % (Individual / HUF / Prop.)   OR   2 % (Company / Firm)
 *   • 194J — 10 % (Professional / Consultancy) OR 2 % (Technical Services / Software)
 * PLUS "Other %" free numeric fallback (e.g. 20 % for a non-resident payee).
 *
 * On save: bulk upsert to tds_party_rate_overrides, then call onSaved
 * (the caller re-runs reconciliation).
 */
import { useEffect, useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input }  from "@/components/ui/input";
import { toast }  from "sonner";
import { Loader2, Save, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePartyRateOverrides, PartyRateOverride } from "./hooks/usePartyRateOverrides";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RateEligibleParty {
  tb_ledger_name:    string;
  tds_deductee_name: string;
  section_code:      string;   // "194C" or "194J"
  gross_amount:      number;
  tds_amount:        number;
}

interface Props {
  open:           boolean;
  onOpenChange:   (open: boolean) => void;
  clientId:       string;
  firmId:         string;
  financialYear:  string;
  /** Every 194C / 194J party that needs a rate confirmed. */
  parties:        RateEligibleParty[];
  /** Called after the bulk upsert succeeds; consumer triggers Run Reconciliation. */
  onSaved:        () => void;
}

// ─── Rate presets per section ────────────────────────────────────────────────

interface RateOption { rate: number; label: string; nature: string; }
const OPTIONS_BY_SECTION: Record<string, RateOption[]> = {
  "194C": [
    { rate: 1, label: "1 %",  nature: "Individual / HUF / Proprietor" },
    { rate: 2, label: "2 %",  nature: "Company / Firm / LLP" },
  ],
  "194J": [
    { rate: 10, label: "10 %", nature: "Professional / Consultancy / Legal / Audit" },
    { rate:  2, label: "2 %",  nature: "Technical Services / Software / Call-centre" },
  ],
};

// ─── Component ────────────────────────────────────────────────────────────────

export function PartyRateConfigModal({
  open, onOpenChange, clientId, firmId, financialYear, parties, onSaved,
}: Props) {
  const { overrides, upsertMany } = usePartyRateOverrides(clientId, financialYear);
  const [selections, setSelections] = useState<Record<string, { rate: number; nature: string; isOther: boolean }>>({});
  const [saving,    setSaving]    = useState(false);

  // Build unique key for a party.
  const keyOf = (p: RateEligibleParty) =>
    `${p.tb_ledger_name}|${p.tds_deductee_name}|${p.section_code}`;

  // Pre-fill selections from stored overrides + smart defaults on first mount.
  useEffect(() => {
    if (!open) return;
    const next: typeof selections = {};
    for (const p of parties) {
      const key = keyOf(p);
      const stored = overrides.find(o =>
        o.tb_ledger_name === p.tb_ledger_name
        && o.tds_deductee_name === p.tds_deductee_name
        && o.section_code === p.section_code
      );
      if (stored) {
        const opts = OPTIONS_BY_SECTION[p.section_code] ?? [];
        const preset = opts.find(o => Math.abs(o.rate - stored.applicable_rate) < 0.005);
        next[key] = {
          rate:    stored.applicable_rate,
          nature:  stored.applicable_nature || (preset?.nature ?? ""),
          isOther: !preset,
        };
        continue;
      }
      // Smart default: choose the preset whose rate is closest to the actual
      // implied rate. Empty overrides + no signal → first preset.
      const impliedRate = p.gross_amount > 0 ? (p.tds_amount / p.gross_amount) * 100 : 0;
      const opts = OPTIONS_BY_SECTION[p.section_code] ?? [];
      const closest = opts.reduce<RateOption | null>((a, b) => {
        if (!a) return b;
        return Math.abs(impliedRate - a.rate) <= Math.abs(impliedRate - b.rate) ? a : b;
      }, null) ?? opts[0];
      next[key] = closest
        ? { rate: closest.rate, nature: closest.nature, isOther: false }
        : { rate: 0, nature: "", isOther: true };
    }
    setSelections(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, parties, overrides.length]);

  const groupedBySection = useMemo(() => {
    const map: Record<string, RateEligibleParty[]> = {};
    for (const p of parties) {
      (map[p.section_code] ||= []).push(p);
    }
    return map;
  }, [parties]);

  const handleSave = async () => {
    if (!clientId || !firmId || !financialYear) return;
    setSaving(true);
    try {
      const rows: PartyRateOverride[] = parties.map(p => {
        const sel = selections[keyOf(p)];
        return {
          client_id:         clientId,
          firm_id:           firmId,
          financial_year:    financialYear,
          tb_ledger_name:    p.tb_ledger_name,
          tds_deductee_name: p.tds_deductee_name,
          section_code:      p.section_code,
          applicable_rate:   sel?.rate ?? 0,
          applicable_nature: sel?.nature ?? null,
          set_by:            "auditor",
        };
      }).filter(r => r.applicable_rate > 0);
      await upsertMany(rows);
      toast.success(`Saved ${rows.length} rate confirmation${rows.length === 1 ? "" : "s"}.`);
      onSaved();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(`Save failed: ${err.message ?? err}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Confirm applicable TDS rate before reconciliation</DialogTitle>
        </DialogHeader>
        <div className="text-xs text-muted-foreground space-y-1 mb-2">
          <p>
            Sections <strong>194C</strong> (1 % / 2 %) and <strong>194J</strong> (10 % / 2 %) have two
            legitimate rates each. Confirm the applicable rate for every party
            so the reconciliation engine doesn't flag genuine deductions as
            short / over.
          </p>
          <p>
            <span className="text-muted-foreground/70">Default is pre-filled from the actual implied rate; adjust as needed.</span>
          </p>
        </div>

        <div className="max-h-[420px] overflow-y-auto space-y-4 pr-1">
          {Object.entries(groupedBySection).map(([sec, list]) => (
            <div key={sec} className="border rounded-md">
              <div className="px-3 py-1.5 bg-slate-50 border-b text-xs font-semibold flex items-center gap-2">
                <span className="text-slate-800">Section {sec}</span>
                <span className="text-muted-foreground">· {list.length} part{list.length === 1 ? "y" : "ies"}</span>
              </div>
              <div className="divide-y">
                {list.map(p => {
                  const key         = keyOf(p);
                  const sel         = selections[key] ?? { rate: 0, nature: "", isOther: false };
                  const opts        = OPTIONS_BY_SECTION[sec] ?? [];
                  const implied     = p.gross_amount > 0 ? (p.tds_amount / p.gross_amount) * 100 : 0;
                  return (
                    <div key={key} className="px-3 py-2 space-y-1.5">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-slate-800 truncate">
                            {p.tb_ledger_name} <span className="text-muted-foreground">→</span> {p.tds_deductee_name}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            Gross ₹{p.gross_amount.toLocaleString("en-IN", { maximumFractionDigits: 0 })} ·
                            TDS ₹{p.tds_amount.toLocaleString("en-IN", { maximumFractionDigits: 0 })} ·
                            actual rate {implied.toFixed(2)} %
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 items-center">
                        {opts.map(o => (
                          <label key={o.rate} className={cn(
                            "inline-flex items-center gap-1.5 px-2 py-1 rounded border cursor-pointer text-xs transition",
                            !sel.isOther && Math.abs(sel.rate - o.rate) < 0.005
                              ? "bg-primary/10 border-primary text-primary"
                              : "border-slate-200 hover:bg-slate-50",
                          )}>
                            <input
                              type="radio"
                              name={key}
                              className="accent-primary"
                              checked={!sel.isOther && Math.abs(sel.rate - o.rate) < 0.005}
                              onChange={() =>
                                setSelections(prev => ({ ...prev, [key]: { rate: o.rate, nature: o.nature, isOther: false } }))
                              }
                            />
                            <span className="font-medium">{o.label}</span>
                            <span className="text-muted-foreground">— {o.nature}</span>
                          </label>
                        ))}
                        <label className={cn(
                          "inline-flex items-center gap-1.5 px-2 py-1 rounded border cursor-pointer text-xs transition",
                          sel.isOther
                            ? "bg-primary/10 border-primary text-primary"
                            : "border-slate-200 hover:bg-slate-50",
                        )}>
                          <input
                            type="radio"
                            name={key}
                            className="accent-primary"
                            checked={sel.isOther}
                            onChange={() =>
                              setSelections(prev => ({ ...prev, [key]: { rate: sel.isOther ? sel.rate : implied, nature: "Custom rate", isOther: true } }))
                            }
                          />
                          <span className="font-medium">Other %</span>
                          {sel.isOther && (
                            <Input
                              className="h-5 w-14 text-xs px-1"
                              type="number"
                              step="0.01"
                              min="0"
                              max="30"
                              value={sel.rate}
                              onChange={e =>
                                setSelections(prev => ({ ...prev, [key]: { ...sel, rate: Number(e.target.value) || 0 } }))
                              }
                            />
                          )}
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {parties.length === 0 && (
            <p className="text-xs text-muted-foreground py-4 text-center">
              No 194C / 194J parties need rate confirmation.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving} size="sm">
            <X size={12} className="mr-1" /> Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || parties.length === 0} size="sm">
            {saving
              ? <Loader2 size={12} className="mr-1 animate-spin" />
              : <Save size={12} className="mr-1" />}
            Save &amp; Continue to Reconciliation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
