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

    const { engagement_id, report_type = "companies_act", include_comparative = false } = await req.json();
    if (!engagement_id) {
      return new Response(JSON.stringify({ error: "Missing engagement_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // STEP 1 — GATHER ALL DATA
    const { data: engagement } = await supabase
      .from("audit_engagements")
      .select("*")
      .eq("id", engagement_id)
      .single();

    if (!engagement) {
      return new Response(JSON.stringify({ error: "Engagement not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: client } = await supabase
      .from("clients")
      .select("*")
      .eq("id", engagement.client_id)
      .single();

    let comparativeData = null;
    if (include_comparative && engagement.client_id && engagement.financial_year) {
      const { data: snapshots } = await supabase
        .from("trial_balance_snapshots")
        .select("financial_year, normalised_data")
        .eq("client_id", engagement.client_id)
        .order("financial_year", { ascending: false })
        .limit(2);
      if (snapshots && snapshots.length > 0) {
        comparativeData = snapshots;
      }
    }

    const { data: findings } = await supabase
      .from("scrutiny_findings")
      .select("*")
      .eq("client_id", engagement.client_id)
      .eq("severity", "HIGH")
      .limit(3);

    let partner = null;
    if (engagement.partner_id) {
      const { data } = await supabase
        .from("users")
        .select("id, name, icai_reg_no")
        .eq("id", engagement.partner_id)
        .single();
      partner = data;
    }

    let firm = null;
    if (engagement.firm_id) {
      const { data } = await supabase
        .from("firms")
        .select("name, icai_reg_no, settings")
        .eq("id", engagement.firm_id)
        .single();
      firm = data;
    }

    // STEP 2 — CALL CLAUDE FOR REPORT TEXT
    const allData = {
      report_type,
      engagement,
      client,
      comparativeData,
      key_audit_matters: findings || [],
      caro_responses: engagement.caro_responses,
      notes_to_accounts: engagement.notes_to_accounts,
      partner,
      firm,
    };

    const claudeUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/claude-gateway`;
    const claudeRes = await fetch(claudeUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        request_type: "audit_report_drafter",
        user_message: JSON.stringify(allData),
      }),
    });

    const reportSections = await claudeRes.json();
    if (!claudeRes.ok) {
      return new Response(JSON.stringify({ error: "AI drafting failed", details: reportSections }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // STEP 3 — BUILD HTML TEMPLATE
    const entityLabel = client?.entity_type === "company" ? "Members" : "Owner/Partners";
    const clientName = client?.name || "the Entity";
    const fy = engagement.financial_year || "";
    const partnerName = partner?.name || "Partner";
    const partnerICAI = partner?.icai_reg_no || "";
    const firmName = firm?.name || "";
    const firmICAI = firm?.icai_reg_no || "";
    const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });

    const kamHtml = (reportSections.key_audit_matters || [])
      .map((k: { title: string; description: string }) =>
        `<div class="kam"><h4>${k.title}</h4><p>${k.description}</p></div>`
      ).join("");

    let comparativeHtml = "";
    if (include_comparative && comparativeData && comparativeData.length >= 2) {
      comparativeHtml = `
        <div class="section">
          <h3>Comparative Financial Data</h3>
          <p>Refer to the detailed Balance Sheet and Profit & Loss Account annexed herewith showing comparative figures for the current and previous financial years.</p>
        </div>`;
    }

    let caroHtml = "";
    if (report_type === "companies_act" && engagement.caro_applicable && engagement.caro_responses) {
      const caroEntries = typeof engagement.caro_responses === "object"
        ? Object.entries(engagement.caro_responses as Record<string, string>)
        : [];
      const caroRows = caroEntries
        .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`)
        .join("");
      caroHtml = `
        <div class="section page-break">
          <h3>Report on Other Legal and Regulatory Requirements — CARO 2020</h3>
          <table><thead><tr><th>Clause</th><th>Response</th></tr></thead><tbody>${caroRows}</tbody></table>
        </div>`;
    }

    const notesCount = engagement.notes_to_accounts
      ? Object.keys(engagement.notes_to_accounts as Record<string, unknown>).length
      : 0;

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 1in; }
  body { font-family: 'Times New Roman', serif; font-size: 11pt; line-height: 1.6; color: #1a1a1a; }
  .letterhead { display: flex; justify-content: space-between; border-bottom: 2px solid #1a1a1a; padding-bottom: 12px; margin-bottom: 24px; }
  .letterhead-left { font-weight: bold; font-size: 14pt; }
  .letterhead-right { text-align: right; font-size: 9pt; }
  h2 { text-align: center; font-size: 14pt; margin: 24px 0 8px; text-transform: uppercase; letter-spacing: 1px; }
  h3 { font-size: 12pt; margin: 20px 0 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  h4 { font-size: 11pt; margin: 12px 0 4px; }
  .section { margin-bottom: 16px; }
  .kam { background: #f9f9f9; padding: 8px 12px; margin: 8px 0; border-left: 3px solid #333; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; }
  th, td { border: 1px solid #999; padding: 4px 8px; text-align: left; font-size: 10pt; }
  th { background: #eee; }
  .signature { margin-top: 48px; }
  .signature-line { border-top: 1px solid #1a1a1a; width: 250px; margin-top: 48px; padding-top: 4px; }
  .page-break { page-break-before: always; }
  .footer { position: fixed; bottom: 0; width: 100%; text-align: center; font-size: 8pt; color: #999; }
</style></head><body>
  <div class="letterhead">
    <div class="letterhead-left">${firmName}</div>
    <div class="letterhead-right">ICAI Firm Reg. No: ${firmICAI}<br>Chartered Accountants</div>
  </div>

  <h2>Independent Auditor's Report</h2>
  <p><strong>To the ${entityLabel} of ${clientName}</strong></p>

  <div class="section">
    <h3>Report on the Audit of Financial Statements</h3>
    <h4>Opinion</h4>
    <p>${reportSections.opinion_paragraph || "We have audited the accompanying financial statements..."}</p>
  </div>

  <div class="section">
    <h4>Basis for Opinion</h4>
    <p>${reportSections.basis_for_opinion || "We conducted our audit in accordance with Standards on Auditing..."}</p>
  </div>

  ${kamHtml ? `<div class="section"><h3>Key Audit Matters</h3>${kamHtml}</div>` : ""}

  <div class="section">
    <h4>Responsibilities of Management for the Financial Statements</h4>
    <p>${reportSections.management_responsibility || ""}</p>
  </div>

  <div class="section">
    <h4>Auditor's Responsibilities for the Audit of the Financial Statements</h4>
    <p>${reportSections.auditor_responsibility || ""}</p>
  </div>

  ${caroHtml}
  ${comparativeHtml}

  ${notesCount > 0 ? `<p><em>See accompanying Notes 1 to ${notesCount} forming part of the financial statements.</em></p>` : ""}

  <div class="signature">
    <p>For <strong>${firmName}</strong><br>Chartered Accountants<br>Firm Registration No: ${firmICAI}</p>
    <div class="signature-line">
      <strong>${partnerName}</strong><br>
      Partner<br>
      ICAI Membership No: ${partnerICAI}<br>
      Date: ${today}<br>
      Place: _____________
    </div>
  </div>
</body></html>`;

    // STEP 4 — For now, store the HTML as the report artifact
    // (Puppeteer PDF rendering would require a separate service; storing HTML for client-side rendering)

    // STEP 5 — UPLOAD to storage and save metadata
    const fy_clean = fy.replace(/[^a-zA-Z0-9-]/g, "_");
    const basePath = `firms/${engagement.firm_id}/clients/${engagement.client_id}/${fy_clean}/audit/${engagement_id}/reports/draft`;

    // Get current version
    const { count: existingCount } = await supabase
      .from("documents")
      .select("*", { count: "exact", head: true })
      .eq("engagement_id", engagement_id)
      .eq("sub_category", "draft");

    const version = (existingCount || 0) + 1;
    const filename = `audit_report_v${version}.html`;
    const r2Key = `${basePath}/${filename}`;

    // Upload HTML to storage
    const htmlBlob = new Blob([html], { type: "text/html" });
    await supabase.storage.from("firm-assets").upload(r2Key, htmlBlob, {
      contentType: "text/html",
      upsert: false,
    });

    const { data: urlData } = await supabase.storage
      .from("firm-assets")
      .createSignedUrl(r2Key, 3600);

    // Save metadata to documents table
    await supabase.from("documents").insert({
      firm_id: engagement.firm_id,
      client_id: engagement.client_id,
      engagement_id,
      filename,
      category: "audit_report",
      sub_category: "draft",
      r2_key: r2Key,
      tags: ["audit", "report", `v${version}`, report_type],
    });

    return new Response(
      JSON.stringify({
        signed_url: urlData?.signedUrl || null,
        version_number: version,
        report_sections: reportSections,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("generate-audit-report error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
