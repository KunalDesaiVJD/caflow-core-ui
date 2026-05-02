import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { BrainCircuit, Check, X, Download, Eye, Power, Sparkles, Zap, Search, Pencil, Trash2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const MIN_PATTERN_THRESHOLD = 3;

type ActionPattern = {
  action_type: string;
  count: number;
  example_ai: string | null;
  example_human: string | null;
  firms_affected: number;
};

type Skill = {
  id: string;
  action_type: string;
  pattern_name: string | null;
  skill_data: any;
  entity_type: string | null;
  example_before: string | null;
  example_after: string | null;
  action_count: number;
  firms_affected: number;
  active: boolean;
  approved_by: string | null;
  approved_at: string | null;
  applied_count: number;
  last_used_at: string | null;
  created_at: string | null;
};

export default function AdminAiSkills() {
  const [loading, setLoading] = useState(true);
  const [patterns, setPatterns] = useState<ActionPattern[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [previewSkill, setPreviewSkill] = useState<any>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);

    // Fetch raw action counts grouped by type
    const { data: actions } = await supabase
      .from("audit_human_actions")
      .select("action_type, action_context, ai_suggestion, firm_id")
      .eq("human_override", true);

    // Aggregate patterns
    const patternMap: Record<string, { count: number; firms: Set<string>; examples: { ai: string | null; human: string | null }[] }> = {};
    (actions || []).forEach((a: any) => {
      if (!patternMap[a.action_type]) {
        patternMap[a.action_type] = { count: 0, firms: new Set(), examples: [] };
      }
      patternMap[a.action_type].count++;
      if (a.firm_id) patternMap[a.action_type].firms.add(a.firm_id);
      if (patternMap[a.action_type].examples.length < 3) {
        patternMap[a.action_type].examples.push({
          ai: a.ai_suggestion || a.action_context?.ai_text || null,
          human: a.action_context?.human_text || a.action_context?.resolution_note || null,
        });
      }
    });

    const pats: ActionPattern[] = Object.entries(patternMap)
      .filter(([, v]) => v.count >= MIN_PATTERN_THRESHOLD)
      .map(([type, v]) => ({
        action_type: type,
        count: v.count,
        example_ai: v.examples[0]?.ai || null,
        example_human: v.examples[0]?.human || null,
        firms_affected: v.firms.size,
      }))
      .sort((a, b) => b.count - a.count);

    setPatterns(pats);

    // Fetch existing skills
    const { data: sk } = await supabase.from("audit_ai_skills").select("*").order("created_at", { ascending: false });
    setSkills((sk as Skill[]) || []);

    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const approvePattern = async (pattern: ActionPattern) => {
    const { data: session } = await supabase.auth.getSession();
    const userId = session.session?.user?.id;

    const { error } = await supabase.from("audit_ai_skills").insert({
      action_type: pattern.action_type,
      pattern_name: `Learned: ${pattern.action_type.replace(/_/g, " ")}`,
      skill_data: { action_type: pattern.action_type, threshold: MIN_PATTERN_THRESHOLD },
      example_before: pattern.example_ai,
      example_after: pattern.example_human,
      action_count: pattern.count,
      firms_affected: pattern.firms_affected,
      active: true,
      approved_by: userId,
      approved_at: new Date().toISOString(),
    } as any);

    if (error) toast.error(error.message);
    else { toast.success("Skill approved and activated"); fetchData(); }
  };

  const rejectPattern = async (actionType: string) => {
    // Delete any existing skill candidate for this type
    await supabase.from("audit_ai_skills").delete().eq("action_type", actionType).eq("active", false);
    toast.success("Pattern rejected");
    fetchData();
  };

  const toggleSkill = async (skill: Skill) => {
    await supabase.from("audit_ai_skills").update({ active: !skill.active } as any).eq("id", skill.id);
    toast.success(skill.active ? "Skill deactivated" : "Skill activated");
    fetchData();
  };

  const exportSkills = () => {
    const activeSkills = skills.filter(s => s.active);
    const blob = new Blob([JSON.stringify(activeSkills, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `caflow-ai-skills-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${activeSkills.length} skills`);
  };

  const activeSkills = skills.filter(s => s.active);
  const existingTypes = new Set(skills.map(s => s.action_type));
  const candidatePatterns = patterns.filter(p => !existingTypes.has(p.action_type));

  if (loading) {
    return <div className="space-y-4"><Skeleton className="h-10 w-80" /><Skeleton className="h-64" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <BrainCircuit className="h-6 w-6 text-primary" /> AI Skills &amp; Intelligence
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pattern-detected skills from human overrides &amp; cross-client COA mapping knowledge base.
          </p>
        </div>
        <Button onClick={exportSkills} variant="outline" className="gap-2" disabled={activeSkills.length === 0}>
          <Download size={16} /> Export All Skills
        </Button>
      </div>

      <Tabs defaultValue="skills">
        <TabsList>
          <TabsTrigger value="skills" className="gap-2"><Sparkles size={14} /> Skill Candidates</TabsTrigger>
          <TabsTrigger value="coa" className="gap-2"><Zap size={14} /> COA Mapping Intelligence</TabsTrigger>
        </TabsList>
        <TabsContent value="skills" className="space-y-6 pt-4">

      {/* Candidate Patterns */}
      {candidatePatterns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles size={16} className="text-primary" /> Candidate Patterns
              <Badge>{candidatePatterns.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pattern Type</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead>Example (AI → Human)</TableHead>
                  <TableHead className="text-right">Firms</TableHead>
                  <TableHead className="w-40">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {candidatePatterns.map(p => (
                  <TableRow key={p.action_type}>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-xs">{p.action_type}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold">{p.count}</TableCell>
                    <TableCell className="max-w-sm">
                      <div className="space-y-1">
                        {p.example_ai && (
                          <p className="text-xs text-muted-foreground line-through truncate">
                            {p.example_ai.substring(0, 120)}…
                          </p>
                        )}
                        {p.example_human && (
                          <p className="text-xs text-foreground truncate">
                            {p.example_human.substring(0, 120)}…
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{p.firms_affected}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => { setPreviewSkill(p); setPreviewOpen(true); }} title="Preview">
                          <Eye size={14} />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => approvePattern(p)} title="Approve" className="text-green-600 hover:text-green-700">
                          <Check size={14} />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => rejectPattern(p.action_type)} title="Reject" className="text-destructive">
                          <X size={14} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {candidatePatterns.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <BrainCircuit className="mx-auto h-10 w-10 mb-3 opacity-30" />
            <p>No new patterns detected. Patterns appear when the same type of human override occurs {MIN_PATTERN_THRESHOLD}+ times across audits.</p>
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* Approved Skills */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Check size={16} className="text-green-600" /> Approved Skills
            <Badge variant="outline">{activeSkills.length} active</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {skills.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No skills created yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Applied</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {skills.map(s => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.pattern_name || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-xs">{s.action_type}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{s.applied_count}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {s.last_used_at ? new Date(s.last_used_at).toLocaleDateString("en-IN") : "Never"}
                    </TableCell>
                    <TableCell>
                      <Badge className={s.active ? "bg-green-600 text-white" : "bg-muted text-muted-foreground"}>
                        {s.active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => toggleSkill(s)} title={s.active ? "Deactivate" : "Activate"}>
                        <Power size={14} className={s.active ? "text-destructive" : "text-green-600"} />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

        </TabsContent>
        <TabsContent value="coa" className="pt-4">
          <CoaIntelligencePanel />
        </TabsContent>
      </Tabs>

      {/* Preview Sheet */}
      <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Pattern Preview</SheetTitle>
          </SheetHeader>
          {previewSkill && (
            <div className="space-y-4 mt-6">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Action Type</p>
                <Badge variant="outline" className="font-mono mt-1">{previewSkill.action_type}</Badge>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Occurrences</p>
                <p className="text-lg font-bold">{previewSkill.count}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Firms Affected</p>
                <p>{previewSkill.firms_affected}</p>
              </div>
              {previewSkill.example_ai && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">AI Suggestion (Before)</p>
                  <div className="mt-1 p-3 rounded-md bg-destructive/5 text-sm border border-destructive/20">
                    {previewSkill.example_ai}
                  </div>
                </div>
              )}
              {previewSkill.example_human && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Human Version (After)</p>
                  <div className="mt-1 p-3 rounded-md bg-green-500/5 text-sm border border-green-500/20">
                    {previewSkill.example_human}
                  </div>
                </div>
              )}
              <Button onClick={() => { approvePattern(previewSkill); setPreviewOpen(false); }} className="w-full gap-2">
                <Check size={16} /> Approve as Skill
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── COA Mapping Intelligence Panel ──────────────────────────────────────────
type IntelRow = {
  id: string;
  normalized_name: string;
  entity_type: string;
  account_head: string;
  bs_pl: string | null;
  account_group: string | null;
  confidence_score: number;
  times_confirmed: number;
  times_overridden: number;
  alternatives: { account_head: string; count: number }[] | null;
  firms_affected: number;
  last_used_at: string | null;
  // Scope control (added 2026-04-26)
  is_party_name: boolean;
  scope: string;           // 'global' | 'engagement'
  client_id: string | null;
};

type CoaHead = { account_head: string; bs_pl: string | null; group_name: string | null; entity_type: string };

function CoaIntelligencePanel() {
  const [rows, setRows] = useState<IntelRow[]>([]);
  const [heads, setHeads] = useState<CoaHead[]>([]);
  const [clientMap, setClientMap] = useState<Record<string, string>>({}); // client_id → client name
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [entity, setEntity] = useState<"all" | "corporate" | "llp" | "nce">("all");
  const [scopeFilter, setScopeFilter] = useState<"all" | "global" | "engagement">("all");
  /** Issue-7: Default true — hide person/party names; only show income/expense accounts */
  const [excludePartyNames, setExcludePartyNames] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("coa_mapping_intelligence" as any)
      .select("*")
      .order("last_used_at", { ascending: false })
      .limit(1000);
    setRows((data as IntelRow[]) ?? []);
    const { data: hd } = await supabase
      .from("coa_master")
      .select("account_head, bs_pl, group_name, entity_type")
      .limit(5000);
    setHeads((hd as CoaHead[]) ?? []);
    // Issue-6: Load client names for client-scoped entries
    const { data: clients } = await supabase
      .from("clients" as any)
      .select("id, name")
      .limit(2000);
    if (clients) {
      const map: Record<string, string> = {};
      for (const c of clients as { id: string; name: string }[]) map[c.id] = c.name;
      setClientMap(map);
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = rows.filter((r) => {
    if (entity !== "all" && r.entity_type !== entity) return false;
    if (scopeFilter !== "all" && (r.scope ?? "global") !== scopeFilter) return false;
    // Issue-7: Exclude party/person names by default
    if (excludePartyNames && r.is_party_name) return false;
    if (!q.trim()) return true;
    const qq = q.toLowerCase();
    return (
      r.normalized_name.toLowerCase().includes(qq) ||
      r.account_head.toLowerCase().includes(qq) ||
      (r.account_group ?? "").toLowerCase().includes(qq) ||
      // Issue-6: Also search by client name
      (r.client_id && (clientMap[r.client_id] ?? "").toLowerCase().includes(qq))
    );
  });

  // Promote an engagement-scoped pattern to global scope (admin override)
  const promoteToGlobal = async (r: IntelRow) => {
    if (!confirm(`Promote "${r.normalized_name}" to global scope?\nThis will make it apply to ALL clients across all firms.`)) return;
    const { error } = await supabase
      .from("coa_mapping_intelligence" as any)
      .update({ scope: "global", is_party_name: false, client_id: null })
      .eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`Promoted to global: ${r.normalized_name}`);
    load();
  };

  const remap = async (r: IntelRow, h: CoaHead) => {
    const { error } = await supabase
      .from("coa_mapping_intelligence" as any)
      .update({
        account_head:     h.account_head,
        bs_pl:            h.bs_pl,
        account_group:    h.group_name,
        confidence_score: 99,
        times_confirmed:  r.times_confirmed + 1,
      })
      .eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`Re-mapped: ${r.normalized_name} → ${h.account_head}`);
    load();
  };

  const remove = async (r: IntelRow) => {
    if (!confirm(`Remove intelligence for "${r.normalized_name}"? Future mappings won't use this learned pattern.`)) return;
    const { error } = await supabase.from("coa_mapping_intelligence" as any).delete().eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Entry removed");
    load();
  };

  if (loading) return <Skeleton className="h-64" />;

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Zap size={14} className="text-violet-600" />
          Cross-Client COA Mapping Intelligence
          <Badge variant="outline">{rows.filter(r => (r.scope ?? 'global') === 'global').length} global patterns</Badge>
          <Badge variant="outline" className="border-amber-400 text-amber-700">{rows.filter(r => r.scope === 'engagement').length} client-scoped</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          When a user confirms or overrides a COA mapping, it is recorded here.{" "}
          <span className="text-green-700 font-medium">Global patterns</span> (generic ledger/account names) apply across all firms and clients and are used to train Claude.{" "}
          <span className="text-amber-700 font-medium">Client-scoped patterns</span> (vendor/customer/party business names) are restricted to the same client in future years and are never sent to Claude as global training data.
        </p>
        <div className="flex gap-2 pt-2 flex-wrap">
          <div className="relative flex-1 max-w-md">
            <Search size={14} className="absolute left-3 top-3 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search ledger name or account head…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select value={entity} onChange={(e) => setEntity(e.target.value as any)} className="border rounded-md px-3 text-sm bg-background">
            <option value="all">All entities</option>
            <option value="corporate">Corporate</option>
            <option value="llp">LLP</option>
            <option value="nce">NCE</option>
          </select>
          <select value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value as any)} className="border rounded-md px-3 text-sm bg-background">
            <option value="all">All scopes</option>
            <option value="global">🌐 Global only</option>
            <option value="engagement">🔒 Client-scoped only</option>
          </select>
          {/* Issue-7: Toggle to exclude person/party names */}
          <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={excludePartyNames}
              onChange={(e) => setExcludePartyNames(e.target.checked)}
              className="accent-primary"
            />
            <span className="text-muted-foreground text-xs">Hide party names</span>
          </label>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No learned patterns yet. Once users confirm or override COA mappings, they will accumulate here.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ledger pattern</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Current mapping</TableHead>
                <TableHead>BS/PL</TableHead>
                <TableHead className="text-right">Confidence</TableHead>
                <TableHead className="text-right">Confirms / Overrides</TableHead>
                <TableHead className="text-right">Firms</TableHead>
                <TableHead className="w-[200px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, 500).map((r) => {
                const isParty = r.is_party_name;
                const isEngagement = (r.scope ?? "global") === "engagement";
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-mono text-xs">{r.normalized_name}</div>
                      {/* Issue-6: Show client name for client-scoped entries */}
                      {isParty && r.client_id && clientMap[r.client_id] && (
                        <div className="text-[10px] text-amber-700 mt-0.5 font-medium">
                          👤 {clientMap[r.client_id]}
                        </div>
                      )}
                      {isParty && (!r.client_id || !clientMap[r.client_id]) && (
                        <div className="text-[10px] text-amber-600 mt-0.5">
                          👤 Party/business name — client-scoped only
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {isEngagement ? (
                        <Badge variant="outline" className="text-xs border-amber-400 text-amber-700 bg-amber-50">
                          🔒 Client
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs border-green-500 text-green-700 bg-green-50">
                          🌐 Global
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{r.entity_type.toUpperCase()}</Badge></TableCell>
                    <TableCell>
                      <div className="font-medium text-sm">{r.account_head}</div>
                      {r.account_group && <div className="text-xs text-muted-foreground">{r.account_group}</div>}
                    </TableCell>
                    <TableCell>{r.bs_pl ? <Badge variant="outline">{r.bs_pl}</Badge> : "-"}</TableCell>
                    <TableCell className="text-right">
                      <Badge className={r.confidence_score >= 85 ? "bg-green-600 text-white" : r.confidence_score >= 65 ? "bg-amber-500 text-white" : "bg-muted text-foreground"}>
                        {Math.round(r.confidence_score)}%
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      <span className="text-green-700">{r.times_confirmed}</span>
                      <span className="text-muted-foreground"> / </span>
                      <span className="text-rose-700">{r.times_overridden}</span>
                    </TableCell>
                    <TableCell className="text-right">{r.firms_affected}</TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end flex-wrap">
                        {isEngagement && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs text-green-700 border-green-400 px-2"
                            title="Promote to global — applies to all clients"
                            onClick={() => promoteToGlobal(r)}
                          >
                            🌐
                          </Button>
                        )}
                        <IntelRemapPopover r={r} heads={heads.filter((h) => h.entity_type === r.entity_type)} onPick={remap} />
                        <Button size="sm" variant="ghost" onClick={() => remove(r)} className="text-destructive"><Trash2 size={14} /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function IntelRemapPopover({ r, heads, onPick }: {
  r: IntelRow; heads: CoaHead[]; onPick: (r: IntelRow, h: CoaHead) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const filtered = heads.filter((h) => h.account_head.toLowerCase().includes(q.toLowerCase())).slice(0, 40);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="gap-1"><Pencil size={14} /> Remap</Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0" align="end">
        <div className="p-2 border-b">
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search account head…" />
        </div>
        <div className="max-h-[280px] overflow-y-auto">
          {filtered.map((h) => (
            <button
              key={h.account_head}
              className="w-full text-left px-3 py-2 text-sm hover:bg-accent border-b last:border-b-0"
              onClick={() => { onPick(r, h); setOpen(false); setQ(""); }}
            >
              <div className="font-medium">{h.account_head}</div>
              <div className="text-xs text-muted-foreground">{h.group_name ?? ""}</div>
            </button>
          ))}
          {filtered.length === 0 && <div className="p-4 text-sm text-muted-foreground">No matches.</div>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
