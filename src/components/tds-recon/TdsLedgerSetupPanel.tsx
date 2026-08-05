/**
 * TdsLedgerSetupPanel  (Stage 5 / P5-B)
 *
 * Compact panel above Party Mappings. Runs the Layer 1/2/3 auto-discovery
 * once, shows the candidate TDS-payable ledger set, and lets the auditor
 * confirm / edit / exclude before it's persisted to
 * engagement_tds_ledgers. Once confirmed rows exist, discoverTdsLedgers()
 * reads from that table on every subsequent mapper run instead of
 * re-running discovery — the auditor's judgement is authoritative.
 *
 * Collapsed by default when a confirmed set already exists (nothing to
 * do); expands automatically on first visit (no confirmed rows yet).
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input }  from "@/components/ui/input";
import { toast }  from "sonner";
import { ChevronDown, ChevronRight, Loader2, Save, Settings2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEngagementTdsLedgers } from "./hooks/useEngagementTdsLedgers";
import { discoverTdsLedgers, DiscoveredTdsLedger } from "./tdsLedgerDiscovery";

interface Props {
  clientId:      string;
  firmId:        string;
  financialYear: string;
}

const TDS_SECTIONS = [
  "194C", "194J", "194H", "194I", "194A", "194Q", "194M", "195", "192", "192A",
];

export function TdsLedgerSetupPanel({ clientId, firmId, financialYear }: Props) {
  const { ledgers, loading, upsertMany, toggleActive, removeOne } =
    useEngagementTdsLedgers(clientId, financialYear);

  const [expanded,   setExpanded]   = useState(false);
  const [candidates, setCandidates] = useState<DiscoveredTdsLedger[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [sections,   setSections]   = useState<Record<string, string>>({});
  const [saving,     setSaving]     = useState(false);

  // Auto-expand on first visit when nothing is confirmed yet.
  useEffect(() => {
    if (!loading && ledgers.length === 0) setExpanded(true);
  }, [loading, ledgers.length]);

  const runDiscovery = async () => {
    setDiscovering(true);
    try {
      const found = await discoverTdsLedgers({ client_id: clientId, financial_year: financialYear, forceRediscover: true });
      setCandidates(found);
      const secMap: Record<string, string> = {};
      for (const f of found) secMap[f.ledger_name] = f.section ?? "";
      setSections(secMap);
    } catch (err: any) {
      toast.error(`Discovery failed: ${err.message ?? err}`);
    } finally {
      setDiscovering(false);
    }
  };

  useEffect(() => {
    if (expanded && candidates.length === 0 && !discovering) {
      void runDiscovery();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  const handleSaveAll = async () => {
    setSaving(true);
    try {
      await upsertMany(candidates.map(c => ({
        client_id:      clientId,
        firm_id:        firmId,
        financial_year: financialYear,
        ledger_name:    c.ledger_name,
        parent_group:   c.parent_group,
        section_code:   sections[c.ledger_name] || null,
        is_active:      true,
        confirmed_by:   "auditor",
      })));
      toast.success(`Confirmed ${candidates.length} TDS ledger${candidates.length === 1 ? "" : "s"}. Party Mapping will now use this set.`);
      setExpanded(false);
    } catch (err: any) {
      toast.error(`Save failed: ${err.message ?? err}`);
    } finally {
      setSaving(false);
    }
  };

  const hasConfirmed = ledgers.length > 0;

  return (
    <div className="border rounded-lg mb-3">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium hover:bg-slate-50"
      >
        <span className="flex items-center gap-1.5">
          <Settings2 size={12} className="text-muted-foreground" />
          TDS Ledgers Setup
          {hasConfirmed && (
            <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5 ml-1">
              {ledgers.filter(l => l.is_active).length} confirmed
            </span>
          )}
        </span>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>

      {expanded && (
        <div className="border-t px-3 py-2 space-y-2">
          <p className="text-[10px] text-muted-foreground">
            Every TDS-payable ledger auto-detected from the Trial Balance. Confirm the
            section for each (leave blank if the client uses one combined ledger for
            all sections — the mapper will infer per-voucher). Once saved, this set is
            used on every subsequent Party Mapping run instead of re-discovering.
          </p>

          {hasConfirmed && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-slate-600">Currently confirmed:</p>
              {ledgers.map(l => (
                <div key={l.ledger_name} className="flex items-center justify-between text-xs bg-slate-50 rounded px-2 py-1">
                  <span className={cn(!l.is_active && "line-through text-muted-foreground")}>
                    {l.ledger_name} {l.section_code && <span className="text-muted-foreground">· {l.section_code}</span>}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1.5"
                      onClick={() => toggleActive(l.ledger_name, !l.is_active)}>
                      {l.is_active ? "Disable" : "Enable"}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-red-500"
                      onClick={() => removeOne(l.ledger_name)}>
                      <Trash2 size={10} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold text-slate-600">
              {hasConfirmed ? "Re-discover (will not overwrite confirmed rows above until saved):" : "Discovered candidates:"}
            </p>
            <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={runDiscovery} disabled={discovering}>
              {discovering ? <Loader2 size={10} className="animate-spin mr-1" /> : null}
              Re-scan Trial Balance
            </Button>
          </div>

          {candidates.length === 0 && !discovering && (
            <p className="text-[10px] text-muted-foreground py-2">No TDS-payable ledgers detected in this Trial Balance.</p>
          )}

          {candidates.map(c => (
            <div key={c.ledger_name} className="flex items-center justify-between gap-2 text-xs border rounded px-2 py-1.5">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{c.ledger_name}</div>
                <div className="text-[10px] text-muted-foreground">{c.parent_group ?? "—"}</div>
              </div>
              <select
                className="h-6 text-[10px] border rounded px-1"
                value={sections[c.ledger_name] ?? ""}
                onChange={e => setSections(prev => ({ ...prev, [c.ledger_name]: e.target.value }))}
              >
                <option value="">Combined / infer per voucher</option>
                {TDS_SECTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          ))}

          {candidates.length > 0 && (
            <div className="flex justify-end pt-1">
              <Button size="sm" onClick={handleSaveAll} disabled={saving}>
                {saving ? <Loader2 size={12} className="animate-spin mr-1" /> : <Save size={12} className="mr-1" />}
                Confirm &amp; Save
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
