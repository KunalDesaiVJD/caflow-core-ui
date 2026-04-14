/**
 * export_tax_audit  (v4 — ZIP-based, full style preservation)
 *
 * Reads the xlsx template as a raw ZIP, writes cell values directly into the
 * sheet XML files, and returns the re-zipped file.  styles.xml / sharedStrings /
 * images / etc. are NEVER touched, so the exported file looks exactly like the
 * v3 template with the engagement data filled in.
 *
 * POST body: { engagement_id: string, form_type: '3CA-3CD' | '3CB-3CD' }
 * GET  params: engagement_id, form_type, token
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import * as fflate from "https://esm.sh/fflate@0.8.2";
import { buildClauseValues } from "./clause_mapper.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version",
};

const BUCKET = "tax_audit_templates";
const TEMPLATE_PATHS: Record<string, string> = {
  "3CA-3CD": "v3/3ca_3cd.xlsx",
  "3CB-3CD": "v3/3cb_3cd.xlsx",
};

// ── General helpers ───────────────────────────────────────────────────────────

function fyToRange(fy: string): { prev: string; ay: string; bsDate: string } {
  const m = fy.match(/(\d{4})/g);
  if (!m || m.length < 1) return { prev: fy, ay: "", bsDate: "" };
  const startYear = parseInt(m[0]);
  const endYear = startYear + 1;
  return {
    prev: `01/04/${startYear} to 31/03/${endYear}`,
    ay: `${endYear}-${String(endYear + 1).slice(2)}`,
    bsDate: `31/03/${endYear}`,
  };
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return d;
  }
}

// ── ZIP / XML helpers ─────────────────────────────────────────────────────────

const _dec = new TextDecoder("utf-8");
const _enc = new TextEncoder();

/**
 * Parse xl/workbook.xml + xl/_rels/workbook.xml.rels to build a map of
 * sheet-name → path-inside-zip  (e.g. "Form_3CD" → "xl/worksheets/sheet3.xml")
 */
function resolveSheetPaths(zip: Record<string, Uint8Array>): Map<string, string> {
  const result = new Map<string, string>();
  const wbBuf = zip["xl/workbook.xml"];
  const relsBuf = zip["xl/_rels/workbook.xml.rels"];
  if (!wbBuf || !relsBuf) return result;

  const wbXml   = _dec.decode(wbBuf);
  const relsXml = _dec.decode(relsBuf);

  // rId → target file (relative to xl/)
  const ridToTarget = new Map<string, string>();
  const relRe = /<Relationship\s[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g;
  let rm: RegExpExecArray | null;
  while ((rm = relRe.exec(relsXml)) !== null) {
    ridToTarget.set(rm[1], rm[2]);
  }

  // <sheet name="..." sheetId="..." r:id="rId1"/>
  const sheetRe = /<sheet\b([^>]+?)\/>/g;
  let sm: RegExpExecArray | null;
  while ((sm = sheetRe.exec(wbXml)) !== null) {
    const attrs    = sm[1];
    const nameM    = attrs.match(/\bname="([^"]+)"/);
    const ridM     = attrs.match(/\br:id="([^"]+)"/);
    if (!nameM || !ridM) continue;
    const target = ridToTarget.get(ridM[1]);
    if (!target) continue;
    // target is relative to xl/ — could be "worksheets/sheet1.xml" or "../xl/..."
    const path = target.startsWith("/")
      ? target.slice(1)
      : `xl/${target.replace(/^\.\//, "")}`;
    result.set(nameM[1], path);
  }
  return result;
}

/** Escape a plain string for embedding inside an XML element. */
function xmlEsc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Replace a single cell's content in raw sheet XML with an inline string value,
 * preserving the cell's existing `s` (style) attribute so all formatting stays.
 *
 * Handles: <c r="ADDR" s="N" t="s">...</c>
 *          <c r="ADDR" s="N"/>   (self-closing)
 *          <c r="ADDR">...</c>   (no style)
 */
function setCellInXml(xml: string, addr: string, value: string): string {
  if (value === "" || value == null) return xml;
  const esc     = xmlEsc(value);
  const addrRe  = addr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // ── Self-closing variant ──────────────────────────────────────────────────
  const selfRe = new RegExp(`<c(\\s[^>]*)\\br="${addrRe}"([^>]*?)/>`);
  const selfM  = selfRe.exec(xml);
  if (selfM) {
    const allA = selfM[1] + selfM[2];
    const sM   = allA.match(/\bs="(\d+)"/);
    const sA   = sM ? ` s="${sM[1]}"` : "";
    return (
      xml.slice(0, selfM.index) +
      `<c r="${addr}"${sA} t="inlineStr"><is><t>${esc}</t></is></c>` +
      xml.slice(selfM.index + selfM[0].length)
    );
  }

  // ── Full element variant ──────────────────────────────────────────────────
  const openRe = new RegExp(`<c(\\s[^>]*)\\br="${addrRe}"([^>]*?)>`);
  const openM  = openRe.exec(xml);
  if (!openM) return xml; // cell not in this sheet — silently skip

  const allA = openM[1] + openM[2];
  const sM   = allA.match(/\bs="(\d+)"/);
  const sA   = sM ? ` s="${sM[1]}"` : "";

  const closeIdx = xml.indexOf("</c>", openM.index + openM[0].length);
  if (closeIdx === -1) return xml;

  return (
    xml.slice(0, openM.index) +
    `<c r="${addr}"${sA} t="inlineStr"><is><t>${esc}</t></is></c>` +
    xml.slice(closeIdx + 4)
  );
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // ── Auth — Bearer header (POST) or ?token= query param (GET) ─────────────
    const reqUrl     = new URL(req.url);
    const authHeader = req.headers.get("Authorization") ?? "";
    const token      =
      authHeader.replace("Bearer ", "").trim() ||
      (reqUrl.searchParams.get("token") ?? "");

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

    // ── Input ─────────────────────────────────────────────────────────────────
    let engagement_id: string;
    let form_type: string;
    if (req.method === "GET") {
      engagement_id = reqUrl.searchParams.get("engagement_id") ?? "";
      form_type     = reqUrl.searchParams.get("form_type") ?? "";
    } else {
      const body    = await req.json() as { engagement_id: string; form_type: string };
      engagement_id = body.engagement_id;
      form_type     = body.form_type;
    }

    if (!engagement_id || !form_type) {
      return new Response(
        JSON.stringify({ error: "Missing engagement_id or form_type" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const templatePath = TEMPLATE_PATHS[form_type];
    if (!templatePath) {
      return new Response(
        JSON.stringify({ error: `Unknown form_type: ${form_type}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Load engagement + client ──────────────────────────────────────────────
    const { data: eng, error: engErr } = await supabase
      .from("audit_engagements")
      .select("*, clients(*)")
      .eq("id", engagement_id)
      .single();

    if (engErr || !eng) {
      return new Response(JSON.stringify({ error: "Engagement not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const client = (eng as any).clients ?? {};
    const fy     = (eng as any).financial_year ?? "";

    // ── Load audit_firm ───────────────────────────────────────────────────────
    let firm: Record<string, any> = {};
    const auditFirmId = (eng as any).audit_firm_id;
    if (auditFirmId) {
      const { data: af } = await supabase
        .from("audit_firms")
        .select("name, icai_reg_no, city, partner_name, partner_icai_no")
        .eq("id", auditFirmId)
        .single();
      if (af) firm = af as Record<string, any>;
    }

    const { prev, ay, bsDate } = fyToRange(fy);

    // ── Load form_3ca_3cb (UDIN / dates) ─────────────────────────────────────
    const tab = form_type.startsWith("3CA") ? "3ca" : "3cb";
    const { data: form3 } = await supabase
      .from("form_3ca_3cb" as any)
      .select("udin, audit_report_date, signature_date")
      .eq("engagement_id", engagement_id)
      .eq("tab", tab)
      .maybeSingle();

    const udin       = (form3 as any)?.udin ?? "";
    const reportDate = formatDate((form3 as any)?.audit_report_date);
    const signDate   = formatDate((form3 as any)?.signature_date);

    // ── Build auto-value map ──────────────────────────────────────────────────
    const gstin   = Array.isArray(client.gstin) ? client.gstin[0] ?? "" : (client.gstin ?? "");
    const address = client.address || client.registered_office || "";

    const autoValues: Record<string, string> = {
      ENTITY_NAME:    client.name ?? "",
      ENTITY_ADDRESS: address,
      PAN:            client.pan ?? "",
      TAN:            client.tan ?? "",
      GSTIN:          gstin,
      ENTITY_TYPE:    client.entity_type ?? "",
      BUSINESS_NATURE: client.nature_of_business ?? client.business_nature ?? "",
      PREVIOUS_YEAR:  prev,
      ASSESSMENT_YEAR: ay,
      BS_DATE:        bsDate,
      COMP_YEAR_END:  bsDate,
      FIRM_NAME:      firm.name ?? "",
      PARTNER_NAME:   firm.partner_name ?? "",
      FRN:            firm.icai_reg_no ?? "",
      MEMBERSHIP_NO:  firm.partner_icai_no ?? "",
      UDIN:           udin,
      REPORT_DATE:    reportDate,
      PLACE:          firm.city ?? "",
      SIGN_DATE:      signDate,
    };

    // ── Merge user-saved overrides ────────────────────────────────────────────
    const { data: savedValues } = await supabase
      .from("tax_audit_values")
      .select("field_key, current_value")
      .eq("engagement_id", engagement_id);

    for (const row of savedValues ?? []) {
      if (row.current_value != null && row.current_value !== "") {
        autoValues[row.field_key] = row.current_value;
      }
    }

    // ── Load cell_map ─────────────────────────────────────────────────────────
    const { data: cellMapRows } = await supabase
      .from("tax_audit_cell_map")
      .select("field_key, sheet, cell_address, formula_cell")
      .eq("template_name", form_type);

    // ── Load template from storage ────────────────────────────────────────────
    const { data: fileData, error: fileErr } = await supabase.storage
      .from(BUCKET)
      .download(templatePath);

    if (fileErr || !fileData) {
      return new Response(
        JSON.stringify({ error: `Template download failed: ${fileErr?.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const templateBytes = new Uint8Array(await fileData.arrayBuffer());

    // ── Unzip template (xlsx = ZIP) ───────────────────────────────────────────
    const zip        = fflate.unzipSync(templateBytes);
    const sheetPaths = resolveSheetPaths(zip);

    // ── Collect ALL cell updates  ─────────────────────────────────────────────
    // updates: sheetName → (cellAddr → value)
    const updates = new Map<string, Map<string, string>>();

    function addUpdate(sheet: string, addr: string, value: string) {
      if (!value && value !== "0") return;
      if (!updates.has(sheet)) updates.set(sheet, new Map());
      updates.get(sheet)!.set(addr, value);
    }

    // 1. Header values from cell_map
    for (const cm of cellMapRows ?? []) {
      if (cm.formula_cell) continue;
      const v = autoValues[cm.field_key];
      if (v) addUpdate(cm.sheet, cm.cell_address, v);
    }

    // 2. Clause values via Proxy worksheets (clause_mapper writes ws[addr] = {v,t})
    const { data: form3cd } = await supabase
      .from("form_3cd")
      .select("*")
      .eq("engagement_id", engagement_id)
      .maybeSingle();

    if (form3cd) {
      const clauseRecord: Record<string, unknown> = {};
      for (const k of [
        "cl_8","cl_9","cl_10","cl_11","cl_12","cl_13","cl_14","cl_15_16",
        "cl_17","cl_18","cl_19","cl_20","cl_21","cl_22","cl_23","cl_24_25",
        "cl_26","cl_27","cl_29","cl_30","cl_31","cl_32","cl_33","cl_34",
        "cl_35","cl_36","cl_37_39","cl_40","cl_41","cl_42_43","cl_44",
      ]) {
        clauseRecord[k] = (form3cd as Record<string, unknown>)[k] ?? {};
      }

      // Proxy sheet: intercepts ws[addr] = { v, t, ... } writes from clause_mapper
      function makeProxyWS(sheetName: string): Record<string, any> {
        const backing: Record<string, any> = {};
        return new Proxy(backing, {
          set(target, prop, value) {
            target[prop as string] = value; // store for any subsequent reads
            if (
              typeof prop === "string" &&
              /^[A-Z]+\d+$/.test(prop) &&
              value?.v != null &&
              String(value.v).trim() !== ""
            ) {
              addUpdate(sheetName, prop, String(value.v));
            }
            return true;
          },
        });
      }

      // Mock workbook — only Sheets and SheetNames are accessed by buildClauseValues
      const mockWb = {
        Sheets: {
          Form_3CD:           makeProxyWS("Form_3CD"),
          ANX_3CD_Main:       makeProxyWS("ANX_3CD_Main"),
          ANX_3CD_Cl34_TDS:   makeProxyWS("ANX_3CD_Cl34_TDS"),
        },
        SheetNames: ["Form_3CD", "ANX_3CD_Main", "ANX_3CD_Cl34_TDS"],
      } as any;

      buildClauseValues(clauseRecord, mockWb, client.name ?? undefined);
    }

    // ── Apply updates directly into sheet XMLs ────────────────────────────────
    for (const [sheetName, cellUpdates] of updates) {
      const sheetPath = sheetPaths.get(sheetName);
      if (!sheetPath || !zip[sheetPath]) continue;

      let xml = _dec.decode(zip[sheetPath]);
      for (const [addr, value] of cellUpdates) {
        xml = setCellInXml(xml, addr, value);
      }
      zip[sheetPath] = _enc.encode(xml);
    }

    // ── Rezip and return (all styles / images / rels untouched) ──────────────
    const outBuffer = fflate.zipSync(zip, { level: 6 });

    const clientName = (client.name ?? "export")
      .replace(/[^a-zA-Z0-9_\-. ]/g, "_")
      .slice(0, 40);
    const filename = `${form_type}_${clientName}_${prev}.xlsx`;

    return new Response(outBuffer, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });

  } catch (err) {
    console.error("export_tax_audit error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
