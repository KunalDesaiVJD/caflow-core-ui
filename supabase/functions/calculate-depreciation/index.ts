import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const { client_id, fy } = await req.json();
    if (!client_id || !fy) throw new Error('client_id and fy are required');

    const fyY     = parseInt(fy.split('-')[0]);
    const fyStart = new Date(fyY,     3,  1);
    const fyEnd   = new Date(fyY + 1, 2, 31);
    const FY_DAYS = 365;

    const { data: assets, error } = await sb
      .from('fa_assets')
      .select('*, fa_categories(*)')
      .eq('client_id', client_id)
      .eq('fy', fy)
      .eq('is_locked', false);
    if (error) throw error;
    if (!assets?.length) return new Response(
      JSON.stringify({ message: 'No unlocked assets', count: 0 }),
      { headers: { ...cors, 'Content-Type': 'application/json' } }
    );

    const results: any[] = [];
    const errors: string[] = [];

    for (const asset of assets) {
      try {
        const cat = asset.fa_categories;
        if (!cat) { errors.push(`${asset.asset_name}: no category`); continue; }

        const method = (cat.depreciation_method || 'WDV').toUpperCase();
        const usefulLife = parseInt(cat.useful_life_years) || 0;
        if (usefulLife <= 0) {
          errors.push(`${asset.asset_name}: category has no useful life set`);
          continue;
        }

        const gbOpen = parseFloat(asset.gross_block_opening)     || 0;
        const acOpen = parseFloat(asset.accumulated_dep_opening) || 0;
        const addns  = parseFloat(asset.additions_during_year)   || 0;
        const disps  = parseFloat(asset.disposals_during_year)   || 0;
        const wdvOpen = gbOpen - acOpen;

        // Residual value: use per-asset override if set, else category %
        const residualPct = parseFloat(cat.residual_value_pct) || 5;
        const residual = asset.residual_value != null
          ? parseFloat(asset.residual_value)
          : (gbOpen * residualPct) / 100;

        // Fully depreciated check
        const depreciable = gbOpen - residual;
        const stillLeft   = Math.max(0, depreciable - acOpen);
        if (stillLeft <= 0 && addns === 0) {
          await sb.from('fa_assets').update({
            depreciation_for_year: 0, dep_on_opening_block: 0, dep_on_additions: 0,
            gross_block_closing: gbOpen - disps,
            accumulated_dep_closing: acOpen,
            wdv_closing: wdvOpen - disps,
            is_fully_depreciated: true, residual_value: residual,
            depreciation_method_used: method,
          }).eq('id', asset.id);
          results.push({ asset_id: asset.id, asset_name: asset.asset_name,
            status: 'fully_depreciated', method, depreciation: 0 });
          continue;
        }

        // ── WDV: rate applied to Written Down Value ──────────────
        let depOnOpen = 0;
        if (method === 'WDV') {
          const wdvRate = parseFloat(cat.wdv_rate) || 0;
          const rateToUse = wdvRate > 0
            ? wdvRate
            : (1 - Math.pow(residualPct / 100, 1 / usefulLife)) * 100;

          let depDaysOpen = FY_DAYS;
          if (asset.disposal_date) {
            const disp = new Date(asset.disposal_date);
            if (disp <= fyEnd) {
              const eom = new Date(disp.getFullYear(), disp.getMonth() + 1, 0);
              depDaysOpen = Math.max(0, Math.min(
                Math.round((eom.getTime() - fyStart.getTime()) / 86400000) + 1, FY_DAYS
              ));
            }
          }
          depOnOpen = Math.round(wdvOpen * (rateToUse/100) * (depDaysOpen/FY_DAYS) * 100) / 100;
          depOnOpen = Math.min(depOnOpen, stillLeft);

        } else {
          // ── SLM: ANNUAL DEPRECIATION = (Cost - Residual) / Useful Life ──
          const annualSLMDep = (gbOpen - residual) / usefulLife;

          let depDaysOpen = FY_DAYS;
          if (asset.disposal_date) {
            const disp = new Date(asset.disposal_date);
            if (disp <= fyEnd) {
              const eom = new Date(disp.getFullYear(), disp.getMonth() + 1, 0);
              depDaysOpen = Math.max(0, Math.min(
                Math.round((eom.getTime() - fyStart.getTime()) / 86400000) + 1, FY_DAYS
              ));
            }
          }
          depOnOpen = Math.round(annualSLMDep * (depDaysOpen / FY_DAYS) * 100) / 100;
          depOnOpen = Math.min(depOnOpen, stillLeft);
        }

        // ── Additions: proportionate from addition date ──────────
        let depOnAdd = 0;
        if (addns > 0) {
          const addResidual = (addns * residualPct) / 100;
          let addDays = Math.round(FY_DAYS / 2); // half-year default
          if (asset.addition_date) {
            const addDate = new Date(asset.addition_date);
            if (addDate >= fyStart && addDate <= fyEnd)
              addDays = Math.round((fyEnd.getTime()-addDate.getTime())/86400000)+1;
            else if (addDate < fyStart) addDays = FY_DAYS;
          }
          if (method === 'WDV') {
            const wdvRate = parseFloat(cat.wdv_rate) ||
              (1 - Math.pow(residualPct/100, 1/usefulLife)) * 100;
            depOnAdd = Math.round(addns*(wdvRate/100)*(addDays/FY_DAYS)*100)/100;
          } else {
            const annualAddDep = (addns - addResidual) / usefulLife;
            depOnAdd = Math.round(annualAddDep*(addDays/FY_DAYS)*100)/100;
          }
        }

        const totalDep = Math.round((depOnOpen + depOnAdd) * 100) / 100;
        const gbClose  = gbOpen + addns - disps;
        const acClose  = acOpen + totalDep;
        const wdvClose = Math.round((wdvOpen + addns - disps - totalDep) * 100) / 100;

        await sb.from('fa_assets').update({
          depreciation_for_year:    totalDep,
          dep_on_opening_block:     depOnOpen,
          dep_on_additions:         depOnAdd,
          gross_block_closing:      gbClose,
          accumulated_dep_closing:  acClose,
          wdv_closing:              wdvClose,
          is_fully_depreciated:     wdvClose <= residual,
          residual_value:           residual,
          depreciation_method_used: method,
        }).eq('id', asset.id);

        await sb.from('fa_depreciation_schedule')
          .delete().eq('asset_id', asset.id).eq('fy', fy);
        await sb.from('fa_depreciation_schedule').insert({
          asset_id: asset.id, fy,
          depreciation_rate:
            method === 'SLM'
              ? gbOpen > 0 ? Math.round(((gbOpen - residual) / usefulLife / gbOpen) * 10000) / 100 : 0
              : parseFloat(cat.wdv_rate) || Math.round(
                  (1 - Math.pow(residualPct/100, 1/usefulLife)) * 10000) / 100,
          depreciation_amount: totalDep,
          wdv_opening: wdvOpen,
          wdv_closing: wdvClose,
        });

        results.push({
          asset_id: asset.id, asset_name: asset.asset_name,
          method, dep_on_opening: depOnOpen, dep_on_additions: depOnAdd,
          total_depreciation: totalDep, wdv_closing: wdvClose,
          status: 'ok',
        });
      } catch(e: any) { errors.push(`${asset.asset_name}: ${e.message}`); }
    }

    return new Response(JSON.stringify({
      message: 'Depreciation calculated', count: results.length, results, errors
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
