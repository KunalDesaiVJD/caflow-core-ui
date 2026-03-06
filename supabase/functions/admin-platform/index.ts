import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Verify superadmin
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

  // Verify the user's JWT
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: claimsData, error: claimsError } = await userClient.auth.getUser();
  if (claimsError || !claimsData?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }

  const userId = claimsData.user.id;

  // Service role client for bypassing RLS
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  // Check if user is superadmin
  const { data: userData } = await adminClient
    .from("users")
    .select("role")
    .eq("id", userId)
    .single();

  if (!userData || userData.role !== "superadmin") {
    return new Response(JSON.stringify({ error: "Forbidden: superadmin only" }), { status: 403, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  try {
    // GET STATS
    if (req.method === "GET" && action === "stats") {
      const [firmsRes, usersRes, clientsRes, subsRes] = await Promise.all([
        adminClient.from("firms").select("id", { count: "exact", head: true }).eq("is_active", true),
        adminClient.from("users").select("id", { count: "exact", head: true }),
        adminClient.from("clients").select("id", { count: "exact", head: true }),
        adminClient.from("firms").select("id", { count: "exact", head: true }).eq("is_active", true).not("plan", "is", null),
      ]);

      return new Response(JSON.stringify({
        activeFirms: firmsRes.count || 0,
        totalUsers: usersRes.count || 0,
        totalClients: clientsRes.count || 0,
        activeSubscriptions: subsRes.count || 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // GET FIRMS
    if (req.method === "GET" && action === "firms") {
      const { data: firms } = await adminClient
        .from("firms")
        .select("*")
        .order("created_at", { ascending: false });

      const firmsWithCounts = await Promise.all(
        (firms || []).map(async (firm: any) => {
          const [usersCount, clientsCount] = await Promise.all([
            adminClient.from("users").select("id", { count: "exact", head: true }).eq("firm_id", firm.id),
            adminClient.from("clients").select("id", { count: "exact", head: true }).eq("firm_id", firm.id),
          ]);
          return {
            ...firm,
            users_count: usersCount.count || 0,
            clients_count: clientsCount.count || 0,
          };
        })
      );

      return new Response(JSON.stringify(firmsWithCounts), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ADD FIRM
    if (req.method === "POST" && action === "add-firm") {
      const body = await req.json();
      const { data, error } = await adminClient.from("firms").insert({
        name: body.name,
        icai_reg_no: body.icai_reg_no || null,
        plan: body.plan || "starter",
        is_active: true,
      }).select().single();

      if (error) throw error;
      return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // UPDATE FIRM
    if (req.method === "POST" && action === "update-firm") {
      const body = await req.json();
      const { data, error } = await adminClient.from("firms")
        .update({ name: body.name, plan: body.plan, is_active: body.is_active })
        .eq("id", body.id)
        .select()
        .single();

      if (error) throw error;
      return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // TOGGLE ACTIVE
    if (req.method === "POST" && action === "toggle-active") {
      const body = await req.json();
      const { data, error } = await adminClient.from("firms")
        .update({ is_active: body.is_active })
        .eq("id", body.id)
        .select()
        .single();

      if (error) throw error;
      return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // IMPERSONATE
    if (req.method === "POST" && action === "impersonate") {
      const body = await req.json();
      // Log to version_history
      await adminClient.from("version_history").insert({
        operation: "IMPERSONATE",
        user_name: body.superadmin_name || "Superadmin",
        user_role: "superadmin",
        table_name: "firms",
        record_id: body.firm_id,
        new_data: { impersonated_firm: body.firm_name },
      });

      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // GET LOGS
    if (req.method === "GET" && action === "logs") {
      const page = parseInt(url.searchParams.get("page") || "1");
      const perPage = 25;
      const from = (page - 1) * perPage;
      const to = from + perPage - 1;

      let query = adminClient.from("version_history").select("*", { count: "exact" });

      const firmFilter = url.searchParams.get("firm_id");
      const userFilter = url.searchParams.get("user_name");
      const tableFilter = url.searchParams.get("table_name");
      const opFilter = url.searchParams.get("operation");
      const dateFrom = url.searchParams.get("date_from");
      const dateTo = url.searchParams.get("date_to");

      if (firmFilter) {
        // version_history doesn't have firm_id, so we filter by record_id or skip
      }
      if (userFilter) query = query.ilike("user_name", `%${userFilter}%`);
      if (tableFilter) query = query.eq("table_name", tableFilter);
      if (opFilter) query = query.eq("operation", opFilter);
      if (dateFrom) query = query.gte("created_at", dateFrom);
      if (dateTo) query = query.lte("created_at", dateTo);

      const { data, count, error } = await query
        .order("created_at", { ascending: false })
        .range(from, to);

      if (error) throw error;
      return new Response(JSON.stringify({ data, total: count || 0, page, perPage }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: corsHeaders });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
