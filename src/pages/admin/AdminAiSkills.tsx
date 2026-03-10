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
import { BrainCircuit, Check, X, Download, Eye, Power, Sparkles } from "lucide-react";

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
            <BrainCircuit className="h-6 w-6 text-primary" /> AI Skill Candidates
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {patterns.length} patterns detected from human behaviour across {new Set(patterns.flatMap(() => [])).size || "multiple"} firms
          </p>
        </div>
        <Button onClick={exportSkills} variant="outline" className="gap-2" disabled={activeSkills.length === 0}>
          <Download size={16} /> Export All Skills
        </Button>
      </div>

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
