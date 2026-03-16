import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { engagement_id } = await req.json();
    if (!engagement_id) throw new Error("engagement_id is required");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Get current engagement
    const { data: eng, error: engErr } = await supabase
      .from("audit_engagements")
      .select("client_id, financial_year, firm_id")
      .eq("id", engagement_id)
      .single();
    if (engErr || !eng) throw new Error("Engagement not found");

    // Get current notes
    const { data: currentNotes, error: notesErr } = await supabase
      .from("notes_to_accounts")
      .select("*")
      .eq("engagement_id", engagement_id)
      .single();
    if (notesErr || !currentNotes) throw new Error("No notes found for this engagement");

    // Compute next FY: "2024-25" → "2025-26"
    const parts = eng.financial_year.split("-");
    const startY = parseInt(parts[0]);
    const endY = parseInt(parts[1]);
    const nextFY = `${startY + 1}-${String(endY + 1).padStart(2, "0")}`;

    // Find next engagement for same client
    const { data: nextEng } = await supabase
      .from("audit_engagements")
      .select("id")
      .eq("client_id", eng.client_id)
      .eq("financial_year", nextFY)
      .maybeSingle();

    // Build rolled-over notes
    const NOTE_KEYS = [
      "note_29", "note_30", "note_31", "note_32", "note_33",
      "note_34", "note_35", "note_36", "note_37", "note_38",
      "note_39", "note_40", "note_41", "note_42", "note_43",
      "note_44", "note_45",
    ];

    const rolledOverNotes: Record<string, any> = {};
    for (const key of NOTE_KEYS) {
      const currentData = (currentNotes as any)[key] || {};
      rolledOverNotes[key] = {
        previous_year_rolled: currentData,
        rolled_from_fy: eng.financial_year,
      };
    }

    if (nextEng) {
      // Check if notes record exists for next engagement
      const { data: existingNext } = await supabase
        .from("notes_to_accounts")
        .select("id")
        .eq("engagement_id", nextEng.id)
        .maybeSingle();

      if (existingNext) {
        await supabase
          .from("notes_to_accounts")
          .update(rolledOverNotes)
          .eq("id", existingNext.id);
      } else {
        await supabase.from("notes_to_accounts").insert({
          engagement_id: nextEng.id,
          firm_id: eng.firm_id,
          client_id: eng.client_id,
          financial_year: nextFY,
          ...rolledOverNotes,
        });
      }
    } else {
      // Store in buffer for when next engagement is created
      await supabase.from("notes_rollover_buffer").upsert({
        client_id: eng.client_id,
        firm_id: eng.firm_id,
        from_financial_year: eng.financial_year,
        to_financial_year: nextFY,
        rolled_notes: rolledOverNotes,
      }, { onConflict: "client_id,to_financial_year" });
    }

    // Mark current engagement notes as finalized
    await supabase
      .from("audit_engagements")
      .update({
        notes_finalized: true,
        notes_finalized_at: new Date().toISOString(),
      })
      .eq("id", engagement_id);

    return new Response(
      JSON.stringify({ success: true, rolled_to: nextFY, had_next_engagement: !!nextEng }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("rollover error:", e);
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
