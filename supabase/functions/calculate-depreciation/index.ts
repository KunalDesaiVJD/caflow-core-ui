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
    const fyStart = new Date(fyY,     3,  1);   // Apr 1
    const fyEnd   = new Date(fyY + 1, 2, 31);   // Mar 31
    const FY_DAYS = 365;

    const { data: assets, error } = await sb
      .from('fa_assets')
      .select('*, fa_categories(*)')
      .eq('client_id', client_id)
      .eq('fy', fy)
      .eq('is_locked', false);
    if (error) throw error;
    if (!assets?.length)
      return new Response(
        JSON.stringify({ message: 'No unlocked assets found', count: 0 }),
        { headers: { ...cors, 'Content-Type': 'application/json' } }
      );

    const results: any[] = [];
    const errors:  string[] = [];

    for (const asset of assets) {
      try {
        const cat = asset.fa_categories;
        if (!cat) { errors.push(`${asset.asset_name}: no category`); continue; }

        const method    = (cat.depreciation_method || 'WDV').toUpperCase() as 'WDV' | 'SLM';
        const wdvRate   = parseFloat(cat.wdv_rate)  || 0;
        const slmRate   = parseFloat(cat.slm_rate)  || 0;
        const rateToUse = method === 'SLM' ? slmRate : wdvRate;
        if (rateToUse === 0) {
          errors.push(`${asset.asset_name}: ${cat.name} has no ${method} rate`);
          continue;
        }

        const gbOpen  = parseFloat(asset.gross_block_opening)     || 0;
        const acOpen  = parseFloat(asset.accumulated_dep_opening) || 0;
        const addns   = parseFloat(asset.additions_during_year)   || 0;
        const disps   = parseFloat(asset.disposals_during_year)   || 0;
        const wdvOpen = gbOpen - acOpen;

        // ── Residual / Scrap Value ──────────────────────────────────
        // Per-asset override takes priority over category percentage.
        const residualPct = parseFloat(cat.residual_value_pct) || 5;
        const residual = (asset.residual_value != null && asset.residual_value !== '')
          ? parseFloat(asset.residual_value)
          : Math.round((gbOpen * residualPct) / 100 * 100) / 100;

        // stillLeft = depreciable amount not yet charged against opening block
        const stillLeft = Math.max(0, gbOpen - residual - acOpen);

        // ── FIX ISS-3 + ISS-4: Fully depreciated / disposed check ──
        if (stillLeft <= 0 && addns === 0) {
          // FIX ISS-4: Asset sold → wdv_closing = 0 (no carry-forward at all)
          // FIX ISS-3: Asset fully depreciated → wdv_closing = residual exactly
          //            (scrap value is carried forward as frozen WDV — NOT wdvOpen)
          const wdvFinal = (disps > 0 && disps >= gbOpen) ? 0 : residual;
          await sb.from('fa_assets').update({
            depreciation_for_year:    0,
            dep_on_opening_block:     0,
            dep_on_additions:         0,
            gross_block_closing:      gbOpen - disps,
            accumulated_dep_closing:  acOpen,
            wdv_closing:              wdvFinal,
            is_fully_depreciated:     true,
            residual_value:           residual,
            depreciation_method_used: method,
          }).eq('id', asset.id);
          results.push({
            asset_id: asset.id, asset_name: asset.asset_name,
            status: 'fully_depreciated', method, depreciation: 0,
            wdv_closing: wdvFinal, residual,
          });
          continue;
        }

        // ── FIX ISS-1: SLM base must be (Cost − Residual), NOT full cost ──
        // SLM formula: Annual Dep = (Original Cost − Scrap Value) / Useful Life
        // The rate (slm_rate) already encodes this: slm_rate = 100 / useful_life
        // But the BASE must be (gbOpen - residual), not gbOpen.
        // WDV base = wdvOpen (reducing balance on written-down value)
        const depBaseOpen = method === 'SLM'
          ? (gbOpen - residual)   // FIX ISS-1: deduct scrap value from base
          : wdvOpen;              // WDV: apply rate to current WDV

        // ── Days for opening block (end-of-disposal-month rule) ────
        let depDaysOpen = FY_DAYS;
        if (asset.disposal_date) {
          const disp = new Date(asset.disposal_date);
          if (disp <= fyEnd) {
            const eom = new Date(disp.getFullYear(), disp.getMonth() + 1, 0);
            depDaysOpen = Math.max(0, Math.min(
              Math.round((eom.getTime() - fyStart.getTime()) / 86400000) + 1,
              FY_DAYS
            ));
          }
        }

        // ── FIX ISS-2: Cap depreciation so WDV never goes below residual ──
        // Compute raw depreciation
        let depOnOpen = Math.round(
          depBaseOpen * (rateToUse / 100) * (depDaysOpen / FY_DAYS) * 100
        ) / 100;

        // FIX ISS-2: In the FINAL year, depreciation = Opening WDV − Residual
        // (not the full annual rate, which would overshoot).
        // Cap to the proportionate remaining depreciable amount.
        const maxDepOnOpen = Math.round(stillLeft * (depDaysOpen / FY_DAYS) * 100) / 100;
        depOnOpen = Math.min(depOnOpen, maxDepOnOpen);

        // ── Additions: proportionate from addition date ─────────────
        let depOnAdd = 0, depDaysAdd = 0;
        if (addns > 0) {
          const addResidual = Math.round((addns * residualPct) / 100 * 100) / 100;
          // FIX ISS-1 for additions: SLM base = (addition cost − addition scrap)
          const addDepBase  = method === 'SLM' ? (addns - addResidual) : addns;
          if (asset.addition_date) {
            const addDate = new Date(asset.addition_date);
            if (addDate >= fyStart && addDate <= fyEnd) {
              depDaysAdd = Math.round((fyEnd.getTime() - addDate.getTime()) / 86400000) + 1;
              depOnAdd   = Math.round(addDepBase * (rateToUse / 100) * (depDaysAdd / FY_DAYS) * 100) / 100;
            } else if (addDate < fyStart) {
              depDaysAdd = FY_DAYS;
              depOnAdd   = Math.round(addDepBase * (rateToUse / 100) * 100) / 100;
            }
          } else {
            // No addition date — apply half-year convention
            depDaysAdd = Math.round(FY_DAYS / 2);
            depOnAdd   = Math.round(addDepBase * (rateToUse / 100) * 0.5 * 100) / 100;
          }
        }

        const totalDep = Math.round((depOnOpen + depOnAdd) * 100) / 100;
        const gbClose  = gbOpen + addns - disps;
        const acClose  = Math.round((acOpen + totalDep) * 100) / 100;

        // ── FIX ISS-2 + ISS-4: WDV closing calculation ────────────
        // ISS-4: If asset fully disposed → wdv_closing = 0
        // ISS-2: WDV closing must never go below residual value
        let wdvClose: number;
        if (disps > 0 && disps >= gbOpen + addns) {
          // FIX ISS-4: Fully disposed — WDV goes to zero
          wdvClose = 0;
        } else {
          wdvClose = Math.round((wdvOpen + addns - disps - totalDep) * 100) / 100;
          // FIX ISS-2: Hard floor — WDV can never go below scrap (minus disposals)
          wdvClose = Math.max(wdvClose, Math.max(0, residual - disps));
        }

        const isFullyDep = wdvClose <= residual && stillLeft <= totalDep + 1;

        const vErrs: string[] = [];
        if (wdvClose < 0)      vErrs.push('WDV closing is negative.');
        if (acClose > gbClose) vErrs.push('Accumulated dep exceeds gross block.');
        if (acOpen  > gbOpen)  vErrs.push('Opening acc dep > opening gross block.');

        await sb.from('fa_assets').update({
          depreciation_for_year:    totalDep,
          dep_on_opening_block:     depOnOpen,
          dep_on_additions:         depOnAdd,
          dep_days_opening:         depDaysOpen,
          dep_days_addition:        depDaysAdd || null,
          gross_block_closing:      gbClose,
          accumulated_dep_closing:  acClose,
          wdv_closing:              wdvClose,
          is_fully_depreciated:     isFullyDep,
          residual_value:           residual,
          depreciation_method_used: method,
        }).eq('id', asset.id);

        await sb.from('fa_depreciation_schedule').delete().eq('asset_id', asset.id).eq('fy', fy);
        await sb.from('fa_depreciation_schedule').insert({
          asset_id: asset.id, fy,
          depreciation_rate:   rateToUse,
          depreciation_amount: totalDep,
          wdv_opening:         wdvOpen,
          wdv_closing:         wdvClose,
        });

        results.push({
          asset_id: asset.id, asset_name: asset.asset_name,
          category: cat.name, method, rate_used: rateToUse,
          gross_block_opening: gbOpen, wdv_opening: wdvOpen,
          residual, still_left_before: stillLeft,
          dep_base_used: depBaseOpen,
          dep_on_opening: depOnOpen, additions: addns, dep_on_additions: depOnAdd,
          total_depreciation: totalDep, wdv_closing: wdvClose,
          gross_block_closing: gbClose, accumulated_dep_closing: acClose,
          is_fully_depreciated: isFullyDep,
          validation_errors: vErrs,
          status: vErrs.length > 0 ? 'warning' : 'ok',
        });

      } catch (e: any) { errors.push(`${asset.asset_name}: ${e.message}`); }
    }

    return new Response(JSON.stringify({
      message: 'Depreciation calculated', count: results.length,
      results, errors, warnings: results.filter(r => r.status === 'warning'),
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
