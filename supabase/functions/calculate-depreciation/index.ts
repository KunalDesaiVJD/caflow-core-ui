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
    if (!assets?.length)
      return new Response(
        JSON.stringify({ message: 'No unlocked assets found', count: 0 }),
        { headers: { ...cors, 'Content-Type': 'application/json' } }
      );

    const fmtINR = (n: number) =>
      n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const results: any[] = [];
    const errors:  string[] = [];

    for (const asset of assets) {
      try {
        const cat = asset.fa_categories;
        if (!cat) { errors.push(`${asset.asset_name}: no category`); continue; }

        const method  = (cat.depreciation_method || 'WDV').toUpperCase() as 'WDV' | 'SLM';
        const gbOpen  = parseFloat(asset.gross_block_opening)     || 0;
        const acOpen  = parseFloat(asset.accumulated_dep_opening) || 0;
        const addns   = parseFloat(asset.additions_during_year)   || 0;
        const disps   = parseFloat(asset.disposals_during_year)   || 0;
        const wdvOpen = gbOpen - acOpen;

        // ── Residual value ───────────────────────────────────────────
        const residualPct = parseFloat(cat.residual_value_pct) || 5;
        const residual = (asset.residual_value != null && asset.residual_value !== '')
          ? parseFloat(asset.residual_value)
          : Math.round((gbOpen * residualPct) / 100 * 100) / 100;

        // ── Fully-depreciated: WDV already at or below residual ──────
        if (wdvOpen <= residual && addns === 0) {
          const wdvFinal = (disps > 0 && disps >= gbOpen) ? 0 : residual;
          const formulaJson = {
            method, status: 'fully_depreciated',
            formula_text: `Opening WDV ₹${fmtINR(wdvOpen)} ≤ Residual ₹${fmtINR(residual)} — No further depreciation.`,
            residual, wdv_open: wdvOpen,
          };
          await sb.from('fa_assets').update({
            depreciation_for_year: 0, dep_on_opening_block: 0, dep_on_additions: 0,
            gross_block_closing: gbOpen - disps, accumulated_dep_closing: acOpen,
            wdv_closing: wdvFinal, is_fully_depreciated: true,
            residual_value: residual, depreciation_method_used: method,
            dep_formula_json: formulaJson,
          }).eq('id', asset.id);
          results.push({ asset_id: asset.id, asset_name: asset.asset_name,
            status: 'fully_depreciated', method, depreciation: 0, wdv_closing: wdvFinal });
          continue;
        }

        // ════════════════════════════════════════════════════════════
        // SLM USEFUL-LIFE METHOD — correct formula:
        // Annual Dep = (Cost - Residual Value) / Useful Life Years
        // NOT rate% x Cost.
        // ════════════════════════════════════════════════════════════
        let depOnOpen = 0;
        let depDaysOpen = FY_DAYS;
        let formulaJson: any = {};

        if (method === 'SLM') {
          const life = cat.useful_life_years || 1;
          // Annual depreciation = (Cost - Residual) / Life
          const annualDep = Math.round(((gbOpen - residual) / life) * 100) / 100;

          // Pro-rata: if asset was purchased in this FY, count days from
          // purchase date (inclusive) to 31-Mar (inclusive)
          const purchDate = asset.date_of_purchase ? new Date(asset.date_of_purchase) : null;
          const isFirstYear = !!(purchDate && purchDate >= fyStart && purchDate <= fyEnd);

          if (isFirstYear && purchDate) {
            depDaysOpen = Math.round((fyEnd.getTime() - purchDate.getTime()) / 86400000) + 1;
          }

          // Disposal: depreciate only to end of disposal month
          if (asset.disposal_date) {
            const disp = new Date(asset.disposal_date);
            if (disp <= fyEnd) {
              const eom = new Date(disp.getFullYear(), disp.getMonth() + 1, 0);
              depDaysOpen = Math.max(0,
                Math.min(Math.round((eom.getTime() - fyStart.getTime()) / 86400000) + 1, FY_DAYS)
              );
            }
          }

          const rawDep = Math.round(annualDep * (depDaysOpen / FY_DAYS) * 100) / 100;

          // Final-year balancing figure: dep cannot exceed (WDV - Residual)
          const maxDep = Math.max(0, Math.round((wdvOpen - residual) * 100) / 100);
          const isBalancing = rawDep > maxDep;
          depOnOpen = Math.min(rawDep, maxDep);

          if (isBalancing) {
            formulaJson = {
              method: 'SLM', status: 'balancing_year',
              formula_text:
                `Opening WDV ₹${fmtINR(wdvOpen)} − Residual ₹${fmtINR(residual)} = ₹${fmtINR(depOnOpen)}` +
                ` (Balancing Figure — Final Year of Useful Life)`,
              cost: gbOpen, residual, useful_life_years: life,
              annual_dep: annualDep, dep_days: depDaysOpen,
              is_pro_rata: isFirstYear, is_balancing_year: true, wdv_open: wdvOpen,
            };
          } else if (isFirstYear) {
            formulaJson = {
              method: 'SLM', status: 'pro_rata_year',
              formula_text:
                `(₹${fmtINR(gbOpen)} − ₹${fmtINR(residual)}) ÷ ${life} yrs` +
                ` = ₹${fmtINR(annualDep)}/yr × (${depDaysOpen} ÷ 365) = ₹${fmtINR(depOnOpen)}`,
              cost: gbOpen, residual, useful_life_years: life,
              annual_dep: annualDep, dep_days: depDaysOpen,
              is_pro_rata: true, is_balancing_year: false, wdv_open: wdvOpen,
            };
          } else {
            formulaJson = {
              method: 'SLM', status: 'normal_year',
              formula_text:
                `(₹${fmtINR(gbOpen)} − ₹${fmtINR(residual)}) ÷ ${life} yrs = ₹${fmtINR(depOnOpen)}`,
              cost: gbOpen, residual, useful_life_years: life,
              annual_dep: annualDep, dep_days: depDaysOpen,
              is_pro_rata: false, is_balancing_year: false, wdv_open: wdvOpen,
            };
          }

        } else {
          // ── WDV method (unchanged logic) ────────────────────────────
          const wdvRate = parseFloat(cat.wdv_rate) || 0;
          if (wdvRate === 0) {
            errors.push(`${asset.asset_name}: ${cat.name} has no WDV rate`);
            continue;
          }
          if (asset.disposal_date) {
            const disp = new Date(asset.disposal_date);
            if (disp <= fyEnd) {
              const eom = new Date(disp.getFullYear(), disp.getMonth() + 1, 0);
              depDaysOpen = Math.max(0,
                Math.min(Math.round((eom.getTime() - fyStart.getTime()) / 86400000) + 1, FY_DAYS)
              );
            }
          }
          const maxWDV = Math.max(0, wdvOpen - residual);
          depOnOpen = Math.round(wdvOpen * (wdvRate / 100) * (depDaysOpen / FY_DAYS) * 100) / 100;
          depOnOpen = Math.min(depOnOpen, maxWDV);
          formulaJson = {
            method: 'WDV', status: 'normal_year',
            formula_text:
              `WDV ₹${fmtINR(wdvOpen)} × ${wdvRate}% × (${depDaysOpen}÷365) = ₹${fmtINR(depOnOpen)}`,
            wdv_rate: wdvRate, dep_days: depDaysOpen,
            residual, is_balancing_year: false, wdv_open: wdvOpen,
          };
        }

        // ── Additions depreciation ──────────────────────────────────
        let depOnAdd = 0, depDaysAdd = 0;
        if (addns > 0) {
          const addResidualPct = parseFloat(cat.residual_value_pct) || 5;
          const addResidual    = Math.round(addns * addResidualPct / 100 * 100) / 100;
          if (method === 'SLM') {
            const life      = cat.useful_life_years || 1;
            const addAnnual = Math.round(((addns - addResidual) / life) * 100) / 100;
            if (asset.addition_date) {
              const addDate = new Date(asset.addition_date);
              if (addDate >= fyStart && addDate <= fyEnd) {
                depDaysAdd = Math.round((fyEnd.getTime() - addDate.getTime()) / 86400000) + 1;
                depOnAdd   = Math.round(addAnnual * (depDaysAdd / FY_DAYS) * 100) / 100;
              } else if (addDate < fyStart) {
                depDaysAdd = FY_DAYS;
                depOnAdd   = addAnnual;
              }
            } else {
              depDaysAdd = Math.round(FY_DAYS / 2);
              depOnAdd   = Math.round(addAnnual * 0.5 * 100) / 100;
            }
          } else {
            const wdvRate = parseFloat(cat.wdv_rate) || 0;
            if (asset.addition_date) {
              const addDate = new Date(asset.addition_date);
              if (addDate >= fyStart && addDate <= fyEnd) {
                depDaysAdd = Math.round((fyEnd.getTime() - addDate.getTime()) / 86400000) + 1;
                depOnAdd   = Math.round(addns * (wdvRate/100) * (depDaysAdd/FY_DAYS) * 100) / 100;
              } else if (addDate < fyStart) {
                depDaysAdd = FY_DAYS;
                depOnAdd   = Math.round(addns * (wdvRate/100) * 100) / 100;
              }
            } else {
              depDaysAdd = Math.round(FY_DAYS / 2);
              depOnAdd   = Math.round(addns * (wdvRate/100) * 0.5 * 100) / 100;
            }
          }
        }

        const totalDep = Math.round((depOnOpen + depOnAdd) * 100) / 100;
        const gbClose  = gbOpen + addns - disps;
        const acClose  = Math.round((acOpen + totalDep) * 100) / 100;

        // WDV HARD FLOOR: closing WDV must never go below residual value
        let wdvClose = Math.round((wdvOpen + addns - disps - totalDep) * 100) / 100;
        if (disps > 0 && disps >= gbOpen + addns) {
          wdvClose = 0;               // fully disposed — WDV goes to zero
        } else {
          wdvClose = Math.max(wdvClose, residual);  // hard floor
        }

        const isFullyDep = wdvClose <= residual;
        const vErrs: string[] = [];
        if (wdvClose < 0)      vErrs.push('WDV closing is negative.');
        if (acClose > gbClose) vErrs.push('Accumulated dep exceeds gross block.');

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
          dep_formula_json:         formulaJson,
        }).eq('id', asset.id);

        await sb.from('fa_depreciation_schedule').delete().eq('asset_id', asset.id).eq('fy', fy);
        await sb.from('fa_depreciation_schedule').insert({
          asset_id: asset.id, fy,
          depreciation_rate:
            method === 'SLM'
              ? Math.round(((gbOpen - residual) / (cat.useful_life_years || 1)) / gbOpen * 100 * 100) / 100
              : (parseFloat(cat.wdv_rate) || 0),
          depreciation_amount: totalDep,
          wdv_opening: wdvOpen,
          wdv_closing: wdvClose,
        });

        results.push({
          asset_id: asset.id, asset_name: asset.asset_name,
          method, total_depreciation: totalDep,
          wdv_opening: wdvOpen, wdv_closing: wdvClose, residual,
          is_fully_depreciated: isFullyDep,
          formula: formulaJson.formula_text,
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
