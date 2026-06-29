// save-nce-constrained-note — the COA-tie enforcer for the constrained-edit
// Capital & PPE notes (FS_NCE_CONSTRAINED_NOTES). The ONLY write path for
// nce_capital_note (and, once the PPE UI switches, nce_ppe_schedule).
//
// Guarantees (server-side, cannot be bypassed from the browser):
//   1. caller role ∈ {partner, admin, superadmin, manager}    (restricted access)
//   2. caller's firm owns the engagement                       (firm scope)
//   3. engagement is NOT notes_finalized                       (lock honoured)
//   4. Σ(submitted closing) == COA total, per code, per year   (the tie)
//      — COA re-derived here from the TB + mapping with the SAME signedBalance
//        rule the BS/PL face uses (no SQL re-implementation → no parity drift).
// On pass it writes with the service role (delete-then-insert), snapshots the
// COA anchor, clears is_stale, stamps updated_by. Otherwise it RAISEs a named
// error the UI turns into a precise toast ("Capital CY ₹X must equal COA ₹Y").
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const ALLOWED_ROLES = ['partner', 'admin', 'superadmin', 'manager'];
const TOL = 1;               // ₹1, matches tolMinor in fsReconciliation.ts
const TB_PAGE = 1000;

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => Number(v ?? 0) || 0;

// ── COA re-derivation (bounded to the 4 fixed-nature codes) ─────────────────
// Mirrors signedBalance/signedOpening + computeCOATotals (fsReconciliation.ts).
// Natures are fixed: NCE_CAP=CR, NCE_PPE/NCE_INTG/NCE_DEPR=DR. These codes are
// equity (never folded) or note-less direct codes (nothing folds into them), so
// an exact mapping-code match equals computeCOATotals — verified by the Phase-6
// parity test before the flag flips.
type Nature = 'DR' | 'CR';
function signed(amount: unknown, side: unknown, nature: Nature): number {
  const cb = Math.abs(num(amount));
  if (cb === 0) return 0;
  const s = String(side ?? '').trim().toUpperCase();
  if (s !== 'DR' && s !== 'CR') return nature === 'CR' ? cb : -cb;
  return s === nature ? cb : -cb;
}
type TBRow = { ledger_name?: string | null; closing_balance?: number | null; balance_type?: string | null; opening_balance?: number | null; opening_type?: string | null };
type Mapping = Record<string, { code?: string } | undefined>;
function makeResolver(mapping: Mapping) {
  const ci: Record<string, { code?: string }> = {};
  for (const [k, v] of Object.entries(mapping || {})) {
    if (!v?.code) continue;
    const kk = String(k).trim().toLowerCase();
    if (!(kk in ci)) ci[kk] = v;
  }
  return (name: string) =>
    mapping[name] ?? mapping[String(name).trim()] ?? ci[String(name).trim().toLowerCase()];
}
function dedupeLast(rows: TBRow[]): TBRow[] {
  const m = new Map<string, TBRow>();
  for (const r of rows) { const nm = String(r.ledger_name ?? ''); if (!nm) continue; m.set(nm, r); }
  return [...m.values()];
}
/** COA total for one code, CY + PY, matching computeCOATotals exactly. */
function coaTotal(code: string, nature: Nature, cyTb: TBRow[], pyTb: TBRow[], cyMap: Mapping, pyMap: Mapping | null): { cy: number; py: number } {
  const resCy = makeResolver(cyMap);
  const resPy = pyMap && Object.keys(pyMap).length ? makeResolver(pyMap) : null;
  let cy = 0;
  for (const r of dedupeLast(cyTb)) {
    if (resCy(String(r.ledger_name ?? ''))?.code !== code) continue;
    cy += signed(r.closing_balance, r.balance_type, nature);
  }
  let py = 0;
  if (pyTb.length > 0) {
    for (const r of dedupeLast(pyTb)) {
      const nm = String(r.ledger_name ?? '').trim();
      if (!nm) continue;
      const m = (resPy ? (pyMap![nm] ?? pyMap![r.ledger_name ?? ''] ?? resPy(nm)) : undefined) ?? resCy(nm);
      if (m?.code !== code) continue;
      py += signed(r.closing_balance, r.balance_type, nature);
    }
  } else {
    for (const r of dedupeLast(cyTb)) {
      if (resCy(String(r.ledger_name ?? ''))?.code !== code) continue;
      py += signed(r.opening_balance, r.opening_type, nature); // PY = signed opening (BS only; P&L → 0)
    }
  }
  return { cy: r2(cy), py: r2(py) };
}

async function loadTB(sb: any, engagementId: string): Promise<TBRow[]> {
  const rows: TBRow[] = [];
  for (let from = 0; ; from += TB_PAGE) {
    const { data, error } = await sb
      .from('tally_trial_balance')
      .select('ledger_name, closing_balance, balance_type, opening_balance, opening_type')
      .eq('engagement_id', engagementId)
      .order('ledger_name', { ascending: true })
      .range(from, from + TB_PAGE - 1);
    if (error) throw new Error(`TB load failed: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < TB_PAGE) break;
  }
  return rows;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const svc = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // ── caller identity (anon client carries the user's JWT) ────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: au } = await asUser.auth.getUser();
    const uid = au?.user?.id;
    if (!uid) return json({ error: 'NCE_SAVE_UNAUTHENTICATED' }, 401);
    const { data: u } = await svc.from('users').select('role, firm_id').eq('id', uid).maybeSingle();
    if (!u || !ALLOWED_ROLES.includes(String(u.role))) return json({ error: 'NCE_SAVE_FORBIDDEN: insufficient role' }, 403);

    const body = await req.json();
    const type = String(body?.type ?? '');
    const engagement_id = String(body?.engagement_id ?? '');
    const financial_year = String(body?.financial_year ?? '');
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    if (type !== 'capital' && type !== 'ppe') return json({ error: 'NCE_SAVE_BAD_TYPE' }, 400);
    if (!engagement_id || !financial_year) return json({ error: 'NCE_SAVE_BAD_REQUEST' }, 400);

    // ── engagement: firm scope + finalized gate ─────────────────────────────
    const { data: eng } = await svc.from('audit_engagements')
      .select('id, client_id, firm_id, financial_year, notes_finalized, coa_mapping')
      .eq('id', engagement_id).maybeSingle();
    if (!eng) return json({ error: 'NCE_SAVE_ENGAGEMENT_NOT_FOUND' }, 404);
    if (String(eng.firm_id) !== String(u.firm_id)) return json({ error: 'NCE_SAVE_FORBIDDEN: cross-firm' }, 403);
    if (eng.notes_finalized) return json({ error: 'NCE_SAVE_FINALIZED: notes are locked' }, 409);

    // ── COA source: CY TB + PY-shell TB (paginated) ─────────────────────────
    const cyTb = await loadTB(svc, engagement_id);
    const cyMap = (eng.coa_mapping ?? {}) as Mapping;
    const p = String(financial_year).split('-');
    const prevFy = p.length === 2 ? `${parseInt(p[0]) - 1}-${String(parseInt(p[0])).slice(-2)}` : '';
    let pyTb: TBRow[] = []; let pyMap: Mapping | null = null;
    if (prevFy) {
      const { data: shells } = await svc.from('audit_engagements')
        .select('id, coa_mapping').eq('client_id', eng.client_id).eq('financial_year', prevFy).eq('is_py_shell', true);
      for (const s of (shells ?? [])) {
        const tb = await loadTB(svc, s.id);
        if (tb.length) { pyTb = tb; pyMap = (s.coa_mapping ?? {}) as Mapping; break; }
      }
    }

    const mismatches: string[] = [];
    const within = (a: number, b: number) => Math.abs(r2(a) - r2(b)) <= TOL;

    if (type === 'capital') {
      const coa = coaTotal('NCE_CAP', 'CR', cyTb, pyTb, cyMap, pyMap);
      const sumClose = (col: string) => r2(rows.filter((x: any) => x.col === col)
        .reduce((s: number, x: any) => s + (num(x.opening) + num(x.introduced) + num(x.profit_share) + num(x.interest_on_cap) + num(x.remuneration) - num(x.drawings)), 0));
      const cyC = sumClose('cy'), pyC = sumClose('py');
      if (!within(cyC, coa.cy)) mismatches.push(`NCE_CAP_CY_MISMATCH: capital CY closing ₹${cyC} must equal COA ₹${coa.cy} (off ₹${r2(cyC - coa.cy)})`);
      if (pyTb.length && !within(pyC, coa.py)) mismatches.push(`NCE_CAP_PY_MISMATCH: capital PY closing ₹${pyC} must equal COA ₹${coa.py} (off ₹${r2(pyC - coa.py)})`);
      if (mismatches.length) return json({ error: 'NCE_SAVE_TIE_FAILED', mismatches }, 422);

      // write
      await svc.from('nce_capital_note').delete().eq('engagement_id', engagement_id).eq('financial_year', financial_year);
      const ins = rows.map((x: any) => ({
        engagement_id, financial_year, col: x.col, partner_name: String(x.partner_name ?? ''),
        opening: num(x.opening), introduced: num(x.introduced), profit_share: num(x.profit_share),
        interest_on_cap: num(x.interest_on_cap), remuneration: num(x.remuneration), drawings: num(x.drawings),
        is_balancing_row: !!x.is_balancing_row, sort_order: num(x.sort_order),
        coa_anchor_closing: x.col === 'py' ? coa.py : coa.cy, is_stale: false, updated_by: uid,
      }));
      if (ins.length) { const { error } = await svc.from('nce_capital_note').insert(ins); if (error) throw new Error(error.message); }
      return json({ ok: true, coa });
    }

    // type === 'ppe'
    const coaPPE = coaTotal('NCE_PPE', 'DR', cyTb, pyTb, cyMap, pyMap);
    const coaINT = coaTotal('NCE_INTG', 'DR', cyTb, pyTb, cyMap, pyMap);
    const coaDEP = coaTotal('NCE_DEPR', 'DR', cyTb, pyTb, cyMap, pyMap);
    const netCy = (x: any) => num(x.opening_balance) + num(x.additions_pre) + num(x.additions_post) - num(x.deletions) - num(x.depreciation);
    const netPy = (x: any) => num(x.opening_py) + num(x.additions_py) - num(x.deletions_py) - num(x.depreciation_py);
    const sumBy = (code: string, f: (x: any) => number) => r2(rows.filter((x: any) => x.coa_code === code).reduce((s: number, x: any) => s + f(x), 0));
    const ppeCy = sumBy('NCE_PPE', netCy), ppePy = sumBy('NCE_PPE', netPy);
    const intCy = sumBy('NCE_INTG', netCy), intPy = sumBy('NCE_INTG', netPy);
    const depCy = r2(rows.reduce((s: number, x: any) => s + num(x.depreciation), 0));
    const depPy = r2(rows.reduce((s: number, x: any) => s + num(x.depreciation_py), 0));
    if (!within(ppeCy, coaPPE.cy)) mismatches.push(`NCE_PPE_CY_MISMATCH: tangible CY net ₹${ppeCy} must equal COA ₹${coaPPE.cy}`);
    if (!within(intCy, coaINT.cy)) mismatches.push(`NCE_INTG_CY_MISMATCH: intangible CY net ₹${intCy} must equal COA ₹${coaINT.cy}`);
    if (!within(depCy, coaDEP.cy)) mismatches.push(`NCE_DEPR_CY_MISMATCH: depreciation CY ₹${depCy} must equal COA ₹${coaDEP.cy}`);
    if (pyTb.length) {
      if (!within(ppePy, coaPPE.py)) mismatches.push(`NCE_PPE_PY_MISMATCH: tangible PY net ₹${ppePy} must equal COA ₹${coaPPE.py}`);
      if (!within(intPy, coaINT.py)) mismatches.push(`NCE_INTG_PY_MISMATCH: intangible PY net ₹${intPy} must equal COA ₹${coaINT.py}`);
      if (!within(depPy, coaDEP.py)) mismatches.push(`NCE_DEPR_PY_MISMATCH: depreciation PY ₹${depPy} must equal COA ₹${coaDEP.py}`);
    }
    if (mismatches.length) return json({ error: 'NCE_SAVE_TIE_FAILED', mismatches }, 422);

    await svc.from('nce_ppe_schedule').delete().eq('engagement_id', engagement_id).eq('financial_year', financial_year);
    const ins = rows.map((x: any) => ({
      engagement_id, financial_year, asset_category: x.asset_category, asset_name: String(x.asset_name ?? ''),
      coa_code: x.coa_code, rate_pct: x.rate_pct ?? null,
      opening_balance: num(x.opening_balance), additions_pre: num(x.additions_pre), additions_post: num(x.additions_post),
      deletions: num(x.deletions), depreciation: num(x.depreciation),
      total: r2(num(x.opening_balance) + num(x.additions_pre) + num(x.additions_post)),
      closing_balance: r2(netCy(x)),
      opening_py: num(x.opening_py), additions_py: num(x.additions_py), deletions_py: num(x.deletions_py),
      depreciation_py: num(x.depreciation_py), closing_py: r2(netPy(x)),
      is_balancing_class: !!x.is_balancing_class,
      coa_anchor_net: x.coa_code === 'NCE_INTG' ? coaINT.cy : coaPPE.cy, coa_anchor_depr: coaDEP.cy,
      is_stale: false, sort_order: num(x.sort_order),
    }));
    if (ins.length) { const { error } = await svc.from('nce_ppe_schedule').insert(ins); if (error) throw new Error(error.message); }
    return json({ ok: true, coa: { NCE_PPE: coaPPE, NCE_INTG: coaINT, NCE_DEPR: coaDEP } });
  } catch (e) {
    return json({ error: 'NCE_SAVE_ERROR', detail: String((e as Error)?.message ?? e) }, 500);
  }
});
