import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import ExcelJS from "https://esm.sh/exceljs@4.4.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { client_id, financial_year, firm_id } = await req.json();
    if (!client_id || !financial_year) {
      return new Response(JSON.stringify({ error: "Missing client_id or financial_year" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch data
    const [findingsRes, clientRes, firmRes] = await Promise.all([
      supabase.from("scrutiny_findings").select("*").eq("client_id", client_id).eq("financial_year", financial_year),
      supabase.from("clients").select("name").eq("id", client_id).single(),
      firm_id ? supabase.from("firms").select("name").eq("id", firm_id).single() : Promise.resolve({ data: null }),
    ]);

    const findings = findingsRes.data || [];
    const clientName = clientRes.data?.name || "Unknown Client";
    const firmName = firmRes.data?.name || "Unknown Firm";

    const workbook = new ExcelJS.Workbook();

    // --- Helpers ---
    const headerFill: any = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0D1117" } };
    const headerFont: any = { bold: true, color: { argb: "FFFFFFFF" } };
    const highFill: any = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
    const medFill: any = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
    const lowFill: any = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };

    function applyHeaderStyle(row: any) {
      row.eachCell((cell: any) => { cell.fill = headerFill; cell.font = headerFont; });
    }

    function applyRowColor(row: any, severity: string) {
      const fill = severity === "HIGH" ? highFill : severity === "MEDIUM" ? medFill : lowFill;
      row.eachCell((cell: any) => { cell.fill = fill; });
    }

    function autoWidth(sheet: any) {
      sheet.columns.forEach((col: any) => {
        let max = 12;
        col.eachCell?.({ includeEmpty: true }, (cell: any) => {
          const len = cell.value ? String(cell.value).length : 0;
          if (len > max) max = Math.min(len, 60);
        });
        col.width = max + 2;
      });
    }

    // Categorize
    const categories: Record<string, typeof findings> = {};
    for (const f of findings) {
      const cat = f.rule_id?.startsWith("T") ? "TDS" :
                  f.rule_id?.startsWith("C") ? "Cash/Compliance" :
                  f.rule_id?.startsWith("P") ? "Pattern" :
                  f.rule_id?.startsWith("O") ? "Opening Balance" :
                  f.rule_id === "NAR_AI" ? "AI Narration" : "Other";
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(f);
    }

    // --- Sheet 1: Summary ---
    const s1 = workbook.addWorksheet("Summary");
    s1.addRow(["Firm Name", firmName]);
    s1.addRow(["Client Name", clientName]);
    s1.addRow(["Financial Year", financial_year]);
    s1.addRow(["Date Generated", new Date().toISOString().split("T")[0]]);
    s1.addRow([]);

    const summaryHeader = s1.addRow(["Category", "HIGH", "MEDIUM", "LOW", "Total", "Resolved"]);
    applyHeaderStyle(summaryHeader);

    for (const [cat, items] of Object.entries(categories)) {
      const h = items.filter(i => i.severity === "HIGH").length;
      const m = items.filter(i => i.severity === "MEDIUM").length;
      const l = items.filter(i => i.severity === "LOW").length;
      const r = items.filter(i => i.status === "resolved").length;
      s1.addRow([cat, h, m, l, items.length, r]);
    }

    s1.addRow([]);
    s1.addRow(["Total findings", findings.length]);
    s1.addRow(["Total unresolved", findings.filter(f => f.status !== "resolved").length]);
    autoWidth(s1);

    // --- Sheet 2: All Findings ---
    const allCols = ["S.No", "Rule ID", "Category", "Ledger/Narration", "Entry Date", "Amount (Rs)", "Flag Message", "3CD Clause", "Severity", "Status", "Resolution Note"];
    const s2 = workbook.addWorksheet("All Findings");
    const h2 = s2.addRow(allCols);
    applyHeaderStyle(h2);

    findings.forEach((f, idx) => {
      const cat = Object.entries(categories).find(([_, items]) => items.includes(f))?.[0] || "";
      const row = s2.addRow([idx + 1, f.rule_id, cat, f.narration || "", "", "", f.flag_message, f.clause_3cd || "", f.severity, f.status, ""]);
      applyRowColor(row, f.severity || "LOW");
    });
    autoWidth(s2);

    // --- Sheet 3: High Priority ---
    const s3 = workbook.addWorksheet("High Priority");
    const h3 = s3.addRow(allCols);
    applyHeaderStyle(h3);
    let sno = 1;
    for (const f of findings.filter(f => f.severity === "HIGH")) {
      const row = s3.addRow([sno++, f.rule_id, "", f.narration || "", "", "", f.flag_message, f.clause_3cd || "", f.severity, f.status, ""]);
      applyRowColor(row, "HIGH");
    }
    autoWidth(s3);

    // --- Sheet 4: TDS Checks ---
    const tdsCols = [...allCols, "Expected Section", "Expected Rate"];
    const s4 = workbook.addWorksheet("TDS Checks");
    const h4 = s4.addRow(tdsCols);
    applyHeaderStyle(h4);
    sno = 1;
    for (const f of findings.filter(f => f.rule_id?.startsWith("T") || f.rule_id === "NAR_AI")) {
      const secMatch = f.flag_message?.match(/Sec\s+(\S+)/);
      const rateMatch = f.flag_message?.match(/(\d+)%/);
      const row = s4.addRow([sno++, f.rule_id, "TDS", f.narration || "", "", "", f.flag_message, f.clause_3cd || "", f.severity, f.status, "", secMatch?.[1] || "", rateMatch?.[1] || ""]);
      applyRowColor(row, f.severity || "MEDIUM");
    }
    autoWidth(s4);

    // --- Sheet 5: 3CD Auto-fill ---
    const s5 = workbook.addWorksheet("3CD Auto-fill");
    const h5 = s5.addRow(["Clause No", "Clause Topic", "Related Findings", "Details"]);
    applyHeaderStyle(h5);

    const clauseGroups: Record<string, typeof findings> = {};
    for (const f of findings) {
      if (f.clause_3cd) {
        if (!clauseGroups[f.clause_3cd]) clauseGroups[f.clause_3cd] = [];
        clauseGroups[f.clause_3cd].push(f);
      }
    }
    for (const [clause, items] of Object.entries(clauseGroups).sort()) {
      s5.addRow([clause, "", items.length, items.map(i => i.flag_message).join("; ")]);
    }
    autoWidth(s5);

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();
    const uint8 = new Uint8Array(buffer);

    // Upload to storage
    const filename = `scrutiny_${clientName.replace(/\s+/g, "_")}_${financial_year}.xlsx`;
    const storagePath = `exports/${client_id}/${filename}`;

    const { error: uploadErr } = await supabase.storage
      .from("firm-assets")
      .upload(storagePath, uint8, { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", upsert: true });

    if (uploadErr) console.error("Storage upload error:", uploadErr);

    // Save to documents table
    await supabase.from("documents").insert({
      client_id,
      firm_id: firm_id || null,
      filename,
      category: "Audit",
      r2_key: storagePath,
      tags: ["scrutiny", "export", financial_year],
    });

    // Get signed URL
    const { data: signedData } = await supabase.storage
      .from("firm-assets")
      .createSignedUrl(storagePath, 3600);

    return new Response(JSON.stringify({
      url: signedData?.signedUrl || null,
      filename,
      findings_count: findings.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("export-scrutiny-xlsx error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
