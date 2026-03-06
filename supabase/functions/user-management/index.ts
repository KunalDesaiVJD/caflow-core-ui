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

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: authUser }, error: userError } = await userClient.auth.getUser();
  if (userError || !authUser) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }

  const userId = authUser.id;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  // Get requesting user's profile
  const { data: requestingUser } = await adminClient
    .from("users")
    .select("role, firm_id, name")
    .eq("id", userId)
    .single();

  if (!requestingUser || !["superadmin", "firm_admin"].includes(requestingUser.role)) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  try {
    // LIST USERS for current firm
    if (req.method === "GET" && action === "list") {
      let query = adminClient.from("users").select("*");
      if (requestingUser.role !== "superadmin") {
        query = query.eq("firm_id", requestingUser.firm_id);
      }
      const firmId = url.searchParams.get("firm_id");
      if (firmId) query = query.eq("firm_id", firmId);

      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw error;
      return new Response(JSON.stringify(data || []), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // CREATE USER
    if (req.method === "POST" && action === "create") {
      const body = await req.json();
      const { name, email, phone, role, firm_id } = body;

      // Role hierarchy check
      const roleHierarchy: Record<string, number> = {
        superadmin: 4, firm_admin: 3, partner: 2, manager: 1, staff: 0, client: -1,
      };
      if ((roleHierarchy[role] || 0) >= (roleHierarchy[requestingUser.role] || 0)) {
        return new Response(JSON.stringify({ error: "Cannot create user with equal or higher role" }), {
          status: 403, headers: corsHeaders,
        });
      }

      const targetFirmId = requestingUser.role === "superadmin" ? (firm_id || requestingUser.firm_id) : requestingUser.firm_id;

      // Generate temp password
      const tempPassword = crypto.randomUUID().slice(0, 12) + "A1!";

      // Create auth user
      const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { role, firm_id: targetFirmId, name },
      });
      if (authError) throw authError;

      // Insert into users table
      const { data: newUser, error: insertError } = await adminClient.from("users").insert({
        id: authUser.user.id,
        name,
        email,
        phone: phone || null,
        role,
        firm_id: targetFirmId,
        is_active: true,
      }).select().single();
      if (insertError) throw insertError;

      return new Response(JSON.stringify({ user: newUser, temp_password: tempPassword }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // UPDATE USER
    if (req.method === "POST" && action === "update") {
      const body = await req.json();
      const { user_id, name, phone, role } = body;

      // Role hierarchy check for role changes
      if (role) {
        const roleHierarchy: Record<string, number> = {
          superadmin: 4, firm_admin: 3, partner: 2, manager: 1, staff: 0, client: -1,
        };
        if ((roleHierarchy[role] || 0) >= (roleHierarchy[requestingUser.role] || 0)) {
          return new Response(JSON.stringify({ error: "Cannot assign equal or higher role" }), {
            status: 403, headers: corsHeaders,
          });
        }
      }

      const updateData: Record<string, unknown> = {};
      if (name !== undefined) updateData.name = name;
      if (phone !== undefined) updateData.phone = phone;
      if (role !== undefined) updateData.role = role;

      const { data, error } = await adminClient.from("users")
        .update(updateData)
        .eq("id", user_id)
        .select()
        .single();
      if (error) throw error;

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // TOGGLE ACTIVE
    if (req.method === "POST" && action === "toggle-active") {
      const body = await req.json();
      const { data, error } = await adminClient.from("users")
        .update({ is_active: body.is_active })
        .eq("id", body.user_id)
        .select()
        .single();
      if (error) throw error;
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // RESET PASSWORD
    if (req.method === "POST" && action === "reset-password") {
      const body = await req.json();
      const { error } = await adminClient.auth.admin.generateLink({
        type: "recovery",
        email: body.email,
      });
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET ACTIVITY (version_history for a user)
    if (req.method === "GET" && action === "activity") {
      const targetUserId = url.searchParams.get("user_id");
      // Get user name first
      const { data: targetUser } = await adminClient.from("users")
        .select("name")
        .eq("id", targetUserId)
        .single();

      const { data, error } = await adminClient.from("version_history")
        .select("*")
        .eq("user_name", targetUser?.name || "")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return new Response(JSON.stringify(data || []), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: corsHeaders });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
