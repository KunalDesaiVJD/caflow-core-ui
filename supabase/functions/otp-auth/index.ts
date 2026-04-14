/**
 * otp-auth — Supabase Edge Function
 *
 * Actions:
 *  POST ?action=send-otp   → generate 6-digit OTP, email it, store in otp_requests
 *  POST ?action=verify-otp → verify OTP, reset password (or confirm email change)
 *
 * Email sent via Microsoft Graph API from accounts@vjdesai.com
 * Required secrets: GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, SMTP_SENDER
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Microsoft Graph helpers ──────────────────────────────────────────────────

async function getGraphToken(): Promise<string> {
  const tenantId     = Deno.env.get("GRAPH_TENANT_ID");
  const clientId     = Deno.env.get("GRAPH_CLIENT_ID");
  const clientSecret = Deno.env.get("GRAPH_CLIENT_SECRET");
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Graph API credentials not configured");
  }
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
      }),
    }
  );
  const data = await res.json();
  if (!data.access_token) throw new Error("Failed to get Graph token: " + JSON.stringify(data));
  return data.access_token;
}

async function sendOtpEmail(toEmail: string, userName: string, otp: string, purpose: string): Promise<void> {
  const fromEmail = Deno.env.get("SMTP_SENDER") || "accounts@vjdesai.com";
  const token = await getGraphToken();

  const purposeLabel = purpose === "email_change" ? "Email Change Verification" : "Password Reset";
  const html = buildOtpEmailHtml(userName, otp, purposeLabel);
  const subject = purpose === "email_change"
    ? "CAFlow — Your Email Change OTP"
    : "CAFlow — Your Password Reset OTP";

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${fromEmail}/sendMail`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "HTML", content: html },
          toRecipients: [{ emailAddress: { address: toEmail } }],
        },
        saveToSentItems: false,
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph sendMail failed ${res.status}: ${err.slice(0, 300)}`);
  }
}

// ── OTP Email Template ───────────────────────────────────────────────────────

function buildOtpEmailHtml(userName: string, otp: string, purposeLabel: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CAFlow OTP</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1a3a5c 0%,#2d5a8e 100%);padding:28px 32px;text-align:center;">
              <h1 style="margin:0;color:#c9a84c;font-size:26px;font-weight:700;letter-spacing:1px;">CA<span style="color:#ffffff;">Flow</span></h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.7);font-size:13px;letter-spacing:0.5px;">Practice Management for CA Firms</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px;">
              <h2 style="margin:0 0 8px;color:#1a3a5c;font-size:20px;font-weight:600;">${purposeLabel}</h2>
              <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Hi ${userName || "there"},</p>
              <p style="margin:0 0 28px;color:#374151;font-size:15px;line-height:1.6;">
                We received a request for <strong>${purposeLabel.toLowerCase()}</strong> on your CAFlow account.
                Use the OTP below to proceed. This code is valid for <strong>10 minutes</strong>.
              </p>

              <!-- OTP Box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
                <tr>
                  <td align="center">
                    <div style="display:inline-block;background:#f0f4ff;border:2px dashed #2d5a8e;border-radius:12px;padding:20px 40px;">
                      <p style="margin:0 0 6px;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:2px;font-weight:600;">Your OTP Code</p>
                      <p style="margin:0;color:#1a3a5c;font-size:42px;font-weight:700;letter-spacing:12px;font-family:'Courier New',monospace;">${otp}</p>
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Warning -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                <tr>
                  <td style="background:#fef3c7;border-left:4px solid #f59e0b;border-radius:0 6px 6px 0;padding:12px 16px;">
                    <p style="margin:0;color:#92400e;font-size:13px;">
                      <strong>⚠️ Security Notice:</strong> Never share this OTP with anyone.
                      V J Desai &amp; Co. staff will never ask for your OTP.
                      This code expires in 10 minutes.
                    </p>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;color:#374151;font-size:14px;line-height:1.6;">
                If you did not request this, please ignore this email or contact us immediately at
                <a href="mailto:accounts@vjdesai.com" style="color:#2d5a8e;">accounts@vjdesai.com</a>.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;text-align:center;">
                V J Desai &amp; Co., Chartered Accountants<br>
                This is an automated message from CAFlow. Please do not reply to this email.<br>
                © ${new Date().getFullYear()} CAFlow Practice Management
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl      = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient      = createClient(supabaseUrl, serviceRoleKey);

  const url    = new URL(req.url);
  const action = url.searchParams.get("action");

  const jsonOk  = (b: unknown) => new Response(JSON.stringify(b), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const jsonErr = (msg: string, status = 400) => new Response(JSON.stringify({ error: msg }), { status, headers: corsHeaders });

  try {
    // ── SEND OTP ────────────────────────────────────────────────────────────
    if (req.method === "POST" && action === "send-otp") {
      const body = await req.json();
      const { email, purpose = "password_reset", new_email } = body;

      if (!email) return jsonErr("email required");

      // Look up user by email
      const { data: userRow } = await adminClient
        .from("users")
        .select("id, name, email")
        .eq("email", email)
        .maybeSingle();

      if (!userRow) {
        // Return success anyway to prevent email enumeration
        return jsonOk({ success: true, message: "If that email exists, an OTP has been sent." });
      }

      // Invalidate previous unused OTPs for this email+purpose
      await adminClient
        .from("otp_requests")
        .update({ used_at: new Date().toISOString() })
        .eq("email", email)
        .eq("purpose", purpose)
        .is("used_at", null);

      // Generate 6-digit OTP
      const otp = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

      // Store OTP
      const { error: insertErr } = await adminClient.from("otp_requests").insert({
        email,
        user_id: userRow.id,
        otp_code: otp,
        purpose,
        new_email: new_email || null,
        expires_at: expiresAt,
      });
      if (insertErr) throw insertErr;

      // Send email
      await sendOtpEmail(email, userRow.name || "User", otp, purpose);

      return jsonOk({ success: true, message: "OTP sent to your registered email." });
    }

    // ── VERIFY OTP + RESET PASSWORD ─────────────────────────────────────────
    if (req.method === "POST" && action === "verify-otp") {
      const body = await req.json();
      const { email, otp_code, new_password, purpose = "password_reset" } = body;

      if (!email || !otp_code) return jsonErr("email and otp_code required");

      // Find valid OTP
      const { data: otpRow } = await adminClient
        .from("otp_requests")
        .select("*")
        .eq("email", email)
        .eq("otp_code", otp_code)
        .eq("purpose", purpose)
        .is("used_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!otpRow) {
        return jsonErr("Invalid or expired OTP. Please request a new one.", 401);
      }

      // Mark OTP as used
      await adminClient.from("otp_requests").update({ used_at: new Date().toISOString() }).eq("id", otpRow.id);

      if (purpose === "password_reset") {
        if (!new_password) return jsonErr("new_password required for password reset");
        if (new_password.length < 8) return jsonErr("Password must be at least 8 characters");

        // Reset auth password
        const { error: authErr } = await adminClient.auth.admin.updateUserById(otpRow.user_id, {
          password: new_password,
        });
        if (authErr) throw authErr;

        // Clear must_change_password flag
        await adminClient.from("users").update({ must_change_password: false }).eq("id", otpRow.user_id);

        return jsonOk({ success: true, message: "Password reset successfully. You can now login." });
      }

      if (purpose === "email_change") {
        const newEmail = otpRow.new_email;
        if (!newEmail) return jsonErr("No new email found for this OTP");

        // Update auth email
        const { error: authErr } = await adminClient.auth.admin.updateUserById(otpRow.user_id, {
          email: newEmail,
          email_confirm: true,
        });
        if (authErr) throw authErr;

        // Update public.users
        await adminClient.from("users").update({ email: newEmail }).eq("id", otpRow.user_id);

        return jsonOk({ success: true, message: "Email updated successfully." });
      }

      return jsonErr("Unknown purpose");
    }

    return jsonErr("Unknown action");
  } catch (err: any) {
    console.error("[otp-auth] error:", err);
    return jsonErr(err.message || "Internal server error", 500);
  }
});
