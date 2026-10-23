import { supabase } from "@/integrations/supabase/client";
import { resolvePolicy, validatePolicy, type Layer, type ScopeType } from "@/lib/billingReminderRules";

// Checks an edited reminder rule against every other rule that applies to the
// same clients, in any firm, straight from the database. Used by the
// Reminders screen to block a save; the edge function applies the same rules
// at send time (src/lib/billingReminderRules.ts).

export interface ConflictReport {
  /** Problems inside the rule itself. */
  own: string[];
  /** Conflicts with other levels, with the clients they affect. */
  cross: { message: string; clients: string[] }[];
  /** Clients checked. */
  checked: number;
}

interface DraftScope { type: ScopeType; id: string }

const sb = supabase as any;

async function all(query: () => any): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query().range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function chunked(ids: string[], fn: (chunk: string[]) => Promise<any[]>): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 200) out.push(...await fn(ids.slice(i, i + 200)));
  return out;
}

export async function checkRuleConflicts(draft: Record<string, any>, scope: DraftScope): Promise<ConflictReport> {
  const own = validatePolicy(draft, scope.type);

  // ── Which clients does this rule reach? ──
  let firmIds: string[] = [];
  let clientIds: string[] | null = null;
  if (scope.type === "client") clientIds = [scope.id];
  else if (scope.type === "client_group") {
    clientIds = (await all(() => sb.from("client_group_memberships").select("client_id").eq("group_id", scope.id)))
      .map((m: any) => m.client_id);
  } else if (scope.type === "firm") firmIds = [scope.id];
  else {
    firmIds = (await all(() => sb.from("firm_group_members").select("firm_id").eq("firm_group_id", scope.id)))
      .map((m: any) => m.firm_id);
  }

  const cols = "id, name, firm_id, is_active, is_draft";
  const clients = (clientIds
    ? await chunked(clientIds, async c => (await sb.from("clients").select(cols).in("id", c).is("deleted_at", null)).data || [])
    : firmIds.length
      ? await all(() => sb.from("clients").select(cols).in("firm_id", firmIds).is("deleted_at", null))
      : []
  ).filter((c: any) => c.is_active !== false && c.is_draft !== true);
  if (clients.length === 0) return { own, cross: [], checked: 0 };

  const ids = clients.map((c: any) => c.id);
  const firms = [...new Set(clients.map((c: any) => c.firm_id).filter(Boolean))] as string[];

  // ── Every rule that can apply to them ──
  const memberships = await chunked(ids, async c =>
    (await sb.from("client_group_memberships").select("client_id, group_id").in("client_id", c)).data || []);
  const groupIds = [...new Set(memberships.map((m: any) => m.group_id))] as string[];
  const [groups, firmRows, fgMembers] = await Promise.all([
    groupIds.length ? chunked(groupIds, async c => (await sb.from("client_groups").select("id, name").in("id", c)).data || []) : [],
    sb.from("firms").select("id, name").in("id", firms).then((r: any) => r.data || []),
    sb.from("firm_group_members").select("firm_group_id, firm_id").in("firm_id", firms).then((r: any) => r.data || []),
  ]);
  const fgIds = [...new Set(fgMembers.map((m: any) => m.firm_group_id))] as string[];
  const fgRows = fgIds.length ? (await sb.from("firm_groups").select("id, name").in("id", fgIds)).data || [] : [];

  const policies = [
    ...await chunked(ids, async c => (await sb.from("billing_reminder_policies").select("*").eq("scope_type", "client").in("client_id", c)).data || []),
    ...(groupIds.length ? await chunked(groupIds, async c => (await sb.from("billing_reminder_policies").select("*").eq("scope_type", "client_group").in("client_group_id", c)).data || []) : []),
    ...((await sb.from("billing_reminder_policies").select("*").eq("scope_type", "firm").in("firm_id", firms)).data || []),
    ...(fgIds.length ? (await sb.from("billing_reminder_policies").select("*").eq("scope_type", "firm_group").in("firm_group_id", fgIds)).data || [] : []),
  ];
  const keyOf = (p: any) => `${p.scope_type}:${p.scope_type === "client" ? p.client_id
    : p.scope_type === "client_group" ? p.client_group_id : p.scope_type === "firm" ? p.firm_id : p.firm_group_id}`;
  const byScope = new Map<string, any>(policies.map(p => [keyOf(p), p]));
  byScope.set(`${scope.type}:${scope.id}`, draft); // the edited rule, as it would be saved

  const name = new Map<string, string>([
    ...groups.map((g: any) => [`client_group:${g.id}`, `Group: ${g.name}`] as [string, string]),
    ...firmRows.map((f: any) => [`firm:${f.id}`, `Firm: ${f.name}`] as [string, string]),
    ...fgRows.map((g: any) => [`firm_group:${g.id}`, `Firm group: ${g.name}`] as [string, string]),
  ]);
  const layer = (level: ScopeType, id: string): Layer | null => {
    const p = byScope.get(`${level}:${id}`);
    return p ? { level, id, label: level === "client" ? "Client" : name.get(`${level}:${id}`) || level, policy: p } : null;
  };
  const groupsOf = new Map<string, string[]>();
  for (const m of memberships) groupsOf.set(m.client_id, [...(groupsOf.get(m.client_id) || []), m.group_id]);
  const fgOf = new Map<string, string[]>();
  for (const m of fgMembers) fgOf.set(m.firm_id, [...(fgOf.get(m.firm_id) || []), m.firm_group_id]);
  const byLabel = (a: Layer, b: Layer) => a.label.localeCompare(b.label);

  // ── Resolve each client with the edited rule in place ──
  const cross = new Map<string, Set<string>>();
  for (const c of clients) {
    const { issues } = resolvePolicy(
      layer("client", c.id),
      (groupsOf.get(c.id) || []).map(g => layer("client_group", g)).filter(Boolean).sort(byLabel) as Layer[],
      layer("firm", c.firm_id),
      (fgOf.get(c.firm_id) || []).map(g => layer("firm_group", g)).filter(Boolean).sort(byLabel) as Layer[],
    );
    for (const i of issues) {
      if (!i.layers.some(l => l.level === scope.type && l.id === scope.id)) continue; // not caused by this rule
      if (!cross.has(i.message)) cross.set(i.message, new Set());
      cross.get(i.message)!.add(c.name);
    }
  }
  return {
    own,
    cross: [...cross].map(([message, names]) => ({ message, clients: [...names].sort() })),
    checked: clients.length,
  };
}
