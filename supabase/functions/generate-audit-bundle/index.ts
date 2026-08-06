import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function formatIndian(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

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

    const { engagement_id } = await req.json();
    if (!engagement_id) {
      return new Response(JSON.stringify({ error: "Missing engagement_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── GATHER ALL DATA ──────────────────────────────────────────────

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

    const clientId = engagement.client_id;
    const firmId = engagement.firm_id;
    const fy = engagement.financial_year || "";

    // ── FIRM OWNERSHIP CHECK ─────────────────────────────────────────
    const { data: dbUser } = await supabase
      .from("users")
      .select("firm_id, role")
      .eq("id", user.id)
      .single();

    const isSuper = dbUser?.role === "superadmin";
    if (!isSuper && (!dbUser?.firm_id || String(firmId) !== String(dbUser.firm_id))) {
      return new Response(
        JSON.stringify({ error: "Forbidden: engagement is not in your firm" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parallel data fetches
    const [
      { data: client },
      { data: firm },
      { data: partner },
      { data: manager },
      { data: snapshots },
      { data: findings },
      { data: tdsEntries },
      { data: workpapers },
      { data: relatedParties },
      { data: existingDocs },
    ] = await Promise.all([
      supabase.from("clients").select("*").eq("id", clientId).single(),
      firmId
        ? supabase.from("firms").select("name, icai_reg_no, settings").eq("id", firmId).single()
        : Promise.resolve({ data: null }),
      engagement.partner_id
        ? supabase.from("users").select("id, name, icai_reg_no").eq("id", engagement.partner_id).single()
        : Promise.resolve({ data: null }),
      engagement.manager_id
        ? supabase.from("users").select("id, name").eq("id", engagement.manager_id).single()
        : Promise.resolve({ data: null }),
      supabase
        .from("trial_balance_snapshots")
        .select("financial_year, normalised_data")
        .eq("client_id", clientId)
        .order("financial_year", { ascending: false })
        .limit(2),
      supabase
        .from("scrutiny_findings")
        .select("*")
        .eq("client_id", clientId),
      supabase
        .from("tds_entries")
        .select("*")
        .eq("client_id", clientId),
      supabase
        .from("audit_workpapers")
        .select("*")
        .eq("engagement_id", engagement_id),
      supabase
        .from("related_parties")
        .select("*")
        .eq("client_id", clientId),
      supabase
        .from("documents")
        .select("*", { count: "exact", head: true })
        .eq("engagement_id", engagement_id)
        .eq("sub_category", "final_bundle")
        .is("deleted_at", null),
    ]);

    const clientName = client?.name || "the Entity";
    const firmName = firm?.name || "";
    const firmICAI = firm?.icai_reg_no || "";
    const partnerName = partner?.name || "Partner";
    const partnerICAI = partner?.icai_reg_no || "";
    const managerName = manager?.name || "";
    const entityLabel = client?.entity_type === "company" ? "Members" : "Owner/Partners";
    const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
    const nowISO = new Date().toISOString();

    // Parse trial balance data
    const cySnapshot = snapshots?.[0];
    const pySnapshot = snapshots?.[1];
    const cyData: Array<{ account_name: string; debit: number; credit: number; balance: number }> =
      Array.isArray(cySnapshot?.normalised_data) ? cySnapshot.normalised_data as any : [];
    const pyData: Array<{ account_name: string; debit: number; credit: number; balance: number }> =
      Array.isArray(pySnapshot?.normalised_data) ? pySnapshot.normalised_data as any : [];

    const pyMap = new Map(pyData.map((r) => [r.account_name, r]));

    // ── CALL CLAUDE FOR REPORT SECTIONS ──────────────────────────────

    const claudeUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/claude-gateway`;
    let reportSections: any = {};
    try {
      const claudeRes = await fetch(claudeUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          request_type: "audit_report_drafter",
          user_message: JSON.stringify({
            report_type: "companies_act",
            engagement,
            client,
            key_audit_matters: (findings || []).filter((f: any) => f.severity === "HIGH").slice(0, 3),
            caro_responses: engagement.caro_responses,
            notes_to_accounts: engagement.notes_to_accounts,
            partner,
            firm,
          }),
        }),
      });
      if (claudeRes.ok) {
        reportSections = await claudeRes.json();
      }
    } catch (e) {
      console.error("Claude call failed, continuing with defaults:", e);
    }

    // ── PART A: COMPREHENSIVE PDF (HTML) ─────────────────────────────

    // Build comparative tables
    function buildComparativeTable(title: string, filterFn: (name: string) => boolean): string {
      const rows = cyData.filter((r) => filterFn(r.account_name));
      if (rows.length === 0) return "";
      let tableRows = "";
      let cyTotal = 0, pyTotal = 0;
      for (const row of rows) {
        const pyRow = pyMap.get(row.account_name);
        const cyAmt = row.balance || 0;
        const pyAmt = pyRow?.balance || 0;
        const change = pyAmt !== 0 ? (((cyAmt - pyAmt) / Math.abs(pyAmt)) * 100) : 0;
        cyTotal += cyAmt;
        pyTotal += pyAmt;
        tableRows += `<tr>
          <td>${esc(row.account_name)}</td>
          <td class="num">${formatIndian(cyAmt)}</td>
          <td class="num">${formatIndian(pyAmt)}</td>
          <td class="num ${Math.abs(change) > 50 ? "highlight" : ""}">${change.toFixed(1)}%</td>
        </tr>`;
      }
      const totalChange = pyTotal !== 0 ? (((cyTotal - pyTotal) / Math.abs(pyTotal)) * 100) : 0;
      tableRows += `<tr class="total-row">
        <td><strong>Total</strong></td>
        <td class="num"><strong>${formatIndian(cyTotal)}</strong></td>
        <td class="num"><strong>${formatIndian(pyTotal)}</strong></td>
        <td class="num"><strong>${totalChange.toFixed(1)}%</strong></td>
      </tr>`;
      return `<div class="section"><h3>${title}</h3>
        <table><thead><tr><th>Particular</th><th>CY (${esc(cySnapshot?.financial_year || fy)})</th><th>PY (${esc(pySnapshot?.financial_year || "Previous Year")})</th><th>Change %</th></tr></thead>
        <tbody>${tableRows}</tbody></table></div>`;
    }

    // Simple classification based on account name keywords
    const bsKeywords = ["asset", "liability", "equity", "capital", "reserve", "loan", "bank", "cash", "fixed", "current", "property", "plant", "investment", "receivable", "payable", "provision", "deposit", "advance"];
    const plKeywords = ["revenue", "income", "sale", "expense", "cost", "purchase", "salary", "rent", "depreciation", "interest", "tax", "profit", "loss", "commission", "discount", "fee", "repair", "insurance", "travelling"];

    const bsHtml = buildComparativeTable("Balance Sheet", (name) =>
      bsKeywords.some((k) => name.toLowerCase().includes(k))
    );
    const plHtml = buildComparativeTable("Statement of Profit and Loss", (name) =>
      plKeywords.some((k) => name.toLowerCase().includes(k))
    );

    // Cash Flow Statement (simplified indirect method)
    const cashFlowHtml = `<div class="section page-break">
      <h3>Cash Flow Statement (Indirect Method)</h3>
      <table>
        <thead><tr><th>Particular</th><th>Amount</th></tr></thead>
        <tbody>
          <tr><td colspan="2"><strong>A. Cash Flow from Operating Activities</strong></td></tr>
          <tr><td>Net Profit before Tax</td><td class="num">As per P&L</td></tr>
          <tr><td>Adjustments for non-cash items</td><td class="num">—</td></tr>
          <tr><td colspan="2"><strong>B. Cash Flow from Investing Activities</strong></td></tr>
          <tr><td>Purchase/Sale of Fixed Assets</td><td class="num">—</td></tr>
          <tr><td colspan="2"><strong>C. Cash Flow from Financing Activities</strong></td></tr>
          <tr><td>Loans taken / repaid</td><td class="num">—</td></tr>
          <tr class="total-row"><td><strong>Net Change in Cash</strong></td><td class="num"><strong>—</strong></td></tr>
        </tbody>
      </table>
      <p class="note-text"><em>Note: Cash flow statement to be completed based on detailed ledger analysis.</em></p>
    </div>`;

    // Notes to Accounts section
    const notes = engagement.notes_to_accounts as Record<string, any> | null;
    const noteKeys = notes ? Object.keys(notes).sort((a, b) => Number(a) - Number(b)) : [];
    let notesHtml = "";
    if (noteKeys.length > 0) {
      let noteRows = "";
      for (const key of noteKeys) {
        const note = notes![key];
        const title = note?.title || `Note ${key}`;
        const content = note?.content || note?.narrative || "";
        noteRows += `<div class="note-item">
          <h4>Note ${key}: ${esc(title)}</h4>
          <p>${esc(content)}</p>
        </div>`;
      }
      notesHtml = `<div class="section page-break"><h3>Notes to the Financial Statements</h3>${noteRows}</div>`;
    }

    // CARO section
    let caroHtml = "";
    if (engagement.caro_applicable && engagement.caro_responses) {
      const caroEntries = Object.entries(engagement.caro_responses as Record<string, string>);
      const caroRows = caroEntries
        .map(([k, v]) => `<tr><td style="width:80px;white-space:nowrap">${esc(k)}</td><td>${esc(v)}</td></tr>`)
        .join("");
      caroHtml = `<div class="section page-break">
        <h3>Report on Other Legal and Regulatory Requirements — CARO 2020</h3>
        <p>As required by the Companies (Auditor's Report) Order, 2020 ("the Order"), we report that:</p>
        <table><thead><tr><th>Clause</th><th>Report</th></tr></thead><tbody>${caroRows}</tbody></table>
      </div>`;
    }

    // KAMs
    const highFindings = (findings || []).filter((f: any) => f.severity === "HIGH").slice(0, 3);
    const kamHtml = highFindings.length > 0
      ? `<div class="section"><h3>Key Audit Matters</h3>${highFindings.map((f: any) =>
          `<div class="kam"><h4>${esc(f.flag_message || f.rule_id)}</h4><p>${esc(f.narration || "")}</p></div>`
        ).join("")}</div>`
      : "";

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 1in; }
  body { font-family: 'Times New Roman', serif; font-size: 11pt; line-height: 1.6; color: #1a1a1a; margin: 0; padding: 0; }
  .cover { text-align: center; padding: 120px 40px; page-break-after: always; }
  .cover h1 { font-family: Arial, sans-serif; font-size: 22pt; text-transform: uppercase; letter-spacing: 2px; margin: 24px 0; }
  .cover .firm-name { font-family: Arial, sans-serif; font-size: 16pt; color: #333; margin-bottom: 60px; }
  .cover .client-name { font-size: 18pt; font-weight: bold; margin: 16px 0; }
  .cover .fy { font-size: 14pt; color: #555; }
  .letterhead { display: flex; justify-content: space-between; border-bottom: 2px solid #1a1a1a; padding-bottom: 12px; margin-bottom: 24px; }
  .letterhead-left { font-weight: bold; font-size: 14pt; }
  .letterhead-right { text-align: right; font-size: 9pt; }
  h2 { font-family: Arial, sans-serif; text-align: center; font-size: 14pt; margin: 24px 0 8px; text-transform: uppercase; letter-spacing: 1px; }
  h3 { font-family: Arial, sans-serif; font-size: 12pt; margin: 20px 0 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  h4 { font-family: Arial, sans-serif; font-size: 11pt; margin: 12px 0 4px; }
  .section { margin-bottom: 16px; }
  .kam { background: #f9f9f9; padding: 8px 12px; margin: 8px 0; border-left: 3px solid #333; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; }
  th, td { border: 1px solid #999; padding: 4px 8px; text-align: left; font-size: 10pt; }
  th { background: #eee; font-family: Arial, sans-serif; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .highlight { color: #c00; font-weight: bold; }
  .total-row td { border-top: 2px solid #333; background: #f5f5f5; }
  .signature { margin-top: 48px; }
  .signature-line { border-top: 1px solid #1a1a1a; width: 250px; margin-top: 48px; padding-top: 4px; }
  .page-break { page-break-before: always; }
  .note-item { margin-bottom: 12px; }
  .note-text { font-size: 9pt; color: #666; }
  @media print { .footer { position: fixed; bottom: 0; width: 100%; text-align: center; font-size: 8pt; color: #999; } }
</style></head><body>

<!-- SECTION 1: Cover Page -->
<div class="cover">
  <div class="firm-name">${esc(firmName)}</div>
  <p>Chartered Accountants | ICAI Reg: ${esc(firmICAI)}</p>
  <hr style="margin:40px auto;width:60%">
  <h1>Audit Report and Financial Statements</h1>
  <div class="client-name">${esc(clientName)}</div>
  <div class="fy">For the year ended ${esc(fy)}</div>
  <p style="margin-top:60px;font-size:10pt;color:#777">Prepared by ${esc(firmName)}</p>
</div>

<!-- SECTION 2: Independent Auditor's Report -->
<div class="letterhead">
  <div class="letterhead-left">${esc(firmName)}</div>
  <div class="letterhead-right">ICAI Firm Reg. No: ${esc(firmICAI)}<br>Chartered Accountants</div>
</div>

<h2>Independent Auditor's Report</h2>
<p><strong>To the ${entityLabel} of ${esc(clientName)}</strong></p>

<div class="section">
  <h3>Report on the Audit of Financial Statements</h3>
  <h4>Opinion</h4>
  <p>${reportSections.opinion_paragraph || "We have audited the accompanying financial statements..."}</p>
</div>
<div class="section">
  <h4>Basis for Opinion</h4>
  <p>${reportSections.basis_for_opinion || "We conducted our audit in accordance with Standards on Auditing..."}</p>
</div>
${kamHtml}
<div class="section">
  <h4>Responsibilities of Management</h4>
  <p>${reportSections.management_responsibility || ""}</p>
</div>
<div class="section">
  <h4>Auditor's Responsibilities</h4>
  <p>${reportSections.auditor_responsibility || ""}</p>
</div>

<!-- SECTION 3: Balance Sheet -->
<div class="page-break"></div>
${bsHtml || '<div class="section"><h3>Balance Sheet</h3><p class="note-text"><em>No trial balance data available for comparative presentation.</em></p></div>'}

<!-- SECTION 4: Statement of Profit and Loss -->
${plHtml || '<div class="section"><h3>Statement of Profit and Loss</h3><p class="note-text"><em>No trial balance data available for comparative presentation.</em></p></div>'}

<!-- SECTION 5: Cash Flow Statement -->
${cashFlowHtml}

<!-- SECTION 6: Notes to Accounts -->
${notesHtml || '<div class="section page-break"><h3>Notes to the Financial Statements</h3><p class="note-text"><em>Notes are being finalized.</em></p></div>'}

<!-- SECTION 7: CARO 2020 -->
${caroHtml}

${noteKeys.length > 0 ? `<p><em>See accompanying Notes 1 to ${noteKeys.length} forming part of the financial statements.</em></p>` : ""}

<div class="signature">
  <p>For <strong>${esc(firmName)}</strong><br>Chartered Accountants<br>Firm Registration No: ${esc(firmICAI)}</p>
  <div class="signature-line">
    <strong>${esc(partnerName)}</strong><br>
    Partner<br>
    ICAI Membership No: ${esc(partnerICAI)}<br>
    Date: ${today}<br>
    Place: _____________
  </div>
</div>
<div class="footer">Generated on ${nowISO} | Page <span class="pagenum"></span></div>
</body></html>`;

    // ── PART B: XLSX WORKPAPER MASTER (as JSON/CSV structured data) ──

    // Since ExcelJS isn't available in Deno edge functions, we build a structured
    // JSON that the frontend can convert to XLSX using the already-installed xlsx package
    const riskAssessment = Array.isArray(engagement.risk_assessment) ? engagement.risk_assessment : [];
    const auditProgramme = Array.isArray(engagement.audit_programme) ? engagement.audit_programme : [];
    const caroResponses = engagement.caro_responses as Record<string, string> | null;
    const notesData = engagement.notes_to_accounts as Record<string, any> | null;

    const xlsxSheets: Record<string, any[]> = {
      "Engagement Summary": [
        { Field: "Client", Value: clientName },
        { Field: "Financial Year", Value: fy },
        { Field: "Audit Type", Value: engagement.audit_type || "Statutory" },
        { Field: "Status", Value: engagement.status || "Planning" },
        { Field: "Partner", Value: partnerName },
        { Field: "Manager", Value: managerName },
        { Field: "Risk Rating", Value: engagement.risk_rating || "Medium" },
        { Field: "Planned Start", Value: engagement.planned_start || "" },
        { Field: "Planned End", Value: engagement.planned_end || "" },
        { Field: "CARO Applicable", Value: engagement.caro_applicable ? "Yes" : "No" },
        { Field: "Materiality", Value: JSON.stringify(engagement.materiality || {}) },
        { Field: "Signed At", Value: engagement.signed_at || "" },
      ],
      "Risk Assessment": riskAssessment.map((r: any, i: number) => ({
        "Sr.": i + 1,
        Area: r.area || "",
        Rating: r.rating || "",
        Response: r.response || "",
        "Inherent Risk": r.inherent_risk || "",
        "Control Risk": r.control_risk || "",
      })),
      "Audit Programme": auditProgramme.map((p: any, i: number) => ({
        "Sr.": i + 1,
        Section: p.section || "",
        Procedure: p.procedure || "",
        "Assigned To": p.assigned_to_name || p.assigned_to || "",
        Status: p.status || "pending",
        "Due Date": p.due_date || "",
      })),
      "Trial Balance": cyData.map((r) => {
        const py = pyMap.get(r.account_name);
        const variance = py ? r.balance - py.balance : 0;
        return {
          Account: r.account_name,
          "CY Debit": r.debit || 0,
          "CY Credit": r.credit || 0,
          "CY Balance": r.balance || 0,
          "PY Balance": py?.balance || 0,
          Variance: variance,
          "Variance %": py?.balance ? ((variance / Math.abs(py.balance)) * 100).toFixed(1) + "%" : "N/A",
        };
      }),
      "Scrutiny Findings": (findings || []).map((f: any, i: number) => ({
        "Sr.": i + 1,
        "Rule ID": f.rule_id || "",
        Severity: f.severity || "",
        Status: f.status || "",
        "Flag Message": f.flag_message || "",
        Narration: f.narration || "",
        "Clause 3CD": f.clause_3cd || "",
        FY: f.financial_year || "",
      })),
      "CARO Checklist": caroResponses
        ? Object.entries(caroResponses).map(([k, v]) => ({ Clause: k, Answer: v }))
        : [{ Clause: "N/A", Answer: "CARO not applicable" }],
      "Notes Working": notesData
        ? Object.entries(notesData).map(([k, v]: [string, any]) => ({
            "Note No.": k,
            Title: v?.title || "",
            Status: v?.status || "empty",
            Content: v?.content || v?.narrative || "",
          }))
        : [{ "Note No.": "—", Title: "No notes drafted", Status: "", Content: "" }],
      "TDS Compliance": (tdsEntries || []).map((t: any) => ({
        Section: t.section || "",
        "Party Name": t.party_name || "",
        Amount: t.amount || 0,
        "TDS Amount": t.tds_amount || 0,
        "TDS Rate": t.tds_rate || 0,
        "Due Date": t.due_date || "",
        Status: t.status || "",
        "Challan No": t.challan_no || "",
      })),
      "GST Summary": [
        { Item: "GST compliance data", Note: "To be populated from GST module when available" },
      ],
      "Depreciation Schedule": [
        { Item: "Depreciation schedule", Note: "To be populated from fixed assets module when available" },
      ],
      "Loan Schedules": (relatedParties || [])
        .filter((rp: any) => (rp.transaction_types || []).some((t: string) => t.toLowerCase().includes("loan")))
        .map((rp: any) => ({
          "Party Name": rp.party_name || "",
          Relationship: rp.relationship || "",
          PAN: rp.pan || "",
          "Is Director": rp.is_director ? "Yes" : "No",
        })),
      "Sign-off Checklist": [
        { Item: "Trial Balance Imported", Status: cyData.length > 0 ? "✓" : "✗" },
        { Item: "HIGH Findings Resolved", Status: (findings || []).filter((f: any) => f.severity === "HIGH" && f.status === "open").length === 0 ? "✓" : "✗" },
        { Item: "Risk Assessment Complete", Status: riskAssessment.length >= 8 ? "✓" : "✗" },
        { Item: "Workpapers Signed Off", Status: (workpapers || []).every((w: any) => w.conclusion) ? "✓" : "✗" },
        { Item: "CARO Complete", Status: !engagement.caro_applicable || (caroResponses && Object.keys(caroResponses).length >= 21) ? "✓" : "✗" },
        { Item: "Notes Drafted", Status: noteKeys.length >= 10 ? "✓" : "✗" },
        { Item: "Signed By", Status: engagement.signed_by || "Pending" },
        { Item: "Signed At", Status: engagement.signed_at || "Pending" },
      ],
    };

    // ── UPLOAD BOTH FILES ──────────────────────────────────────────

    const fySafe = fy.replace(/[^a-zA-Z0-9-]/g, "_");
    const basePath = `firms/${firmId}/clients/${clientId}/${fySafe}/audit/${engagement_id}/reports/final`;

    // Upload PDF (HTML)
    const pdfFilename = `audit_report_FINAL_${fySafe}.html`;
    const pdfKey = `${basePath}/${pdfFilename}`;
    const htmlBlob = new Blob([html], { type: "text/html" });
    await supabase.storage.from("firm-assets").upload(pdfKey, htmlBlob, {
      contentType: "text/html",
      upsert: true,
    });

    // Upload XLSX data as JSON (frontend converts using xlsx library)
    const xlsxFilename = `workpaper_master_${fySafe}.json`;
    const xlsxKey = `${basePath}/${xlsxFilename}`;
    const xlsxBlob = new Blob([JSON.stringify(xlsxSheets)], { type: "application/json" });
    await supabase.storage.from("firm-assets").upload(xlsxKey, xlsxBlob, {
      contentType: "application/json",
      upsert: true,
    });

    // Create signed URLs
    const [{ data: pdfUrl }, { data: xlsxUrl }] = await Promise.all([
      supabase.storage.from("firm-assets").createSignedUrl(pdfKey, 3600),
      supabase.storage.from("firm-assets").createSignedUrl(xlsxKey, 3600),
    ]);

    // Save to documents table
    await Promise.all([
      supabase.from("documents").insert({
        firm_id: firmId,
        client_id: clientId,
        engagement_id,
        filename: pdfFilename,
        category: "audit_report",
        sub_category: "final_bundle",
        r2_key: pdfKey,
        is_final: true,
        tags: ["audit", "report", "final", "bundle"],
      }),
      supabase.from("documents").insert({
        firm_id: firmId,
        client_id: clientId,
        engagement_id,
        filename: xlsxFilename,
        category: "audit_report",
        sub_category: "final_bundle",
        r2_key: xlsxKey,
        is_final: true,
        tags: ["audit", "workpaper", "xlsx", "bundle"],
      }),
    ]);

    return new Response(
      JSON.stringify({
        pdf_url: pdfUrl?.signedUrl || null,
        xlsx_url: xlsxUrl?.signedUrl || null,
        xlsx_sheets: xlsxSheets,
        pdf_key: pdfKey,
        xlsx_key: xlsxKey,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("generate-audit-bundle error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
