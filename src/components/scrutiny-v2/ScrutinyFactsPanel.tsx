/**
 * Knowledge & Judgment facts panel (Phase 3, v2 behind the flag).
 *
 * Captures the ~30 human facts (Ticket 3.1), related-party nominations (3.2), and MSME/
 * certificate capture (3.3), and shows the Gate-4 advisory completeness (3.4). Reads/writes
 * the `scrutiny_facts` table gracefully: if the table isn't in this DB yet (migration not
 * applied), it shows a notice and captures locally without crashing.
 */

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Info, CheckCircle2, AlertTriangle, X, Plus } from "lucide-react";
import {
  FACT_CATALOGUE, factGateStatus, groupFactsByCategory,
  type CapturedFacts, type FactDef,
} from "@/lib/scrutiny/facts";

interface Props {
  clientId: string;
  financialYear: string;
  userId: string | null;
}

const CERTIFICATES = [
  "Management representation letter",
  "MSME registration certificate",
  "Physical stock verification certificate",
  "Cash physically verified certificate",
  "Bank balance confirmations",
  "Fixed-asset verification certificate",
];

export default function ScrutinyFactsPanel({ clientId, financialYear, userId }: Props) {
  const [captured, setCaptured] = useState<CapturedFacts>({});
  const [relatedParties, setRelatedParties] = useState<string[]>([]);
  const [certs, setCerts] = useState<Record<string, string>>({});
  const [newParty, setNewParty] = useState("");
  const [storeReady, setStoreReady] = useState(true);

  // ── store I/O (graceful) ─────────────────────────────────────────────────
  const fetchFacts = async () => {
    if (!clientId) return;
    try {
      const { data, error } = await (supabase.from as any)("scrutiny_facts")
        .select("fact_key, fact_value, fact_type")
        .eq("client_id", clientId)
        .eq("financial_year", financialYear);
      if (error) { setStoreReady(false); return; }
      setStoreReady(true);
      const gen: CapturedFacts = {};
      const rp: string[] = [];
      const ce: Record<string, string> = {};
      for (const r of (data ?? []) as { fact_key: string; fact_value: string | null; fact_type: string }[]) {
        if (r.fact_type === "related_party") rp.push(r.fact_key);
        else if (r.fact_type === "certificate") ce[r.fact_key] = String(r.fact_value ?? "");
        else if (r.fact_value != null) gen[r.fact_key] = String(r.fact_value);
      }
      setCaptured(gen); setRelatedParties(rp); setCerts(ce);
    } catch { setStoreReady(false); }
  };
  useEffect(() => { fetchFacts(); /* eslint-disable-next-line */ }, [clientId, financialYear]);

  const upsertFact = async (fact_type: string, fact_key: string, fact_value: string | null) => {
    try {
      const { error } = await (supabase.from as any)("scrutiny_facts").upsert(
        { client_id: clientId, financial_year: financialYear, fact_type, fact_key, fact_value, captured_by: userId, updated_at: new Date().toISOString() },
        { onConflict: "client_id,financial_year,fact_type,fact_key" },
      );
      if (error) setStoreReady(false);
    } catch { setStoreReady(false); }
  };
  const deleteFact = async (fact_type: string, fact_key: string) => {
    try {
      await (supabase.from as any)("scrutiny_facts").delete()
        .eq("client_id", clientId).eq("financial_year", financialYear)
        .eq("fact_type", fact_type).eq("fact_key", fact_key);
    } catch { /* graceful */ }
  };

  // ── general facts ────────────────────────────────────────────────────────
  const saveGeneral = (key: string, value: string) => {
    setCaptured((c) => ({ ...c, [key]: value }));
    upsertFact("general", key, value);
  };

  // ── related parties (Ticket 3.2) ─────────────────────────────────────────
  const addParty = () => {
    const name = newParty.trim();
    if (!name || relatedParties.includes(name)) return;
    setRelatedParties((p) => [...p, name]);
    setNewParty("");
    upsertFact("related_party", name, "nominated");
    if (captured["rp_exist"] !== "yes") saveGeneral("rp_exist", "yes");
  };
  const removeParty = (name: string) => {
    setRelatedParties((p) => p.filter((x) => x !== name));
    deleteFact("related_party", name);
  };

  // ── certificates (Ticket 3.3) ────────────────────────────────────────────
  const toggleCert = (name: string) => {
    const next = certs[name] === "obtained" ? "" : "obtained";
    setCerts((c) => ({ ...c, [name]: next }));
    if (next) upsertFact("certificate", name, next);
    else deleteFact("certificate", name);
  };

  const gate = useMemo(() => factGateStatus(FACT_CATALOGUE, captured), [captured]);
  const groups = useMemo(() => groupFactsByCategory(FACT_CATALOGUE), []);

  const renderControl = (f: FactDef) => {
    const v = captured[f.key] ?? "";
    if (f.type === "boolean") {
      return (
        <div className="inline-flex rounded-md border overflow-hidden text-xs">
          {["yes", "no"].map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => saveGeneral(f.key, opt)}
              className={`px-3 py-1 capitalize border-r last:border-r-0 ${v === opt ? (opt === "yes" ? "bg-green-600 text-white" : "bg-muted-foreground/80 text-white") : "text-muted-foreground hover:bg-muted/60"}`}
            >
              {opt}
            </button>
          ))}
        </div>
      );
    }
    if (f.type === "select" && f.options) {
      return (
        <Select value={v} onValueChange={(nv) => saveGeneral(f.key, nv)}>
          <SelectTrigger className="h-8 w-44"><SelectValue placeholder="Select" /></SelectTrigger>
          <SelectContent>{f.options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
        </Select>
      );
    }
    return (
      <Input
        className="h-8 w-56"
        value={v}
        onChange={(e) => setCaptured((c) => ({ ...c, [f.key]: e.target.value }))}
        onBlur={(e) => saveGeneral(f.key, e.target.value)}
        placeholder="—"
      />
    );
  };

  return (
    <div className="space-y-5">
      {/* Gate-4 advisory summary */}
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <Badge className={gate.missing.length === 0 ? "gap-1 bg-green-500/15 text-green-700 border-green-300" : "gap-1 bg-amber-500/15 text-amber-700 border-amber-300"}>
              {gate.missing.length === 0 ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
              {gate.requiredCaptured}/{gate.requiredTotal} required facts
            </Badge>
            <span className="text-xs text-muted-foreground">{gate.captured}/{gate.total} facts captured · advisory — never blocks sign-off / UDIN</span>
          </div>
          {gate.missing.length > 0 && (
            <p className="text-xs text-amber-700">Missing required: {gate.missing.map((f) => f.label).join(" · ")}</p>
          )}
        </CardContent>
      </Card>

      {!storeReady && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 flex items-start gap-2">
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>The <code>scrutiny_facts</code> store isn't in this database yet — apply <code>supabase/migrations/20260704000000_scrutiny_facts.sql</code> to the dev project. Entries won't persist until then.</span>
        </div>
      )}

      {/* Related-party nominations (Ticket 3.2) */}
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">Related-party nominations</h3>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          {relatedParties.length === 0 && <span className="text-xs text-muted-foreground">None nominated. Add the parties so RP-transaction checks can run.</span>}
          {relatedParties.map((p) => (
            <Badge key={p} variant="outline" className="gap-1">{p}<button type="button" onClick={() => removeParty(p)}><X size={11} /></button></Badge>
          ))}
        </div>
        <div className="flex gap-2">
          <Input className="h-8 w-64" value={newParty} onChange={(e) => setNewParty(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addParty(); }} placeholder="Related-party name" />
          <Button size="sm" variant="outline" onClick={addParty}><Plus size={14} className="mr-1" />Add</Button>
        </div>
      </div>

      {/* General facts by category (Ticket 3.1) */}
      {groups.map((g) => (
        <div key={g.category}>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">{g.category}</h3>
          <div className="rounded-md border divide-y">
            {g.facts.map((f) => (
              <div key={f.key} className="flex items-center gap-3 px-3 py-2">
                <span className="flex-1 text-sm">
                  {f.label}
                  {f.required && <span className="ml-1 text-[10px] text-amber-600">required</span>}
                  {f.help && <span className="block text-xs text-muted-foreground">{f.help}</span>}
                </span>
                <span className="shrink-0">{renderControl(f)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Certificates / MSME capture (Ticket 3.3) */}
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">Certificates &amp; representations obtained</h3>
        <div className="rounded-md border divide-y">
          {CERTIFICATES.map((name) => (
            <button key={name} type="button" onClick={() => toggleCert(name)} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted/40">
              <span className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${certs[name] === "obtained" ? "bg-green-600 border-green-600 text-white" : "border-muted-foreground/40"}`}>
                {certs[name] === "obtained" && <CheckCircle2 size={12} />}
              </span>
              <span className="text-sm flex-1">{name}</span>
              {certs[name] === "obtained" && <Badge className="bg-green-500/15 text-green-700 border-green-300 text-xs">obtained</Badge>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
