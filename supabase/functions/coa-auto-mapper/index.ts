// ─────────────────────────────────────────────────────────────────────────────
// coa-auto-mapper
//   Enterprise COA auto-mapping pipeline.
//   Input : { engagement_id }
//   Output: summary counts + writes suggestions to `coa_mappings`.
//
//   Pipeline, per ledger:
//     1. Normalise the ledger name.
//     2. Check coa_mapping_intelligence (cross-client learning). If a row
//        with confidence ≥ 85 exists, auto-accept (source=intelligence).
//     3. Check coa_master.tally_group_mapping + name similarity — if an
//        unambiguous match, auto-suggest (source=heuristic).
//     4. Any remaining ledgers are sent in BATCHES to claude-gateway
//        (request_type=coa_mapper) — source=ai, status=suggested.
//
//   The UI confirms / overrides, and those actions feed back into
//   coa_mapping_intelligence via upsert_coa_intelligence().
// ─────────────────────────────────────────────────────────────────────────────

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Small helpers ───────────────────────────────────────────────────────────
const norm = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/[^a-z0-9& ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokens = (s: string) => new Set(norm(s).split(" ").filter((t) => t.length >= 3));

function jaccard(a: string, b: string): number {
  const A = tokens(a), B = tokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

interface Ledger {
  id: string;
  ledger_name: string;
  parent_group: string | null;
  closing_balance: number;
}
interface CoaRow {
  account_head: string;
  bs_pl: string | null;
  account_group: string | null;
  tally_group_mapping: string | null;
  group_name: string | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token      = authHeader.replace("Bearer ", "").trim();
    if (!token) {
      return json({ error: "Unauthorized" }, 401);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { data: profile } = await admin
      .from("users")
      .select("firm_id")
      .eq("id", user.id)
      .single();
    const firmId = profile?.firm_id ?? null;

    const body = await req.json().catch(() => ({}));
    const engagementId: string | null = body.engagement_id ?? null;
    if (!engagementId) return json({ error: "engagement_id required" }, 400);

    // ── Load engagement + client to get entity_type ─────────────────────────
    const { data: eng } = await admin
      .from("audit_engagements")
      .select("id, client_id, firm_id, financial_year, clients:client_id(id, entity_type)")
      .eq("id", engagementId)
      .single();

    if (!eng) return json({ error: "Engagement not found" }, 404);
    const entityType: string = normaliseEntityType(
      (eng.clients as any)?.entity_type ?? "corporate",
    );
    const engFirmId: string | null = (eng as any).firm_id ?? firmId;
    const clientId: string | null  = (eng as any).client_id ?? null;
    const fy: string | null        = (eng as any).financial_year ?? null;

    // ── Resolve the TALLY engagement_id ─────────────────────────────────────
    // tally_ledgers / tally_trial_balance / tally_vouchers are keyed to the
    // separate `engagements` table, not `audit_engagements`. Resolve by
    // client_id + financial_year, with tally_groups.engagement_id as fallback.
    let tallyEngId: string | null = null;
    if (clientId && fy) {
      const { data: tEng } = await admin
        .from("engagements")
        .select("id")
        .eq("client_id", clientId)
        .eq("financial_year", fy)
        .maybeSingle();
      tallyEngId = (tEng as any)?.id ?? null;
    }
    if (!tallyEngId && clientId) {
      const { data: tg } = await admin
        .from("tally_groups")
        .select("engagement_id")
        .eq("client_id", clientId)
        .limit(1)
        .maybeSingle();
      tallyEngId = (tg as any)?.engagement_id ?? null;
    }
    if (!tallyEngId) {
      return json({
        ok: true, total: 0, auto: 0, heuristic: 0, ai: 0, intelligence: 0,
        warning: "No Tally data linked to this engagement. Import trial balance first.",
      });
    }

    // ── Load tally ledgers for the Tally engagement ─────────────────────────
    const { data: ledgersRaw } = await admin
      .from("tally_ledgers")
      .select("id, ledger_name, parent_group, closing_balance")
      .eq("engagement_id", tallyEngId);

    const ledgers: Ledger[] = (ledgersRaw ?? [])
      .filter((l: any) => l.ledger_name && String(l.ledger_name).trim() !== "")
      .map((l: any) => ({
        id: l.id,
        ledger_name: String(l.ledger_name).trim(),
        parent_group: l.parent_group,
        closing_balance: Number(l.closing_balance ?? 0),
      }));

    if (ledgers.length === 0) {
      return json({ ok: true, total: 0, auto: 0, heuristic: 0, ai: 0, intelligence: 0 });
    }

    // ── Load COA master for this entity type (+ global / firm overrides) ────
    const { data: coaRaw } = await admin
      .from("coa_master")
      .select("account_head, bs_pl, group_name, tally_group_mapping")
      .eq("entity_type", entityType);
    const coa: CoaRow[] = (coaRaw ?? []).map((r: any) => ({
      account_head: r.account_head,
      bs_pl:        r.bs_pl,
      account_group: r.group_name,
      group_name:   r.group_name,
      tally_group_mapping: r.tally_group_mapping,
    }));

    // ── Bulk-fetch intelligence rows for every ledger's normalised name ─────
    const normNames = Array.from(new Set(ledgers.map((l) => norm(l.ledger_name))));
    const { data: intelRows } = await admin
      .from("coa_mapping_intelligence")
      .select("normalized_name, account_head, bs_pl, account_group, confidence_score, times_confirmed, times_overridden, alternatives")
      .eq("entity_type", entityType)
      .in("normalized_name", normNames);
    const intelByName = new Map<string, any>();
    for (const r of intelRows ?? []) intelByName.set(r.normalized_name, r);

    // ── Fetch existing mappings so we don't clobber user edits ──────────────
    const { data: existingRaw } = await admin
      .from("coa_mappings")
      .select("raw_ledger_name, status")
      .eq("engagement_id", engagementId);
    const existing = new Map<string, string>(); // raw -> status
    for (const r of existingRaw ?? []) {
      if (r.raw_ledger_name) existing.set(String(r.raw_ledger_name), String(r.status ?? ""));
    }

    const now = new Date().toISOString();
    let auto = 0, heuristic = 0, aiCount = 0, intelCount = 0;
    const aiBatch: { ledger: Ledger; key: string }[] = [];
    const upserts: any[] = [];

    for (const led of ledgers) {
      // Skip if human already confirmed/overrode this ledger
      const prevStatus = existing.get(led.ledger_name);
      if (prevStatus === "confirmed" || prevStatus === "overridden") continue;

      const nn = norm(led.ledger_name);

      // (1) Intelligence hit
      const intel = intelByName.get(nn);
      if (intel && Number(intel.confidence_score ?? 0) >= 85) {
        upserts.push(row(engagementId, engFirmId, led, entityType, {
          standard_head: intel.account_head,
          bs_pl:         intel.bs_pl,
          account_group: intel.account_group,
          confidence:    Number(intel.confidence_score),
          source:        "intelligence",
          status:        "confirmed",
          alternatives:  intel.alternatives ?? [],
          reasoning:     `Auto-confirmed from ${intel.times_confirmed} prior confirmations across the network.`,
          original:      intel.account_head,
          now,
        }));
        intelCount++;
        auto++;
        continue;
      }

      // (2) Heuristic: direct tally_group match or strong name similarity
      const h = heuristicMatch(led, coa);
      if (h && h.confidence >= 80) {
        upserts.push(row(engagementId, engFirmId, led, entityType, {
          standard_head: h.account_head,
          bs_pl:         h.bs_pl,
          account_group: h.account_group,
          confidence:    h.confidence,
          source:        "heuristic",
          status:        "suggested",
          alternatives:  h.alternatives,
          reasoning:     h.reason,
          original:      h.account_head,
          now,
        }));
        heuristic++;
        continue;
      }

      aiBatch.push({ ledger: led, key: led.ledger_name });
    }

    // (3) AI batch via claude-gateway
    if (aiBatch.length > 0) {
      const aiResults = await callAiInBatches(
        admin, token, entityType, aiBatch, coa,
      );
      for (const { ledger, suggestion } of aiResults) {
        if (!suggestion) {
          upserts.push(row(engagementId, engFirmId, ledger, entityType, {
            standard_head: null,
            bs_pl:         null,
            account_group: null,
            confidence:    0,
            source:        "ai",
            status:        "suggested",
            alternatives:  [],
            reasoning:     "AI returned no suggestion — please map manually.",
            original:      null,
            now,
          }));
          continue;
        }
        upserts.push(row(engagementId, engFirmId, ledger, entityType, {
          standard_head: suggestion.suggested_head,
          bs_pl:         suggestion.bs_pl,
          account_group: suggestion.account_group,
          confidence:    confidenceToNumber(suggestion.confidence),
          source:        "ai",
          status:        "suggested",
          alternatives:  [],
          reasoning:     suggestion.reason ?? "",
          original:      suggestion.suggested_head,
          now,
        }));
        aiCount++;
      }
    }

    // ── Upsert all mappings in one go ───────────────────────────────────────
    if (upserts.length > 0) {
      // Delete previous suggested rows for these ledgers first (so we replace
      // stale AI suggestions without touching confirmed/overridden).
      const names = upserts.map((u) => u.raw_ledger_name);
      await admin
        .from("coa_mappings")
        .delete()
        .eq("engagement_id", engagementId)
        .in("raw_ledger_name", names)
        .in("status", ["suggested"]);

      const { error: insErr } = await admin.from("coa_mappings").insert(upserts);
      if (insErr) return json({ error: insErr.message }, 500);
    }

    return json({
      ok: true,
      total:        ledgers.length,
      auto,
      intelligence: intelCount,
      heuristic,
      ai:           aiCount,
      skipped:      ledgers.length - (intelCount + heuristic + aiCount),
    });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

// ─── helpers ────────────────────────────────────────────────────────────────
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normaliseEntityType(s: string): string {
  const t = String(s ?? "").toLowerCase();
  if (t.includes("llp")) return "llp";
  if (t.includes("private") || t.includes("public") || t.includes("company") || t.includes("ltd")) return "corporate";
  return "nce";
}

function confidenceToNumber(c?: string): number {
  const s = String(c ?? "").toLowerCase();
  if (s.startsWith("h")) return 85;
  if (s.startsWith("m")) return 65;
  if (s.startsWith("l")) return 40;
  return 50;
}

function row(
  engagementId: string,
  firmId: string | null,
  led: Ledger,
  entityType: string,
  v: {
    standard_head: string | null;
    bs_pl: string | null;
    account_group: string | null;
    confidence: number;
    source: string;
    status: string;
    alternatives: unknown;
    reasoning: string | null;
    original: string | null;
    now: string;
  },
) {
  return {
    engagement_id:        engagementId,
    firm_id:              firmId,
    ledger_id:            led.id,
    raw_ledger_name:      led.ledger_name,
    entity_type:          entityType,
    standard_head:        v.standard_head,
    bs_pl:                v.bs_pl,
    account_group:        v.account_group,
    confidence:           v.confidence,
    source:               v.source,
    status:               v.status,
    alternatives:         v.alternatives ?? [],
    reasoning:            v.reasoning,
    original_suggestion:  v.original,
    created_at:           v.now,
    updated_at:           v.now,
  };
}

// ── Heuristic matcher ───────────────────────────────────────────────────────
function heuristicMatch(led: Ledger, coa: CoaRow[]) {
  if (coa.length === 0) return null;
  const parent = norm(led.parent_group ?? "");
  const ledN   = norm(led.ledger_name);

  type Scored = { coa: CoaRow; score: number; why: string };
  const scored: Scored[] = [];

  for (const c of coa) {
    let score = 0;
    const reasons: string[] = [];

    // Tally group mapping (strongest signal)
    if (parent && c.tally_group_mapping) {
      const maps = c.tally_group_mapping.split(/[|,;]/).map((x) => norm(x));
      if (maps.some((m) => m && (m === parent || parent.includes(m) || m.includes(parent)))) {
        score += 60;
        reasons.push(`Tally group "${led.parent_group}" maps to this head`);
      }
    }
    // Ledger name vs account head similarity
    const js = jaccard(led.ledger_name, c.account_head);
    if (js > 0) { score += Math.round(js * 40); reasons.push(`${Math.round(js * 100)}% name similarity`); }

    // Bonus if account head is a sub-string of ledger name
    const ahN = norm(c.account_head);
    if (ahN && ledN.includes(ahN)) { score += 15; reasons.push("head contained in ledger"); }

    if (score > 0) scored.push({ coa: c, score, why: reasons.join(" + ") });
  }

  scored.sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;
  const top = scored[0];
  const second = scored[1];
  // Require clear separation from 2nd best
  const confidence = Math.min(99, top.score - Math.round((second?.score ?? 0) * 0.4));
  if (confidence < 40) return null;

  return {
    account_head: top.coa.account_head,
    bs_pl:        top.coa.bs_pl,
    account_group: top.coa.account_group,
    confidence,
    reason: top.why,
    alternatives: scored.slice(1, 4).map((s) => ({
      account_head: s.coa.account_head,
      bs_pl:        s.coa.bs_pl,
      account_group: s.coa.account_group,
      score:        s.score,
    })),
  };
}

// ── Claude-gateway batch caller ─────────────────────────────────────────────
async function callAiInBatches(
  admin: ReturnType<typeof createClient>,
  userToken: string,
  entityType: string,
  batch: { ledger: Ledger; key: string }[],
  coa: CoaRow[],
) {
  const out: { ledger: Ledger; suggestion: any | null }[] = [];
  const BATCH = 25;

  // Send only a compact list of available heads — keep prompt small
  const availableHeads = Array.from(new Set(coa.map((c) => c.account_head)));

  for (let i = 0; i < batch.length; i += BATCH) {
    const slice = batch.slice(i, i + BATCH);
    const payload = {
      request_type: "coa_mapper",
      user_message: JSON.stringify({
        entity_type: entityType,
        available_heads: availableHeads,
        ledgers: slice.map(({ ledger }) => ({
          ledger:          ledger.ledger_name,
          tally_group:     ledger.parent_group,
          closing_balance: ledger.closing_balance,
          bs_pl_side:      ledger.closing_balance >= 0 ? "Dr" : "Cr",
        })),
      }),
    };

    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/claude-gateway`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${userToken}`,
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      // Gateway failure → return null suggestions so UI marks these unmapped
      for (const item of slice) out.push({ ledger: item.ledger, suggestion: null });
      continue;
    }
    const data = await resp.json().catch(() => ({}));
    const parsed = data?.parsed ?? data?.result ?? data?.data ?? null;
    const arr    = Array.isArray(parsed) ? parsed : (parsed?.raw ? tryJson(parsed.raw) : null);

    if (!Array.isArray(arr)) {
      for (const item of slice) out.push({ ledger: item.ledger, suggestion: null });
      continue;
    }
    // Index by ledger name (case-insensitive)
    const byLedger = new Map<string, any>();
    for (const r of arr) {
      const k = norm(String(r.ledger ?? ""));
      if (k) byLedger.set(k, r);
    }
    for (const item of slice) {
      const k = norm(item.ledger.ledger_name);
      out.push({ ledger: item.ledger, suggestion: byLedger.get(k) ?? null });
    }
  }
  return out;
}

function tryJson(s: string): unknown {
  try { return JSON.parse(String(s).replace(/```json|```/g, "").trim()); } catch { return null; }
}
