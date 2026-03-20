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

    // Helper: exact calendar days between two dates (both inclusive)
    const daysBetweenInclusive = (from: Date, to: Date): number => {
      return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86400000) + 1);
    };

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

        const residualPct = parseFloat(cat.residual_value_pct) || 5;
        const residual = (asset.residual_value != null && asset.residual_value !== '')
          ? parseFloat(asset.residual_value)
          : Math.round((gbOpen * residualPct) / 100 * 100) / 100;

        // ── Fully-depreciated check ──────────────────────────────────
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

        // ── Determine pro-rata start and end dates ───────────────────
        // Start = max(1st April, purchase date) — handles same-FY purchase+disposal
        const purchDate = asset.date_of_purchase ? new Date(asset.date_of_purchase) : null;
        const proRataStart = (purchDate && purchDate > fyStart && purchDate <= fyEnd)
          ? purchDate : fyStart;
        const isFirstYear = !!(purchDate && purchDate >= fyStart && purchDate <= fyEnd);

        // DISPOSAL FIX: use exact disposal date, NOT end-of-month
        const disposalDate = asset.disposal_date ? new Date(asset.disposal_date) : null;
        const isDisposalYear = !!(disposalDate && disposalDate >= fyStart && disposalDate <= fyEnd);

        // Pro-rata end = disposal date (if disposing this year) or 31-Mar
        const proRataEnd = isDisposalYear ? disposalDate! : fyEnd;

        // Exact calendar days (both inclusive)
        let depDaysOpen = daysBetweenInclusive(proRataStart, proRataEnd);
        depDaysOpen = Math.min(depDaysOpen, FY_DAYS); // cap at 365

        let depOnOpen = 0;
        let formulaJson: any = {};

        if (method === 'SLM') {
          const life = cat.useful_life_years || 1;
          const annualDep = Math.round(((gbOpen - residual) / life) * 100) / 100;

          const rawDep = Math.round(annualDep * (depDaysOpen / FY_DAYS) * 100) / 100;

          // Cap: dep cannot exceed (WDV - Residual)
          const maxDep = Math.max(0, Math.round((wdvOpen - residual) * 100) / 100);
          const isBalancing = rawDep > maxDep;
          depOnOpen = Math.min(rawDep, maxDep);

          const statusLabel = isDisposalYear ? 'disposal_year'
            : isBalancing ? 'balancing_year'
            : (isFirstYear || depDaysOpen < FY_DAYS) ? 'pro_rata_year'
            : 'normal_year';

          const daysNote = depDaysOpen < FY_DAYS
            ? ` × (${depDaysOpen} ÷ ${FY_DAYS})` : '';

          formulaJson = {
            method: 'SLM', status: statusLabel,
            formula_text: isBalancing
              ? `Opening WDV ₹${fmtINR(wdvOpen)} − Residual ₹${fmtINR(residual)} = ₹${fmtINR(depOnOpen)} (Balancing Figure)`
              : `(₹${fmtINR(gbOpen)} − ₹${fmtINR(residual)}) ÷ ${life} yrs = ₹${fmtINR(annualDep)}/yr${daysNote} = ₹${fmtINR(depOnOpen)}`,
            cost: gbOpen, residual, useful_life_years: life,
            annual_dep: annualDep, dep_days: depDaysOpen,
            is_pro_rata: depDaysOpen < FY_DAYS, is_balancing_year: isBalancing,
            is_disposal_year: isDisposalYear, wdv_open: wdvOpen,
            disposal_date: asset.disposal_date || null,
          };

        } else {
          // ── WDV method ─────────────────────────────────────────────
          const wdvRate = parseFloat(cat.wdv_rate) || 0;
          if (wdvRate === 0) {
            errors.push(`${asset.asset_name}: ${cat.name} has no WDV rate`);
            continue;
          }

          const annualDep = Math.round(wdvOpen * (wdvRate / 100) * 100) / 100;
          const rawDep = Math.round(annualDep * (depDaysOpen / FY_DAYS) * 100) / 100;

          // Cap: dep cannot exceed (WDV - Residual)
          const maxWDV = Math.max(0, wdvOpen - residual);
          depOnOpen = Math.min(rawDep, maxWDV);

          const daysNote = depDaysOpen < FY_DAYS
            ? ` × (${depDaysOpen} ÷ ${FY_DAYS})` : '';

          formulaJson = {
            method: 'WDV',
            status: isDisposalYear ? 'disposal_year' : 'normal_year',
            formula_text:
              `WDV ₹${fmtINR(wdvOpen)} × ${wdvRate}%${daysNote} = ₹${fmtINR(depOnOpen)}`,
            wdv_rate: wdvRate, dep_days: depDaysOpen, annual_dep: annualDep,
            residual, is_balancing_year: false, wdv_open: wdvOpen,
            is_pro_rata: depDaysOpen < FY_DAYS,
            is_disposal_year: isDisposalYear,
            disposal_date: asset.disposal_date || null,
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
                const addEnd = isDisposalYear ? disposalDate! : fyEnd;
                depDaysAdd = daysBetweenInclusive(addDate, addEnd);
                depOnAdd   = Math.round(addAnnual * (depDaysAdd / FY_DAYS) * 100) / 100;
              } else if (addDate < fyStart) {
                depDaysAdd = depDaysOpen; // same as opening block days
                depOnAdd   = Math.round(addAnnual * (depDaysAdd / FY_DAYS) * 100) / 100;
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
                const addEnd = isDisposalYear ? disposalDate! : fyEnd;
                depDaysAdd = daysBetweenInclusive(addDate, addEnd);
                depOnAdd   = Math.round(addns * (wdvRate/100) * (depDaysAdd/FY_DAYS) * 100) / 100;
              } else if (addDate < fyStart) {
                depDaysAdd = depDaysOpen;
                depOnAdd   = Math.round(addns * (wdvRate/100) * (depDaysAdd/FY_DAYS) * 100) / 100;
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

        // ── WDV Closing ──────────────────────────────────────────────
        // DISPOSAL: After disposal the asset is removed from register.
        // Closing WDV = Opening WDV - depreciation (for the disposal year record).
        // The asset should NOT be carried forward.
        let wdvClose = Math.round((wdvOpen + addns - disps - totalDep) * 100) / 100;
        if (isDisposalYear && disps > 0) {
          // Asset disposed — WDV goes to 0 (asset leaves the register)
          wdvClose = 0;
        } else if (disps > 0 && disps >= gbOpen + addns) {
          wdvClose = 0;
        } else {
          wdvClose = Math.max(wdvClose, residual); // hard floor at residual
        }

        const isFullyDep = !isDisposalYear && wdvClose <= residual;
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
              ? Math.round(((gbOpen - residual) / (cat.useful_life_years || 1)) / (gbOpen || 1) * 100 * 100) / 100
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
          is_disposal_year: isDisposalYear,
          dep_days: depDaysOpen,
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
