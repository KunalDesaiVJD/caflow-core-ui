import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ROLE_HIERARCHY: Record<string, number> = {
  superadmin: 5,
  firm_admin: 4,
  partner_ca: 3,
  manager: 2,
  staff_article: 1,
  client: 0,
};

const DEFAULT_PASSWORDS: Record<string, string> = {
  superadmin: "SuperAdmin@2025!",
  firm_admin: "FirmAdmin@2025!",
  partner_ca: "Partner@2025!",
  manager: "Manager@2025!",
  staff_article: "Staff@2025!",
  client: "Client@2025!",
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
  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
  if (claimsError || !claimsData?.claims) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }

  const userId = claimsData.claims.sub as string;
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
    // LIST USERS
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
      if ((ROLE_HIERARCHY[role] ?? 0) >= (ROLE_HIERARCHY[requestingUser.role] ?? 0)) {
        return new Response(JSON.stringify({ error: "Cannot create user with equal or higher role" }), {
          status: 403, headers: corsHeaders,
        });
      }

      const targetFirmId = requestingUser.role === "superadmin" ? (firm_id || requestingUser.firm_id) : requestingUser.firm_id;

      // Use role-based default password
      const password = DEFAULT_PASSWORDS[role] || "Default@2025!";

      // Create auth user
      const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
        email,
        password,
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
        must_change_password: true,
      }).select().single();
      if (insertError) throw insertError;

      return new Response(JSON.stringify({ user: newUser, default_password: password }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // UPDATE USER
    if (req.method === "POST" && action === "update") {
      const body = await req.json();
      const { user_id, name, phone, role, firm_id } = body;

      if (role) {
        if ((ROLE_HIERARCHY[role] ?? 0) >= (ROLE_HIERARCHY[requestingUser.role] ?? 0)) {
          return new Response(JSON.stringify({ error: "Cannot assign equal or higher role" }), {
            status: 403, headers: corsHeaders,
          });
        }
      }

      // Fetch old data for audit logging
      const { data: oldUser } = await adminClient.from("users")
        .select("*")
        .eq("id", user_id)
        .single();

      const updateData: Record<string, unknown> = {};
      if (name !== undefined) updateData.name = name;
      if (phone !== undefined) updateData.phone = phone;
      if (role !== undefined) updateData.role = role;
      if (firm_id !== undefined && requestingUser.role === "superadmin") updateData.firm_id = firm_id;

      const { data, error } = await adminClient.from("users")
        .update(updateData)
        .eq("id", user_id)
        .select()
        .single();
      if (error) throw error;

      // Log to version_history for audit trail
      if (oldUser) {
        const changedFields: string[] = [];
        if (name !== undefined && name !== oldUser.name) changedFields.push("name");
        if (phone !== undefined && phone !== oldUser.phone) changedFields.push("phone");
        if (role !== undefined && role !== oldUser.role) changedFields.push("role");
        if (firm_id !== undefined && firm_id !== oldUser.firm_id) changedFields.push("firm_id");

        if (changedFields.length > 0) {
          await adminClient.from("version_history").insert({
            operation: "UPDATE",
            user_name: requestingUser.name || "Unknown",
            user_role: requestingUser.role,
            table_name: "users",
            record_id: user_id,
            old_data: oldUser,
            new_data: data,
            changed_fields: changedFields,
          });
        }
      }

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

    // ADMIN RESET PASSWORD
    if (req.method === "POST" && action === "reset-password") {
      const body = await req.json();
      const { user_id, temporary_password } = body;

      if (!user_id || !temporary_password) {
        return new Response(JSON.stringify({ error: "user_id and temporary_password required" }), {
          status: 400, headers: corsHeaders,
        });
      }

      // Update auth password
      const { error: authError } = await adminClient.auth.admin.updateUserById(user_id, {
        password: temporary_password,
      });
      if (authError) throw authError;

      // Set must_change_password flag
      const { error: dbError } = await adminClient.from("users")
        .update({ must_change_password: true })
        .eq("id", user_id);
      if (dbError) throw dbError;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET ACTIVITY
    if (req.method === "GET" && action === "activity") {
      const targetUserId = url.searchParams.get("user_id");

      // Search by record_id (changes TO this user) and by user_name (changes BY this user)
      const { data: targetUser } = await adminClient.from("users")
        .select("name")
        .eq("id", targetUserId)
        .single();

      // Get entries where this user was the target of the change (record_id matches)
      const { data: targetEntries } = await adminClient.from("version_history")
        .select("*")
        .eq("record_id", targetUserId)
        .eq("table_name", "users")
        .order("created_at", { ascending: false })
        .limit(20);

      // Also get entries where this user made changes (user_name matches)
      const { data: actorEntries } = await adminClient.from("version_history")
        .select("*")
        .eq("user_name", targetUser?.name || "")
        .order("created_at", { ascending: false })
        .limit(20);

      // Merge, deduplicate, and sort
      const allEntries = [...(targetEntries || []), ...(actorEntries || [])];
      const uniqueMap = new Map();
      for (const e of allEntries) uniqueMap.set(e.id, e);
      const merged = Array.from(uniqueMap.values())
        .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
        .slice(0, 30);

      return new Response(JSON.stringify(merged), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // CHANGE EMAIL
    if (req.method === "POST" && action === "change-email") {
      const body = await req.json();
      const { user_id, new_email } = body;
      if (!user_id || !new_email) {
        return new Response(JSON.stringify({ error: "user_id and new_email required" }), { status: 400, headers: corsHeaders });
      }
      // Check no other user has this email
      const { data: existing } = await adminClient.from("users").select("id").eq("email", new_email).neq("id", user_id).maybeSingle();
      if (existing) {
        return new Response(JSON.stringify({ error: "Email already in use by another account" }), { status: 409, headers: corsHeaders });
      }
      // Update auth email
      const { error: authErr } = await adminClient.auth.admin.updateUserById(user_id, { email: new_email, email_confirm: true });
      if (authErr) throw authErr;
      // Update public.users
      const { data, error } = await adminClient.from("users").update({ email: new_email }).eq("id", user_id).select().single();
      if (error) throw error;
      // Audit log
      await adminClient.from("version_history").insert({
        operation: "UPDATE", user_name: requestingUser.name || "Unknown", user_role: requestingUser.role,
        table_name: "users", record_id: user_id,
        old_data: { email: body.old_email }, new_data: { email: new_email }, changed_fields: ["email"],
      });
      return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // UPDATE AVATAR
    if (req.method === "POST" && action === "update-avatar") {
      const body = await req.json();
      const { user_id, avatar_url } = body;
      if (!user_id) {
        return new Response(JSON.stringify({ error: "user_id required" }), { status: 400, headers: corsHeaders });
      }
      const { data, error } = await adminClient.from("users").update({ avatar_url: avatar_url || null }).eq("id", user_id).select().single();
      if (error) throw error;
      return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // DELETE USER
    if (req.method === "POST" && action === "delete") {
      const body = await req.json();
      const { user_id } = body;
      if (!user_id) {
        return new Response(JSON.stringify({ error: "user_id required" }), { status: 400, headers: corsHeaders });
      }

      // Check target user exists and hierarchy
      const { data: targetUser } = await adminClient.from("users").select("role, firm_id").eq("id", user_id).single();
      if (!targetUser) {
        return new Response(JSON.stringify({ error: "User not found" }), { status: 404, headers: corsHeaders });
      }
      if ((ROLE_HIERARCHY[targetUser.role || ""] ?? 0) >= (ROLE_HIERARCHY[requestingUser.role] ?? 0)) {
        return new Response(JSON.stringify({ error: "Cannot delete user with equal or higher role" }), { status: 403, headers: corsHeaders });
      }
      if (requestingUser.role !== "superadmin" && targetUser.firm_id !== requestingUser.firm_id) {
        return new Response(JSON.stringify({ error: "Cannot delete user from another firm" }), { status: 403, headers: corsHeaders });
      }

      // Nullify FK references that lack ON DELETE SET NULL so the users row
      // can be deleted without a foreign-key violation.
      await Promise.all([
        adminClient.from("ai_usage_log").update({ user_id: null } as any).eq("user_id", user_id),
        adminClient.from("feedback").update({ user_id: null }     as any).eq("user_id", user_id),
        adminClient.from("clients").update({ user_id: null }      as any).eq("user_id", user_id),
      ]);

      // Delete from users table first, then auth
      const { error: dbError } = await adminClient.from("users").delete().eq("id", user_id);
      if (dbError) throw dbError;
      const { error: authError } = await adminClient.auth.admin.deleteUser(user_id);
      if (authError) console.error("Auth delete error (non-fatal):", authError.message);

      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: corsHeaders });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
