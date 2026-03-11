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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

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

      const grossBlock = parseFloat(asset.gross_block_opening) + parseFloat(asset.additions_during_year) - parseFloat(asset.disposals_during_year);
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
      await supabase
        .from("fa_assets")
        .update({ depreciation_for_year: depAmount })
        .eq("id", asset.id);

      // Upsert depreciation schedule
      // Delete existing for this asset+fy, then insert
      await supabase
        .from("fa_depreciation_schedule")
        .delete()
        .eq("asset_id", asset.id)
        .eq("fy", fy);

      await supabase
        .from("fa_depreciation_schedule")
        .insert({
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
