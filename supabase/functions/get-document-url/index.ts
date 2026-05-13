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
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    if (file_path) {
      // Direct storage path — use service role, no RLS check needed
      r2_key = file_path;
      storageBucket = bucket || "documents";
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
      JSON.stringify({ signed_url: urlData.signedUrl, filename: doc.filename }),
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
