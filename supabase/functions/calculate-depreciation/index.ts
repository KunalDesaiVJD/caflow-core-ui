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
    if (!client_id || !fy) throw new Error('client_id and fy required');

    const fyY     = parseInt(fy.split('-')[0]);
    const fyStart = new Date(fyY,     3, 1);   // Apr 1
    const fyEnd   = new Date(fyY + 1, 2, 31);  // Mar 31
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

        const method     = (cat.depreciation_method || 'WDV').toUpperCase() as 'WDV'|'SLM';
        const usefulLife = parseInt(cat.useful_life_years) || 0;
        if (usefulLife <= 0) {
          errors.push(`${asset.asset_name}: category '${cat.name}' has no useful life`);
          continue;
        }

        // ── Base values ────────────────────────────────────────────
        const gbOpen  = parseFloat(asset.gross_block_opening)    || 0;
        const acOpen  = parseFloat(asset.accumulated_dep_opening) || 0;
        const addns   = parseFloat(asset.additions_during_year)  || 0;
        const disps   = parseFloat(asset.disposals_during_year)  || 0;

        const wdvOpen = gbOpen - acOpen;

        // Residual value: per-asset override takes priority over category %
        const residualPct = parseFloat(cat.residual_value_pct) || 5;
        const residual = (asset.residual_value != null && asset.residual_value !== '')
          ? parseFloat(asset.residual_value)
          : Math.round((gbOpen * residualPct) / 100 * 100) / 100;

        // ── Fully depreciated check ────────────────────────────────
        if (wdvOpen <= residual && addns === 0) {
          await sb.from('fa_assets').update({
            depreciation_for_year:    0,
            dep_on_opening_block:     0,
            dep_on_additions:         0,
            gross_block_closing:      gbOpen - disps,
            accumulated_dep_closing:  acOpen,
            wdv_closing:              wdvOpen - disps,
            depreciation_method_used: method,
            residual_value:           residual,
          }).eq('id', asset.id);
          results.push({
            asset_id: asset.id, asset_name: asset.asset_name,
            method, status: 'fully_depreciated', depreciation: 0,
            rate_display: method === 'WDV' ? 'Fully depreciated' : 'Fully depreciated',
            reason: `WDV ${wdvOpen} <= residual ${residual} — depreciation stopped`,
          });
          continue;
        }

        // ── Depreciable amount remaining ───────────────────────────
        const depreciableOpening = Math.max(0, wdvOpen - residual);

        // ── Days for disposal (end-of-month rule) ──────────────────
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

        // ── Calculate Dep on Opening Block ─────────────────────────
        let depOnOpen = 0;
        let wdvRateUsed = 0;

        if (method === 'WDV') {
          const storedRate = parseFloat(cat.wdv_rate) || 0;
          wdvRateUsed = storedRate > 0
            ? storedRate
            : Math.round((1 - Math.pow(residualPct / 100, 1 / usefulLife)) * 10000) / 100;

          depOnOpen = Math.round(
            depreciableOpening * (wdvRateUsed / 100) * (depDaysOpen / FY_DAYS) * 100
          ) / 100;

          depOnOpen = Math.min(depOnOpen, depreciableOpening * (depDaysOpen / FY_DAYS));

        } else {
          // SLM RULE: Annual dep = (Original Cost - Residual Value) / Useful Life Years
          const annualSLM = Math.round((gbOpen - residual) / usefulLife * 100) / 100;
          depOnOpen = Math.round(annualSLM * (depDaysOpen / FY_DAYS) * 100) / 100;

          // SLM CAP: total dep cannot exceed (gbOpen - residual)
          const maxTotal = gbOpen - residual;
          const alreadyDep = acOpen;
          const remainingAllowable = Math.max(0, maxTotal - alreadyDep);
          depOnOpen = Math.min(depOnOpen, remainingAllowable * (depDaysOpen / FY_DAYS));
          depOnOpen = Math.round(depOnOpen * 100) / 100;
        }

        // ── Calculate Dep on Additions ──────────────────────────────
        let depOnAdd = 0;
        if (addns > 0) {
          const addResidual = Math.round((addns * residualPct) / 100 * 100) / 100;
          const addDepreciable = addns - addResidual;
          let addDays = Math.round(FY_DAYS / 2);
          if (asset.addition_date) {
            const addDate = new Date(asset.addition_date);
            if (addDate >= fyStart && addDate <= fyEnd)
              addDays = Math.round((fyEnd.getTime() - addDate.getTime()) / 86400000) + 1;
            else if (addDate < fyStart) addDays = FY_DAYS;
          }
          if (method === 'WDV') {
            depOnAdd = Math.round(
              addDepreciable * (wdvRateUsed / 100) * (addDays / FY_DAYS) * 100
            ) / 100;
          } else {
            const annualAddSLM = Math.round(addDepreciable / usefulLife * 100) / 100;
            depOnAdd = Math.round(annualAddSLM * (addDays / FY_DAYS) * 100) / 100;
          }
        }

        // ── Final totals ───────────────────────────────────────────
        const totalDep = Math.round((depOnOpen + depOnAdd) * 100) / 100;
        const gbClose  = gbOpen + addns - disps;
        const acClose  = Math.round((acOpen + totalDep) * 100) / 100;
        const wdvClose = Math.round((wdvOpen + addns - disps - totalDep) * 100) / 100;

        // STOP DEPRECIATION CHECK: if WDV closing < residual, cap it
        const finalWdvClose = Math.max(wdvClose, residual - disps);
        const adjustedTotalDep = Math.round((wdvOpen + addns - disps - finalWdvClose) * 100) / 100;

        // ── Validation warnings ────────────────────────────────────
        const vErrs: string[] = [];
        if (finalWdvClose < 0) vErrs.push('WDV closing is negative after capping — check values');
        if (acClose > gbClose) vErrs.push('Accumulated dep exceeds gross block');

        // ── Save to DB ─────────────────────────────────────────────
        await sb.from('fa_assets').update({
          depreciation_for_year:    adjustedTotalDep,
          dep_on_opening_block:     depOnOpen,
          dep_on_additions:         depOnAdd,
          gross_block_closing:      gbClose,
          accumulated_dep_closing:  acClose,
          wdv_closing:              finalWdvClose,
          depreciation_method_used: method,
          residual_value:           residual,
        }).eq('id', asset.id);

        await sb.from('fa_depreciation_schedule')
          .delete().eq('asset_id', asset.id).eq('fy', fy);
        await sb.from('fa_depreciation_schedule').insert({
          asset_id: asset.id, fy,
          depreciation_rate:
            method === 'WDV' ? wdvRateUsed
            : gbOpen > 0 ? Math.round((gbOpen - residual) / usefulLife / gbOpen * 10000) / 100 : 0,
          depreciation_amount: adjustedTotalDep,
          wdv_opening: wdvOpen,
          wdv_closing: finalWdvClose,
        });

        results.push({
          asset_id: asset.id, asset_name: asset.asset_name,
          method,
          rate_display: method === 'WDV'
            ? `${wdvRateUsed.toFixed(2)}% on (WDV - Residual)`
            : `(Cost - Residual) / ${usefulLife} yrs = ${((gbOpen-residual)/usefulLife).toFixed(0)}/yr`,
          wdv_opening: wdvOpen, residual, depreciable_opening: depreciableOpening,
          dep_on_opening: depOnOpen, dep_on_additions: depOnAdd,
          total_depreciation: adjustedTotalDep,
          wdv_closing: finalWdvClose, gross_block_closing: gbClose,
          accumulated_dep_closing: acClose,
          status: vErrs.length > 0 ? 'warning' : 'ok',
          validation_errors: vErrs,
        });

      } catch(e: any) { errors.push(`${asset.asset_name}: ${e.message}`); }
    }

    return new Response(JSON.stringify({
      message: 'Depreciation calculated', count: results.length,
      results, errors,
      warnings: results.filter(r => r.status === 'warning'),
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });

  } catch(err: any) {
    return new Response(JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
