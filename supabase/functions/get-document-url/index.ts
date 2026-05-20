import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // JWT verification is handled by Supabase's edge-function gateway.
    // We only need the service-role client here to generate the signed URL
    // (bypasses storage RLS so any authenticated firm member can preview files).
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const { document_id, file_path, bucket } = body;

    if (!document_id && !file_path) {
      return new Response(JSON.stringify({ error: "Missing document_id or file_path" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let r2_key: string;
    let storageBucket: string;
    let filename: string | undefined;

    if (file_path) {
      // Direct storage path — use service role, no RLS check needed
      // doc lookup skipped; filename derived from path
      r2_key = file_path;
      storageBucket = bucket || "documents";
      filename = file_path.split("/").pop();
    } else {
      // Fetch document record using caller's JWT (RLS enforced)
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: `Bearer ${token}` } } }
      );

      const { data: doc, error: docErr } = await userClient
        .from("documents")
        .select("r2_key, filename")
        .eq("id", document_id)
        .maybeSingle();

      if (docErr || !doc || !doc.r2_key) {
        return new Response(JSON.stringify({ error: "Document not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      r2_key = doc.r2_key;
      storageBucket = "firm-assets";
      filename = doc.filename;
    }

    // Generate presigned URL valid for 1 hour using service role (bypasses storage RLS)
    const { data: urlData, error: urlErr } = await supabase
      .storage
      .from(storageBucket)
      .createSignedUrl(r2_key, 3600);

    if (urlErr || !urlData?.signedUrl) {
      return new Response(JSON.stringify({ error: "Failed to generate download URL" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ signed_url: urlData.signedUrl, filename }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("get-document-url error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
