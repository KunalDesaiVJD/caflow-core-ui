import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { client_id, fy } = await req.json();
    if (!client_id || !fy) throw new Error("client_id and fy are required");

    // FY '2024-25' => April 1 2024 to March 31 2025
    const fyY = parseInt(fy.split("-")[0]);
    const fyStart = new Date(fyY, 3, 1);
    const fyEnd = new Date(fyY + 1, 2, 31);
    const FY_DAYS = 365;

    const { data: assets, error } = await sb
      .from("fa_assets")
      .select("*, fa_categories(*)")
      .eq("client_id", client_id)
      .eq("fy", fy)
      .eq("is_locked", false);
    if (error) throw error;
    if (!assets?.length)
      return new Response(JSON.stringify({ message: "No unlocked assets found", count: 0 }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });

    const results: any[] = [];
    const errors: string[] = [];

    for (const asset of assets) {
      try {
        const cat = asset.fa_categories;
        if (!cat) {
          errors.push(`${asset.asset_name}: no category`);
          continue;
        }

        // WDV: rate applied to Written Down Value (reducing balance each year)
        // SLM: rate applied to Original Gross Block (constant every year)
        const method = (cat.depreciation_method || "WDV").toUpperCase() as "WDV" | "SLM";
        const wdvRate = parseFloat(cat.wdv_rate) || 0;
        const slmRate = parseFloat(cat.slm_rate) || 0;
        const rateToUse = method === "SLM" ? slmRate : wdvRate;
        if (rateToUse === 0) {
          errors.push(`${asset.asset_name}: ${cat.name} has no ${method} rate`);
          continue;
        }

        const gbOpen = parseFloat(asset.gross_block_opening) || 0;
        const acOpen = parseFloat(asset.accumulated_dep_opening) || 0;
        const addns = parseFloat(asset.additions_during_year) || 0;
        const disps = parseFloat(asset.disposals_during_year) || 0;

        // Opening WDV = Gross Block Opening minus Accumulated Dep Opening
        // Additions are NEVER added to wdvOpen — they get separate calculation
        const wdvOpen = gbOpen - acOpen;
        const residual = (gbOpen * (parseFloat(cat.residual_value_pct) || 5)) / 100;

        // Fully depreciated check
        const stillLeft = Math.max(0, gbOpen - residual - acOpen);
        if (stillLeft <= 0 && addns === 0) {
          await sb
            .from("fa_assets")
            .update({
              depreciation_for_year: 0,
              dep_on_opening_block: 0,
              dep_on_additions: 0,
              gross_block_closing: gbOpen - disps,
              accumulated_dep_closing: acOpen,
              wdv_closing: wdvOpen - disps,
              is_fully_depreciated: true,
              residual_value: residual,
              depreciation_method_used: method,
            })
            .eq("id", asset.id);
          results.push({
            asset_id: asset.id,
            asset_name: asset.asset_name,
            status: "fully_depreciated",
            method,
            depreciation: 0,
          });
          continue;
        }

        // WDV base = wdvOpen  (reducing balance)
        // SLM base = gbOpen   (original cost, constant every year)
        const depBaseOpen = method === "SLM" ? gbOpen : wdvOpen;

        // Days for opening block — full year by default
        // Disposal: depreciate up to END OF DISPOSAL MONTH (Companies Act 2013)
        let depDaysOpen = FY_DAYS;
        if (asset.disposal_date) {
          const disp = new Date(asset.disposal_date);
          if (disp <= fyEnd) {
            const endOfMonth = new Date(disp.getFullYear(), disp.getMonth() + 1, 0);
            depDaysOpen = Math.max(
              0,
              Math.min(Math.round((endOfMonth.getTime() - fyStart.getTime()) / 86400000) + 1, FY_DAYS),
            );
          }
        }
        let depOnOpen = Math.round(depBaseOpen * (rateToUse / 100) * (depDaysOpen / FY_DAYS) * 100) / 100;
        // SLM cap: cannot exceed remaining depreciable amount
        if (method === "SLM") depOnOpen = Math.min(depOnOpen, stillLeft);

        // Additions: proportionate from addition date to FY end
        let depOnAdd = 0,
          depDaysAdd = 0;
        if (addns > 0) {
          if (asset.addition_date) {
            const addDate = new Date(asset.addition_date);
            if (addDate >= fyStart && addDate <= fyEnd) {
              depDaysAdd = Math.round((fyEnd.getTime() - addDate.getTime()) / 86400000) + 1;
              depOnAdd = Math.round(addns * (rateToUse / 100) * (depDaysAdd / FY_DAYS) * 100) / 100;
            } else if (addDate < fyStart) {
              depDaysAdd = FY_DAYS;
              depOnAdd = Math.round(addns * (rateToUse / 100) * 100) / 100;
            }
          } else {
            // No date — half-year rule
            depDaysAdd = Math.round(FY_DAYS / 2);
            depOnAdd = Math.round(addns * (rateToUse / 100) * 0.5 * 100) / 100;
          }
        }

        const totalDep = Math.round((depOnOpen + depOnAdd) * 100) / 100;
        const gbClose = gbOpen + addns - disps;
        const acClose = acOpen + totalDep;
        const wdvClose = Math.round((wdvOpen + addns - disps - totalDep) * 100) / 100;

        // Validation
        const vErrs: string[] = [];
        if (wdvClose < 0) vErrs.push("WDV closing is negative.");
        if (acClose > gbClose) vErrs.push("Accumulated dep exceeds gross block.");
        if (acOpen > gbOpen) vErrs.push("Opening acc dep > opening gross block.");

        await sb
          .from("fa_assets")
          .update({
            depreciation_for_year: totalDep,
            dep_on_opening_block: depOnOpen,
            dep_on_additions: depOnAdd,
            dep_days_opening: depDaysOpen,
            dep_days_addition: depDaysAdd || null,
            gross_block_closing: gbClose,
            accumulated_dep_closing: acClose,
            wdv_closing: wdvClose,
            is_fully_depreciated: wdvClose <= residual,
            residual_value: residual,
            depreciation_method_used: method,
          })
          .eq("id", asset.id);

        await sb.from("fa_depreciation_schedule").delete().eq("asset_id", asset.id).eq("fy", fy);
        await sb.from("fa_depreciation_schedule").insert({
          asset_id: asset.id,
          fy,
          depreciation_rate: rateToUse,
          depreciation_amount: totalDep,
          wdv_opening: wdvOpen,
          wdv_closing: wdvClose,
        });

        results.push({
          asset_id: asset.id,
          asset_name: asset.asset_name,
          category: cat.name,
          method,
          rate_used: rateToUse,
          gross_block_opening: gbOpen,
          wdv_opening: wdvOpen,
          dep_base: depBaseOpen,
          dep_on_opening: depOnOpen,
          additions: addns,
          dep_on_additions: depOnAdd,
          total_depreciation: totalDep,
          wdv_closing: wdvClose,
          gross_block_closing: gbClose,
          accumulated_dep_closing: acClose,
          days_opening: depDaysOpen,
          days_addition: depDaysAdd,
          is_fully_depreciated: wdvClose <= residual,
          validation_errors: vErrs,
          status: vErrs.length > 0 ? "warning" : "ok",
        });
      } catch (e: any) {
        errors.push(`${asset.asset_name}: ${e.message}`);
      }
    }

    return new Response(
      JSON.stringify({
        message: "Depreciation calculated",
        count: results.length,
        results,
        errors,
        warnings: results.filter((r) => r.status === "warning"),
      }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { client_id, fy } = await req.json();
    if (!client_id || !fy) throw new Error("client_id and fy required");

    // Parse FY: "2025-26" → start 2025-04-01, end 2026-03-31
    const fyStart = fy.split("-")[0];
    const fyStartYear = parseInt(fyStart);
    const fyStartDate = new Date(fyStartYear, 3, 1); // April 1
    const fyEndDate = new Date(fyStartYear + 1, 2, 31); // March 31
    const totalDays = Math.round((fyEndDate.getTime() - fyStartDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    // Get assets for this client + FY
    const { data: assets, error: assetsErr } = await supabase
      .from("fa_assets")
      .select("*, fa_categories(*)")
      .eq("client_id", client_id)
      .eq("fy", fy)
      .eq("is_locked", false);

    if (assetsErr) throw assetsErr;
    if (!assets || assets.length === 0) {
      return new Response(JSON.stringify({ message: "No unlocked assets found", count: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results = [];

    for (const asset of assets) {
      const category = asset.fa_categories;
      if (!category) continue;

      const usefulLife = category.useful_life_years;
      const residualPct = parseFloat(category.residual_value_pct) || 5;

      // WDV depreciation rate = 1 - (residual_value / 100) ^ (1/useful_life)
      // Simplified: rate per Companies Act Schedule II
      const rate = (1 - Math.pow(residualPct / 100, 1 / usefulLife)) * 100;

      const grossBlock =
        parseFloat(asset.gross_block_opening) +
        parseFloat(asset.additions_during_year) -
        parseFloat(asset.disposals_during_year);
      const wdvOpening = grossBlock - parseFloat(asset.accumulated_dep_opening);

      let depreciationDays = totalDays;

      // Proportionate for additions mid-year
      if (asset.addition_date) {
        const addDate = new Date(asset.addition_date);
        if (addDate > fyStartDate) {
          depreciationDays = Math.round((fyEndDate.getTime() - addDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        }
      }

      // If disposed, depreciate only until disposal date
      if (asset.disposal_date) {
        const dispDate = new Date(asset.disposal_date);
        if (dispDate < fyEndDate) {
          const dispDays = Math.round((dispDate.getTime() - fyStartDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
          depreciationDays = Math.min(depreciationDays, Math.max(dispDays, 0));
        }
      }

      const proportionFactor = depreciationDays / totalDays;
      const depAmount = Math.round(wdvOpening * (rate / 100) * proportionFactor * 100) / 100;
      const wdvClosing = Math.round((wdvOpening - depAmount) * 100) / 100;

      // Update asset
      await supabase.from("fa_assets").update({ depreciation_for_year: depAmount }).eq("id", asset.id);

      // Upsert depreciation schedule
      // Delete existing for this asset+fy, then insert
      await supabase.from("fa_depreciation_schedule").delete().eq("asset_id", asset.id).eq("fy", fy);

      await supabase.from("fa_depreciation_schedule").insert({
        asset_id: asset.id,
        fy,
        depreciation_rate: Math.round(rate * 100) / 100,
        depreciation_amount: depAmount,
        wdv_opening: Math.round(wdvOpening * 100) / 100,
        wdv_closing: wdvClosing,
      });

      results.push({
        asset_id: asset.id,
        asset_name: asset.asset_name,
        rate: Math.round(rate * 100) / 100,
        wdv_opening: Math.round(wdvOpening * 100) / 100,
        depreciation: depAmount,
        wdv_closing: wdvClosing,
        days: depreciationDays,
      });
    }

    return new Response(JSON.stringify({ message: "Depreciation calculated", count: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
