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

// ── Graph API helpers (for portal credentials email) ─────────────────

async function getGraphToken(): Promise<string> {
  const tenantId     = Deno.env.get("GRAPH_TENANT_ID");
  const clientId     = Deno.env.get("GRAPH_CLIENT_ID");
  const clientSecret = Deno.env.get("GRAPH_CLIENT_SECRET");
  if (!tenantId || !clientId || !clientSecret) throw new Error("Graph credentials not configured");
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "client_credentials",
        client_id:     clientId,
        client_secret: clientSecret,
        scope:         "https://graph.microsoft.com/.default",
      }),
    }
  );
  const data = await res.json();
  if (!data.access_token) throw new Error("Graph token error: " + JSON.stringify(data));
  return data.access_token;
}

function buildCredentialsEmailHtml(name: string, email: string, password: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body{font-family:Arial,sans-serif;max-width:600px;margin:32px auto;padding:0;color:#333;background:#f4f4f5}
.wrap{background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}
.hdr{background:linear-gradient(135deg,#1a3a5c,#2d5a8e);padding:28px 32px;text-align:center}
.hdr h1{margin:0;color:#c9a84c;font-size:26px;font-weight:700;letter-spacing:1px}
.hdr h1 span{color:#fff}
.hdr p{margin:6px 0 0;color:rgba(255,255,255,.7);font-size:13px}
.bdy{padding:32px}
.creds{background:#f0f4ff;border:1px solid #d1d5db;border-radius:8px;padding:20px;margin:20px 0}
.creds p{margin:6px 0;font-size:14px}
.creds code{background:#fff;border:1px solid #d1d5db;padding:2px 8px;border-radius:4px;font-family:monospace;font-size:13px}
.warn{background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:0 6px 6px 0;margin:16px 0}
.warn p{margin:0;color:#92400e;font-size:13px}
.ftr{background:#f9fafb;padding:20px 32px;border-top:1px solid #e5e7eb;text-align:center;font-size:12px;color:#9ca3af}
</style></head>
<body>
<div class="wrap">
<div class="hdr">
  <h1>CA<span>Flow</span></h1>
  <p>Practice Management for CA Firms</p>
</div>
<div class="bdy">
  <h2 style="margin:0 0 8px;color:#1a3a5c;font-size:20px">Your Client Portal Access</h2>
  <p style="color:#6b7280;font-size:14px;margin:0 0 20px">Dear ${name},</p>
  <p style="color:#374151;font-size:14px;line-height:1.6;margin:0 0 20px">
    Your client portal account has been created by <strong>V J Desai &amp; Co. LLP</strong>.
    You can now securely access your audit queries, documents, and communications online.
  </p>
  <div class="creds">
    <p><strong>Login Email:</strong> <code>${email}</code></p>
    <p><strong>Temporary Password:</strong> <code>${password}</code></p>
  </div>
  <div class="warn">
    <p>⚠️ Please change your password immediately after your first login for security.</p>
  </div>
  <p style="color:#6b7280;font-size:13px;margin:16px 0 0">
    For any assistance, contact us at
    <a href="mailto:audit@vjdesai.com" style="color:#2d5a8e">audit@vjdesai.com</a>.
  </p>
</div>
<div class="ftr">
  V J Desai &amp; Co. LLP, Chartered Accountants<br>
  This is an automated message from CAFlow. Please do not reply to this email.<br>
  © ${new Date().getFullYear()} CAFlow Practice Management
</div>
</div>
</body></html>`;
}

async function sendCredentialsEmail(toEmail: string, name: string, password: string): Promise<void> {
  const fromEmail = Deno.env.get("SMTP_SENDER") || "audit@vjdesai.com";
  try {
    const token = await getGraphToken();
    const html  = buildCredentialsEmailHtml(name, toEmail, password);
    const res   = await fetch(`https://graph.microsoft.com/v1.0/users/${fromEmail}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject:      "Your Client Portal Access — V J Desai & Co. LLP",
          body:         { contentType: "HTML", content: html },
          toRecipients: [{ emailAddress: { address: toEmail } }],
          from:         { emailAddress: { name: "V J Desai & Co. LLP", address: fromEmail } },
        },
        saveToSentItems: true,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("[user-management] credentials email failed:", err.slice(0, 300));
    } else {
      console.log("[user-management] credentials email sent to", toEmail);
    }
  } catch (err: any) {
    // Non-fatal — portal activation should succeed even if email fails
    console.error("[user-management] sendCredentialsEmail error:", err.message);
  }
}

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

    // ACTIVATE PORTAL — create or reset portal account for a client by email
    if (req.method === "POST" && action === "activate-portal") {
      const body = await req.json();
      const { email, name, firm_id, client_id } = body;

      if (!email) {
        return new Response(JSON.stringify({ error: "email is required" }), { status: 400, headers: corsHeaders });
      }

      const password = DEFAULT_PASSWORDS["client"];

      // Look up existing auth user by email
      const { data: listData } = await adminClient.auth.admin.listUsers();
      const existing = listData?.users?.find((u: any) => u.email?.toLowerCase() === email.toLowerCase());

      let authUserId: string;

      if (existing) {
        // Reset password + mark must_change_password
        const { error: pwErr } = await adminClient.auth.admin.updateUserById(existing.id, { password });
        if (pwErr) throw pwErr;
        await adminClient.from("users").update({ must_change_password: true }).eq("id", existing.id);
        authUserId = existing.id;
      } else {
        // Create new auth user
        const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { role: "client", firm_id, name },
        });
        if (authError) throw authError;
        authUserId = authUser.user.id;
      }

      // Upsert users table row
      await adminClient.from("users").upsert({
        id: authUserId,
        name: name || email,
        email,
        role: "client",
        firm_id: firm_id || requestingUser.firm_id,
        is_active: true,
        must_change_password: true,
      }, { onConflict: "id" });

      // Link client record to auth user
      if (client_id) {
        await adminClient.from("clients").update({ user_id: authUserId }).eq("id", client_id);
      }

      // Send credentials email to the client from audit@vjdesai.com
      await sendCredentialsEmail(email, name || email, password);

      return new Response(JSON.stringify({ success: true, user_id: authUserId, default_password: password }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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

      // Pre-nullify every FK referencing public.users(id) so the delete cannot
      // be blocked by a missing ON DELETE SET NULL on any referencing table.
      // (Migration 20260415000006 adds the constraints permanently; this block
      //  is belt-and-suspenders for environments where that migration is pending.)
      await Promise.all([
        // log / audit tables
        adminClient.from("ai_usage_log")                   .update({ user_id:      null } as any).eq("user_id",      user_id),
        adminClient.from("feedback")                       .update({ user_id:      null } as any).eq("user_id",      user_id),
        adminClient.from("role_permission_audit_log")      .update({ changed_by:   null } as any).eq("changed_by",   user_id),
        adminClient.from("tds_filing_audit_log")           .update({ changed_by:   null } as any).eq("changed_by",   user_id),
        adminClient.from("demand_notice_status_history")   .update({ changed_by:   null } as any).eq("changed_by",   user_id),
        // engagements
        adminClient.from("audit_engagements")              .update({ manager_id:   null } as any).eq("manager_id",   user_id),
        adminClient.from("audit_engagements")              .update({ partner_id:   null } as any).eq("partner_id",   user_id),
        adminClient.from("audit_engagements")              .update({ sign_off_by:  null } as any).eq("sign_off_by",  user_id),
        adminClient.from("audit_engagements")              .update({ signed_by:    null } as any).eq("signed_by",    user_id),
        // clients / groups
        adminClient.from("client_groups")                  .update({ created_by:   null } as any).eq("created_by",   user_id),
        adminClient.from("client_group_memberships")       .update({ added_by:     null } as any).eq("added_by",     user_id),
        adminClient.from("client_auditor_assignments")     .update({ created_by:   null } as any).eq("created_by",   user_id),
        adminClient.from("clients")                        .update({ user_id:      null } as any).eq("user_id",      user_id),
        adminClient.from("clients")                        .update({ responsible_person_id: null } as any).eq("responsible_person_id", user_id),
        // demand notices
        adminClient.from("demand_notices")                 .update({ assigned_to:  null } as any).eq("assigned_to",  user_id),
        adminClient.from("demand_notices")                 .update({ created_by:   null } as any).eq("created_by",   user_id),
        // itr profiles
        adminClient.from("itr_profiles")                   .update({ assigned_to:  null } as any).eq("assigned_to",  user_id),
        adminClient.from("itr_profiles")                   .update({ prepared_by:  null } as any).eq("prepared_by",  user_id),
        adminClient.from("itr_profiles")                   .update({ checked_by:   null } as any).eq("checked_by",   user_id),
        adminClient.from("itr_profiles")                   .update({ upload_by:    null } as any).eq("upload_by",    user_id),
        // tds filings
        adminClient.from("tds_filings")                    .update({ created_by:   null } as any).eq("created_by",   user_id),
        adminClient.from("tds_filings")                    .update({ checker_id:   null } as any).eq("checker_id",   user_id),
        adminClient.from("tds_filings")                    .update({ approver_id:  null } as any).eq("approver_id",  user_id),
        adminClient.from("tds_filings")                    .update({ preparer_id:  null } as any).eq("preparer_id",  user_id),
        // fa (fixed assets)
        adminClient.from("fa_assets")                      .update({ created_by:   null } as any).eq("created_by",   user_id),
        adminClient.from("fa_asset_additions")             .update({ created_by:   null } as any).eq("created_by",   user_id),
        adminClient.from("fa_asset_disposals")             .update({ created_by:   null } as any).eq("created_by",   user_id),
        adminClient.from("fa_import_batches")              .update({ imported_by:  null } as any).eq("imported_by",  user_id),
        // misc
        adminClient.from("audit_firms")                    .update({ created_by:   null } as any).eq("created_by",   user_id),
        adminClient.from("billing_receipts")               .update({ created_by:   null } as any).eq("created_by",   user_id),
        adminClient.from("carry_forward_queries")          .update({ carried_by:   null } as any).eq("carried_by",   user_id),
        adminClient.from("chat_conversations")             .update({ created_by:   null } as any).eq("created_by",   user_id),
        adminClient.from("chat_messages")                  .update({ sender_id:    null } as any).eq("sender_id",    user_id),
        adminClient.from("chat_participants")              .delete()                             .eq("user_id",      user_id),
        adminClient.from("documents")                      .update({ signed_by:    null } as any).eq("signed_by",    user_id),
        adminClient.from("role_permissions")               .update({ updated_by:   null } as any).eq("updated_by",   user_id),
        adminClient.from("scrutiny_rules")                 .update({ created_by:   null } as any).eq("created_by",   user_id),
        adminClient.from("service_categories")             .update({ created_by:   null } as any).eq("created_by",   user_id),
        adminClient.from("timesheets")                     .update({ user_id:      null } as any).eq("user_id",      user_id),
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
