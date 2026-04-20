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
  "3CA-3CD": "v1/3ca_3cd.xlsx",
  "3CB-3CD": "v1/3cb_3cd.xlsx",
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
  // NOTE: Excel writes Target before Id in .rels XML, so we use two passes
  // (one attr-at-a-time) rather than assuming a fixed attribute order.
  const ridToTarget = new Map<string, string>();
  const relElRe = /<Relationship\b([^>]+?)(?:\/>|>)/g;
  let rm: RegExpExecArray | null;
  while ((rm = relElRe.exec(relsXml)) !== null) {
    const attrs  = rm[1];
    const idM    = attrs.match(/\bId="([^"]+)"/);
    const targM  = attrs.match(/\bTarget="([^"]+)"/);
    if (idM && targM) ridToTarget.set(idM[1], targM[1]);
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

// ── Named-range filling ───────────────────────────────────────────────────────
//
// Templates use Excel defined names (e.g. ENTITY_NAME → 01_Control!$F$7).
// We parse workbook.xml for <definedName> elements, resolve each to a
// (sheetPath, cellAddr) pair, and write values directly to those cells.
// This is the primary fill mechanism for the 3CA/3CD template.
//
// Named range → autoValues key mapping (handles _0 suffix variants):
const NR_TO_FIELD: Record<string, string> = {
  ENTITY_NAME:    "ENTITY_NAME",
  ENTITY_ADDRESS: "ENTITY_ADDRESS",
  PAN:            "PAN",
  TAN:            "TAN",
  GSTIN:          "GSTIN",
  ENTITY_TYPE:    "ENTITY_TYPE",
  BUSINESS_NATURE:"BUSINESS_NATURE",
  PREVIOUS_YEAR:  "PREVIOUS_YEAR",
  ASSESSMENT_YEAR:"ASSESSMENT_YEAR",
  FIRM_NAME:      "FIRM_NAME",
  PARTNER_NAME:   "PARTNER_NAME",
  FRN:            "FRN",
  MEMBERSHIP_NO:  "MEMBERSHIP_NO",
  UDIN:           "UDIN",
  SIGN_DATE:      "SIGN_DATE",
  PLACE_0:        "PLACE",
  REPORT_DATE_0:  "REPORT_DATE",
  BS_DATE_0:      "BS_DATE",
  COMP_YEAR_END:  "COMP_YEAR_END",
  BS_DATE:        "BS_DATE",
  PLACE:          "PLACE",
  REPORT_DATE:    "REPORT_DATE",
};

/**
 * Parse workbook.xml definedName elements and return a map of
 * namedRange → { sheetName, cellAddr } (strips $ signs from addr).
 * Only handles simple single-cell references like "Sheet!$F$7".
 */
function parseNamedRanges(
  wbXml: string,
): Map<string, { sheetName: string; cellAddr: string }> {
  const result = new Map<string, { sheetName: string; cellAddr: string }>();
  const re = /<definedName\s+([^>]*)>(.*?)<\/definedName>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(wbXml)) !== null) {
    const attrs = m[1];
    const value = m[2].trim();
    const nameM = attrs.match(/\bname="([^"]+)"/);
    if (!nameM) continue;
    // Match "SheetName!$COL$ROW" — sheet name may contain spaces, dots, underscores
    const refM = value.match(/^'?([^'!]+)'?!\$([A-Z]+)\$(\d+)$/);
    if (!refM) continue;
    result.set(nameM[1], {
      sheetName: refM[1],
      cellAddr:  refM[2] + refM[3],  // e.g. "F7"
    });
  }
  return result;
}

// ── AUTO-marker resolution ────────────────────────────────────────────────────
//
// Templates contain literal "AUTO" text as placeholders.  These three functions
// scan the sheet XML for those cells, identify each field from the label text in
// the same row, and return (address → value) pairs for the main update pass.
//
// Why labels work: every "AUTO" cell in the template sits on the same row as a
// label cell — e.g. "Name of the assessee | AUTO" or "Firm Regi. No.: | AUTO".
// Pattern-matching the row's non-AUTO text against LABEL_MAP resolves the field.

/** Parse xl/sharedStrings.xml → indexed array of plain-text string values. */
function parseSharedStrings(zip: Record<string, Uint8Array>): string[] {
  const buf = zip["xl/sharedStrings.xml"];
  if (!buf) return [];
  const xml = _dec.decode(buf);
  const ss: string[] = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml)) !== null) {
    // Handles rich-text <r><t>…</t></r> by joining all <t> fragments
    const texts: string[] = [];
    const tRe = /<t[^>]*>([^<]*)<\/t>/g;
    let tm: RegExpExecArray | null;
    while ((tm = tRe.exec(m[1])) !== null) texts.push(tm[1]);
    ss.push(texts.join(""));
  }
  return ss;
}

/** Extract the visible text value of one cell from its attribute string + inner XML. */
function cellTextValue(attrs: string, inner: string, ss: string[]): string {
  const typeM = attrs.match(/\bt="([^"]+)"/);
  const t = typeM?.[1] ?? "";
  if (t === "inlineStr" || (!t && inner.includes("<is>"))) {
    const m = inner.match(/<t[^>]*>([^<]*)<\/t>/);
    return m?.[1] ?? "";
  }
  if (t === "str") {
    const m = inner.match(/<v>([^<]*)<\/v>/);
    return m?.[1] ?? "";
  }
  if (t === "s") {
    const m = inner.match(/<v>(\d+)<\/v>/);
    if (!m) return "";
    return ss[parseInt(m[1])] ?? "";
  }
  // Fallback: inline string without explicit type
  const tM = inner.match(/<t[^>]*>([^<]*)<\/t>/);
  return tM?.[1] ?? "";
}

/**
 * Scan one sheet XML for cells whose text value is "AUTO".
 * For each such cell, look at all other text in the same row (plus the row
 * immediately above) to find a label, then pattern-match to a field key.
 *
 * Returns a Map<cellAddr, replacementValue> — only entries where a value is
 * known are included.
 */
function resolveAutoMarkers(
  sheetXml: string,
  ss: string[],
  autoValues: Record<string, string>,
): Map<string, string> {
  // ORDER MATTERS: more specific patterns first so "Assessment year" wins
  // over the bare "\byear\b" that would otherwise match "previous year" too.
  const LABEL_MAP: [RegExp, string][] = [
    [/name\s+of\s+the\s+assessee/i,             "ENTITY_NAME"],
    [/assessment\s+year/i,                       "ASSESSMENT_YEAR"],
    [/previous\s+year/i,                         "PREVIOUS_YEAR"],
    [/permanent\s+account\s+number|^\s*pan\b/i,  "PAN"],
    [/status\s+of\s+the\s+assessee/i,            "ENTITY_TYPE"],
    [/nature\s+of\s+business/i,                  "BUSINESS_NATURE"],
    [/\bgstin\b|\bgst[- ]no/i,                   "GSTIN"],
    [/\btan\b/i,                                 "TAN"],
    [/reg(?:istration)?[\s.]*no|frn\b/i,         "FRN"],
    [/\budin\b/i,                                "UDIN"],
    [/membership[\s.]*no/i,                      "MEMBERSHIP_NO"],
    [/\bplace\b/i,                               "PLACE"],
    // "Date" is intentionally AFTER more specific items
    [/\bdate\b/i,                                "SIGN_DATE"],
    [/\bpartner\b/i,                             "PARTNER_NAME"],
    [/name.*\bfirm\b|\bfirm\b.*name|chartered\s+accountants/i, "FIRM_NAME"],
    [/\baddress\b/i,                             "ENTITY_ADDRESS"],
  ];

  // ── Pass 1: collect per-row text and AUTO-cell addresses ──────────────────
  const rowTexts  = new Map<number, string[]>();  // rowNum → label texts
  const rowAutos  = new Map<number, string[]>();  // rowNum → AUTO cell addresses

  // Parse all cells with regex (handles self-closing and full-element variants)
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let cm: RegExpExecArray | null;
  while ((cm = cellRe.exec(sheetXml)) !== null) {
    const attrs = cm[1];
    const inner = cm[2] ?? "";
    const addrM = attrs.match(/\br="([A-Z]+(\d+))"/);
    if (!addrM) continue;
    const addr   = addrM[1];
    const rowNum = parseInt(addrM[2], 10);

    const text = cellTextValue(attrs, inner, ss).trim();
    // Match "AUTO" exactly OR cells like "_____ AUTO" / "________ AUTO" used in sign-off sections.
    // Also matches "[Audit firm name]_   AUTO" and "[Signing partner Name]_ AUTO" style cells.
    if (text === "AUTO" || (text.endsWith("AUTO") && text.includes("_"))) {
      if (!rowAutos.has(rowNum)) rowAutos.set(rowNum, []);
      rowAutos.get(rowNum)!.push(addr);
      // For cells like "[Audit firm name]_   AUTO" the label is EMBEDDED in the AUTO cell text.
      // Extract it (strip trailing underscore-run + AUTO suffix, strip [ ] brackets) and add to
      // rowTexts so the pattern-match step can resolve it correctly without relying on a
      // separate label cell in the same row.
      const embeddedLabel = text
        .replace(/\s*_+\s*AUTO\s*$/i, "")   // strip "___  AUTO" suffix
        .replace(/^\[/, "").replace(/\]$/, "") // strip outer [ ]
        .trim();
      if (embeddedLabel) {
        if (!rowTexts.has(rowNum)) rowTexts.set(rowNum, []);
        rowTexts.get(rowNum)!.push(embeddedLabel);
      }
    } else if (text) {
      if (!rowTexts.has(rowNum)) rowTexts.set(rowNum, []);
      rowTexts.get(rowNum)!.push(text);
    }
  }

  // ── Pass 2: match each AUTO row to a field using label text ───────────────
  // Strategy: try the CURRENT row's labels first (most specific).
  // Only fall back to combined (current + row above) if nothing matched —
  // this prevents e.g. "Place" from the previous row contaminating "Date:".
  const result = new Map<string, string>();

  for (const [rowNum, autoAddrs] of rowAutos) {
    const currentText = (rowTexts.get(rowNum) ?? []).join(" ");
    const combinedText = [
      ...(rowTexts.get(rowNum - 1) ?? []),
      ...(rowTexts.get(rowNum)     ?? []),
    ].join(" ");

    // Try current-row labels first, then fall back to combined context
    for (const textToTry of [currentText, combinedText]) {
      if (!textToTry) continue;
      let matched = false;
      for (const [pattern, fieldKey] of LABEL_MAP) {
        if (pattern.test(textToTry)) {
          const value = autoValues[fieldKey];
          if (value) {
            for (const addr of autoAddrs) result.set(addr, value);
          }
          matched = true;
          break;
        }
      }
      if (matched) break;
    }
  }

  return result;
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
  // NOTE: Use String.raw to avoid template-literal escape processing — \\s and
  // \\b in template literals collapse to 's' and backspace (char 8) in Deno/V8.
  const selfRe = new RegExp(String.raw`<c(\s[^>]*)\br="${addrRe}"([^>]*?)\/>`);
  const selfM  = selfRe.exec(xml);
  if (selfM) {
    const allA = selfM[1] + selfM[2];
    const sM   = allA.match(/\bs="(\d+)"/);
    const sA   = sM ? ` s="${sM[1]}"` : "";
    return (
      xml.slice(0, selfM.index) +
      `<c r="${addr}"${sA} t="str"><v>${esc}</v></c>` +
      xml.slice(selfM.index + selfM[0].length)
    );
  }

  // ── Full element variant ──────────────────────────────────────────────────
  const openRe = new RegExp(String.raw`<c(\s[^>]*)\br="${addrRe}"([^>]*?)>`);
  const openM  = openRe.exec(xml);
  if (!openM) return xml; // cell not in this sheet — silently skip

  const allA = openM[1] + openM[2];
  const sM   = allA.match(/\bs="(\d+)"/);
  const sA   = sM ? ` s="${sM[1]}"` : "";

  const closeIdx = xml.indexOf("</c>", openM.index + openM[0].length);
  if (closeIdx === -1) return xml;

  return (
    xml.slice(0, openM.index) +
    `<c r="${addr}"${sA} t="str"><v>${esc}</v></c>` +
    xml.slice(closeIdx + 4)
  );
}

// ── Formula-cell direct fill ──────────────────────────────────────────────────
//
// Some template cells use Excel named-range formulas (e.g. <f>FIRM_NAME</f>).
// The named-range target cell in 01_Control gets filled by the named-range pass,
// but those formula cells still carry their stale cached <v>0</v>.
//
// PROBLEM: when the workbook also contains broken external-workbook named ranges
// (e.g. Report_Date → [73]Index!$C$22) Excel shows an "Update external links?"
// dialog.  If the user clicks "Don't Update" the full recalculation is suppressed
// and every formula cell is frozen at its cached value (0 / blank).
//
// FIX: scan every sheet for cells whose <f> text exactly matches one of our known
// field-name keys and write the resolved value directly as an inlineStr — no
// Excel recalculation needed at all.

/** All named-range keys we know how to resolve (mirrors NR_TO_FIELD values + keys). */
const FORMULA_FIELD_NAMES = new Set([
  ...Object.keys(NR_TO_FIELD),
  ...Object.values(NR_TO_FIELD),
]);

/**
 * Scan sheetXml for cells whose formula text is exactly a known field-name key,
 * and return (cellAddr → resolvedValue) for each match.
 */
function resolveFormulaCells(
  sheetXml: string,
  autoValues: Record<string, string>,
): Map<string, string> {
  const result = new Map<string, string>();
  // Match <c r="ADDR" ...><f ...>FORMULA_TEXT</f>...</c>
  const cellRe = /<c\b([^>]*?)>([\s\S]*?)<\/c>/g;
  let cm: RegExpExecArray | null;
  while ((cm = cellRe.exec(sheetXml)) !== null) {
    const attrs = cm[1];
    const inner = cm[2];
    const addrM = attrs.match(/\br="([A-Z]+\d+)"/);
    if (!addrM) continue;
    const addr = addrM[1];
    // Extract formula content — handles <f>NAME</f> and <f t="...">NAME</f>
    const fM = inner.match(/<f[^>]*>([^<]+)<\/f>/);
    if (!fM) continue;
    const formulaText = fM[1].trim();
    if (!FORMULA_FIELD_NAMES.has(formulaText)) continue;
    // Resolve: try the formula text itself as a key, then via NR_TO_FIELD mapping
    const value =
      autoValues[formulaText] ||
      autoValues[NR_TO_FIELD[formulaText] ?? ""] ||
      "";
    if (value) result.set(addr, value);
  }
  return result;
}

// ── External workbook ref stripper ────────────────────────────────────────────
//
// If any <definedName> in workbook.xml references an external workbook
// (its value contains "["), Excel shows "Update external links?" on open.
// When the user clicks "Don't Update" ALL formula recalculation is suppressed —
// even cells that use only local named ranges — so every formula cell stays at 0.
//
// Fix: rewrite those broken names to point to well-known local 01_Control cells
// so Excel never needs to fetch an external workbook.
//
// Known broken names and their correct local targets:
const EXTERNAL_NR_FIXUP: Record<string, string> = {
  Report_Date:    "'01_Control'!$F$25",
  Place:          "'01_Control'!$F$26",
  BS_Date:        "'01_Control'!$G$16",
  REPORT_DATE:    "'01_Control'!$F$25",
  PLACE:          "'01_Control'!$F$26",
  BS_DATE:        "'01_Control'!$G$16",
  REPORT_DATE_0:  "'01_Control'!$F$25",
  PLACE_0:        "'01_Control'!$F$26",
};

/**
 * Rewrite any <definedName> whose value contains "[" (external workbook ref)
 * to the corresponding local 01_Control cell, or strip it if unknown.
 * Also removes the xl/externalLinks/ entries that cause the "update?" dialog.
 */
function fixExternalNamedRanges(wbXml: string): string {
  return wbXml.replace(
    /(<definedName\b([^>]*)>)([\s\S]*?)(<\/definedName>)/g,
    (match, openTag, attrs, value, closeTag) => {
      if (!value.includes("[")) return match;  // local ref — keep as-is
      const nameM = attrs.match(/\bname="([^"]+)"/);
      if (!nameM) return match;
      const localTarget = EXTERNAL_NR_FIXUP[nameM[1]];
      if (localTarget) {
        return `${openTag}${localTarget}${closeTag}`;
      }
      // Unknown external ref — remove the definedName entirely to avoid the dialog
      return "";
    },
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

    console.log("[export_tax_audit] engagement_id:", engagement_id, "form_type:", form_type);
    console.log("[export_tax_audit] financial_year:", fy, "client_id:", (eng as any).client_id);
    console.log("[export_tax_audit] client keys:", Object.keys(client), "name:", client.name, "pan:", client.pan);

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

    // ── Fallback: load firms table (user's own CA practice) ───────────────────
    // Used when audit_firms fields are not set (FRN, city, etc.)
    let caFirm: Record<string, any> = {};
    const firmId = (eng as any).firm_id;
    if (firmId) {
      const { data: cf } = await supabase
        .from("firms")
        .select("name, display_name, icai_firm_reg_no, icai_reg_no, address")
        .eq("id", firmId)
        .single();
      if (cf) caFirm = cf as Record<string, any>;
    }

    // ── Fallback: load signing partner from users table ───────────────────────
    let partnerUser: Record<string, any> = {};
    const partnerId = (eng as any).partner_id;
    if (partnerId) {
      // users table has icai_reg_no; also select name for partner display
      const { data: pu } = await supabase
        .from("users")
        .select("name, icai_reg_no")
        .eq("id", partnerId)
        .single();
      if (pu) partnerUser = pu as Record<string, any>;
    }
    // Also try engagement.partner_name (saved directly on audit_engagements)
    const engPartnerName = (eng as any).partner_name as string | null;

    const { prev, ay, bsDate } = fyToRange(fy);

    // ── Load form_3ca_3cb (UDIN / dates) ─────────────────────────────────────
    // NOTE: udin, signature_date, audit_report_date are stored inside the
    // "data" JSONB column, not as top-level columns.
    const tab = form_type.startsWith("3CA") ? "3ca" : "3cb";
    const { data: form3 } = await supabase
      .from("form_3ca_3cb" as any)
      .select("data")
      .eq("engagement_id", engagement_id)
      .eq("tab", tab)
      .maybeSingle();

    const form3Data = (form3 as any)?.data ?? {};

    // UDIN: form_3ca_3cb.data.udin
    //   → engagement.form_3ca_udin / form_3cb_udin  (new columns, saved by UI)
    //   → engagement.udin (legacy fallback)
    const udin = form3Data?.udin ||
      (tab === "3ca"
        ? ((eng as any).form_3ca_udin)
        : ((eng as any).form_3cb_udin)) ||
      (eng as any).udin || "";
    // Report date: form_3ca_3cb.data.audit_report_date
    //   → engagement.form_3ca_report_date (new column, saved by UI)
    //   → engagement.sign_off_date (legacy fallback)
    //   → today (final fallback so the field is never blank)
    const reportDate = formatDate(
      form3Data?.audit_report_date ||
      (tab === "3ca" ? (eng as any).form_3ca_report_date : null) ||
      (eng as any).sign_off_date ||
      new Date().toISOString().split("T")[0]
    );
    // Sign date: form_3ca_3cb.data.signature_date
    //   → engagement.form_3ca_signature_date / form_3cb_signature_date (new columns)
    //   → engagement.sign_off_date (legacy fallback)
    //   → today (final fallback so the sign-off date is never blank)
    const signDate = formatDate(
      form3Data?.signature_date ||
      (tab === "3ca"
        ? (eng as any).form_3ca_signature_date
        : (eng as any).form_3cb_signature_date) ||
      (eng as any).sign_off_date ||
      new Date().toISOString().split("T")[0]
    );

    // ── Resolve firm-level sign-off fields with fallbacks ─────────────────────
    // Priority: audit_firms → firms (CA practice) → partnerUser (signing user)
    const firmName    = firm.name        || caFirm.display_name || caFirm.name || "";
    const partnerName = firm.partner_name || partnerUser.name || engPartnerName || "";
    const frn         = firm.icai_reg_no  || caFirm.icai_firm_reg_no || caFirm.icai_reg_no || "";
    const membershipNo= firm.partner_icai_no || partnerUser.icai_reg_no || "";
    // City: from audit_firms, or from firms.address JSON (may have a "city" key)
    const firmsAddress = (typeof caFirm.address === "object" && caFirm.address !== null)
      ? (caFirm.address as Record<string, any>)
      : {};
    const place       = firm.city || firmsAddress.city || firmsAddress.district || "";

    // ── Build auto-value map ──────────────────────────────────────────────────
    const gstin   = Array.isArray(client.gstin) ? client.gstin[0] ?? "" : (client.gstin ?? "");
    const address = client.address || client.registered_office || "";

    const autoValues: Record<string, string> = {
      ENTITY_NAME:    client.name ?? "",
      ENTITY_ADDRESS: address,
      PAN:            client.pan ?? "",
      TAN:            client.tan_number ?? client.tan ?? "",  // DB column is tan_number
      GSTIN:          gstin,
      ENTITY_TYPE:    client.entity_type ?? "",
      BUSINESS_NATURE: client.business_activity ?? client.nature_of_business ?? client.business_nature ?? "",
      PREVIOUS_YEAR:  prev,
      ASSESSMENT_YEAR: ay,
      BS_DATE:        bsDate,
      COMP_YEAR_END:  bsDate,
      FIRM_NAME:      firmName,
      PARTNER_NAME:   partnerName,
      FRN:            frn,
      MEMBERSHIP_NO:  membershipNo,
      UDIN:           udin,
      REPORT_DATE:    reportDate,
      PLACE:          place,
      SIGN_DATE:      signDate,
    };

    const nonEmptyValues = Object.entries(autoValues).filter(([,v]) => !!v);
    console.log("[export_tax_audit] autoValues non-empty:", nonEmptyValues.length, "/", Object.keys(autoValues).length);
    nonEmptyValues.forEach(([k, v]) => console.log("  ", k, "=", v));

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
    console.log("[export_tax_audit] template bytes:", templateBytes.length);

    // ── Unzip template (xlsx = ZIP) ───────────────────────────────────────────
    const zip        = fflate.unzipSync(templateBytes);

    // ── Strip external workbook links ────────────────────────────────────────
    // Templates copied from other workbooks carry xl/externalLinks/ entries that
    // cause Excel to show "Update external links?" on open.  Remove them entirely
    // so the dialog never appears.  Our cell-level writes bypass formula recalc
    // anyway, but a clean file is less surprising for users.
    let extLinksRemoved = 0;
    for (const key of Object.keys(zip)) {
      if (key.startsWith("xl/externalLinks/")) {
        delete (zip as any)[key];
        extLinksRemoved++;
      }
    }
    // Remove externalLink relationships from xl/_rels/workbook.xml.rels
    const wbRelsKey = "xl/_rels/workbook.xml.rels";
    if (zip[wbRelsKey]) {
      const wbRelsXml = _dec.decode(zip[wbRelsKey]);
      const wbRelsFixed = wbRelsXml.replace(
        /<Relationship\b[^>]*\/officeDocument\/2006\/relationships\/externalLink[^>]*\/>/g,
        ""
      );
      if (wbRelsFixed !== wbRelsXml) zip[wbRelsKey] = _enc.encode(wbRelsFixed);
    }
    // Remove externalLink override entries from [Content_Types].xml
    const ctKey = "[Content_Types].xml";
    if (zip[ctKey]) {
      const ctXml = _dec.decode(zip[ctKey]);
      const ctFixed = ctXml.replace(/<Override\b[^>]*externalLink[^>]*\/>/g, "");
      if (ctFixed !== ctXml) zip[ctKey] = _enc.encode(ctFixed);
    }
    console.log(`[External links] Stripped ${extLinksRemoved} externalLink entries from ZIP`);

    const sheetPaths = resolveSheetPaths(zip);
    const wbEntry = zip["xl/workbook.xml"];
    console.log("[export_tax_audit] zip keys:", Object.keys(zip).length, "| wbXml entry:", wbEntry ? wbEntry.length + " bytes" : "NOT FOUND");
    console.log("[export_tax_audit] sheetPaths:", JSON.stringify([...sheetPaths.entries()]));

    // ── Collect ALL cell updates  ─────────────────────────────────────────────
    // updates: sheetName → (cellAddr → value)
    const updates = new Map<string, Map<string, string>>();

    function addUpdate(sheet: string, addr: string, value: string) {
      if (!value && value !== "0") return;
      if (!updates.has(sheet)) updates.set(sheet, new Map());
      updates.get(sheet)!.set(addr, value);
    }

    // -1. Named-range fill — primary mechanism for 01_Control-based templates.
    //     Reads workbook.xml defined names, resolves sheet+cell, writes autoValues.
    let wbXml = wbEntry ? _dec.decode(wbEntry) : "";
    if (wbXml) {
      // ── Fix broken external-workbook named ranges BEFORE parsing ─────────────
      // Some templates were copied from other workbooks and carry named ranges
      // that point to external files ([73]Index!$C$22 etc.).  Excel displays an
      // "Update external links?" dialog on open; if the user clicks "Don't Update"
      // ALL formula recalculation is suppressed and every cell stays at v=0.
      // Rewrite known external names to local 01_Control cells and strip unknowns.
      let wbXmlFixed = fixExternalNamedRanges(wbXml);
      // Also remove <externalReferences> block — belt-and-suspenders with the
      // ZIP entry removal above so Excel truly has nothing external to fetch.
      wbXmlFixed = wbXmlFixed.replace(/<externalReferences>[\s\S]*?<\/externalReferences>/g, "");
      wbXmlFixed = wbXmlFixed.replace(/<externalReferences\/>/g, "");
      if (wbXmlFixed !== wbXml) {
        console.log("[Named-range fix] Rewrote external-workbook named ranges + stripped externalReferences in workbook.xml");
        wbXml = wbXmlFixed;
        zip["xl/workbook.xml"] = _enc.encode(wbXml);
      }

      const namedRanges = parseNamedRanges(wbXml);
      let nrFilled = 0;
      for (const [rangeName, { sheetName, cellAddr }] of namedRanges) {
        const fieldKey = NR_TO_FIELD[rangeName];
        if (!fieldKey) continue;
        const value = autoValues[fieldKey];
        if (!value) continue;
        const sheetPath = sheetPaths.get(sheetName);
        if (!sheetPath) continue;
        addUpdate(sheetName, cellAddr, value);
        nrFilled++;
      }
      console.log(`[Named-range fill] ${namedRanges.size} ranges parsed, ${nrFilled} values written`);
      if (nrFilled === 0 && namedRanges.size > 0) {
        // Debug: show first 5 named ranges and what matched NR_TO_FIELD
        let checked = 0;
        for (const [rn, { sheetName, cellAddr }] of namedRanges) {
          if (checked++ > 4) break;
          const fk = NR_TO_FIELD[rn];
          const val = fk ? autoValues[fk] : "NO_FIELD_KEY";
          const sp = sheetPaths.get(sheetName);
          console.log(`  NR ${rn} → sheet=${sheetName} cell=${cellAddr} fieldKey=${fk||"N/A"} value="${val}" sheetPath=${sp||"MISSING"}`);
        }
      }
    }

    // 0. AUTO-marker scan — scans every sheet for cells containing the literal
    //    text "AUTO" and maps them to field values via label-text pattern matching.
    //    Runs FIRST so that cell_map entries (step 1) can override if needed.
    const sharedStrings = parseSharedStrings(zip);
    for (const [sheetName, sheetPath] of sheetPaths) {
      if (!zip[sheetPath]) continue;
      const sheetXml = _dec.decode(zip[sheetPath]);
      const autoMappings = resolveAutoMarkers(sheetXml, sharedStrings, autoValues);
      console.log(`[AUTO-scan] ${sheetName}: ${autoMappings.size} AUTO marker(s) resolved`);
      for (const [addr, value] of autoMappings) {
        addUpdate(sheetName, addr, value);
      }
    }

    // 0b. Formula-cell direct fill — find cells whose <f> content is exactly a
    //     known field-name key (e.g. <f>FIRM_NAME</f>) and write the resolved value
    //     directly as an inlineStr. This bypasses Excel recalculation entirely, so
    //     even if the user opens the file without recalculating, all fields show up.
    let formulaCellsTotal = 0;
    for (const [sheetName, sheetPath] of sheetPaths) {
      if (!zip[sheetPath]) continue;
      const sheetXml = _dec.decode(zip[sheetPath]);
      const formulaMappings = resolveFormulaCells(sheetXml, autoValues);
      if (formulaMappings.size > 0) {
        console.log(`[Formula-cell fill] ${sheetName}: ${formulaMappings.size} formula cell(s) resolved`);
        formulaCellsTotal += formulaMappings.size;
      }
      for (const [addr, value] of formulaMappings) {
        addUpdate(sheetName, addr, value);
      }
    }
    console.log(`[Formula-cell fill] total: ${formulaCellsTotal} cells directly filled`);

    // 1. Header values from cell_map (overrides AUTO scan where both match)
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

    // ── Direct cell writes (belt-and-suspenders for cells with no formula/AUTO) ─
    // These cells in the template are plain inlineStr/str placeholders with no formula
    // and no AUTO marker — the named-range pass and AUTO scan miss them entirely.
    // We write them by hardcoded address so they always appear in the export.

    if (form_type === "3CA-3CD") {
      // ── Form_3CA sign-off block (correct template cell addresses) ────────────
      // Verified from K:\SOFTWARE\AUDIT\AUDIT REPORT\FORMAT AR_NCE & LLP\3CA-3CD.xlsx
      //   Row 16: E16="For,"  G16="[Audit firm name]_ AUTO"  → FIRM_NAME
      //   Row 17: G17="Chartered Accountants"
      //   Row 18: F18="Firm Regi. No.:"  G18="________ AUTO"  → FRN
      //   Row 19: B19="Place :"  C19="________ AUTO"  → PLACE
      //   Row 20: B20="Date  :"  C20="________ AUTO"  → SIGN_DATE
      //   Row 21: B21="UDIN :"   C21="________ AUTO"  → UDIN
      //   Row 22: G22="[Signing partner Name]_ AUTO"  → PARTNER_NAME
      //   Row 23: G23="Partner"
      //   Row 24: F24="Membership No.: "  G24="_________ AUTO"  → MEMBERSHIP_NO
      //
      // AUTO scan (enhanced) handles G16/G18/C19/C20/C21/G22/G24 via label matching.
      // Writing these directly as belt-and-suspenders ensures correct output even if
      // the AUTO scan label matching doesn't resolve a particular cell.
      addUpdate("Form_3CA", "G16", autoValues.FIRM_NAME);
      addUpdate("Form_3CA", "G18", autoValues.FRN);
      addUpdate("Form_3CA", "C19", autoValues.PLACE);
      addUpdate("Form_3CA", "C20", autoValues.SIGN_DATE);
      addUpdate("Form_3CA", "C21", autoValues.UDIN);
      addUpdate("Form_3CA", "G22", autoValues.PARTNER_NAME);
      addUpdate("Form_3CA", "G24", autoValues.MEMBERSHIP_NO);

      // ── Form_3CA ANNEX sign-off block ────────────────────────────────────────
      // Verified from correct template:
      //   B4="ENTITY_NAME" (literal shared string — no AUTO)
      //   E24="For,"  G24="[Audit firm name]_ AUTO"  → FIRM_NAME
      //   G25="Chartered Accountants"
      //   F26="Firm Regi. No.:"  G26="________ AUTO"  → FRN
      //   B27="Place: "  C27="________ AUTO"  → PLACE
      //   B28="Date: "   C28="________ AUTO"  → SIGN_DATE
      //   B29="UDIN:"    C29="________ AUTO"  → UDIN
      //   G30="[Signing partner Name]_ AUTO"  → PARTNER_NAME
      //   G31="Partner"
      //   F32="Membership No.: "  G32="_________ AUTO"  → MEMBERSHIP_NO
      addUpdate("Form_3CA ANNEX", "B4",  autoValues.ENTITY_NAME);
      addUpdate("Form_3CA ANNEX", "G24", autoValues.FIRM_NAME);
      addUpdate("Form_3CA ANNEX", "G26", autoValues.FRN);
      addUpdate("Form_3CA ANNEX", "C27", autoValues.PLACE);
      addUpdate("Form_3CA ANNEX", "C28", autoValues.SIGN_DATE);
      addUpdate("Form_3CA ANNEX", "C29", autoValues.UDIN);
      addUpdate("Form_3CA ANNEX", "G30", autoValues.PARTNER_NAME);
      addUpdate("Form_3CA ANNEX", "G32", autoValues.MEMBERSHIP_NO);

      // ── Form_3CA body paragraphs ─────────────────────────────────────────────
      // B9 (ss[431]) contains statutory text with placeholders:
      //   [NAME AND ADDRESS OF ASSESSEE WITH PAN], [NAME OF AUDIT FIRM],
      //   [APPLICABLE ACT], [DATE]
      // The sharedStrings.xml replacement pass below handles these automatically.
      // Only override B9/B11/B13 if the user has saved custom paragraph text.
      const savedParas3CA = ((eng as any).form_3ca_paragraphs as Record<string, string>) || {};
      if (savedParas3CA.p1) addUpdate("Form_3CA", "B9",  savedParas3CA.p1);
      if (savedParas3CA.p2) addUpdate("Form_3CA", "B11", savedParas3CA.p2);
      if (savedParas3CA.p3) addUpdate("Form_3CA", "B13", savedParas3CA.p3);
    }

    if (form_type === "3CB-3CD") {
      // ── Form_3CB assessee info + sign-off block ──────────────────────────────
      // Verified from K:\SOFTWARE\AUDIT\AUDIT REPORT\FORMAT AR_NCE & LLP\3CB-3CD.xlsx
      //   D10="ENTITY_NAME"          → ENTITY_NAME
      //   D12="ENTITY_ADDRESS"       → ENTITY_ADDRESS
      //   D15="ENTITY_PAN"           → PAN
      //   G38="For,"  I38="___AUDIT FIRM_NAME"  → FIRM_NAME
      //   I39="Chartered Accountants"
      //   I40="FRN: _______"         → FRN (whole cell replaced with FRN value)
      //   B41="Place: "  C41="[PLACE]"  → PLACE
      //   B42="Date: "   C42="[REPORT DATE]"  → SIGN_DATE
      //   B43="UDIN:"    C43="[UDIN]"  → UDIN
      //   I44="[Signing partner Name]"  → PARTNER_NAME
      //   I45="Partner"
      //   G46="Membership No.: "  I46="_____[Membership No]"  → MEMBERSHIP_NO
      addUpdate("Form_3CB", "D10", autoValues.ENTITY_NAME);
      addUpdate("Form_3CB", "D12", autoValues.ENTITY_ADDRESS);
      addUpdate("Form_3CB", "D15", autoValues.PAN);
      addUpdate("Form_3CB", "I38", autoValues.FIRM_NAME);
      addUpdate("Form_3CB", "I40", autoValues.FRN);
      addUpdate("Form_3CB", "C41", autoValues.PLACE);
      addUpdate("Form_3CB", "C42", autoValues.SIGN_DATE);
      addUpdate("Form_3CB", "C43", autoValues.UDIN);
      addUpdate("Form_3CB", "I44", autoValues.PARTNER_NAME);
      addUpdate("Form_3CB", "I46", autoValues.MEMBERSHIP_NO);

      // ── Form_3CB ANNEX sign-off block ─────────────────────────────────────────
      // Verified from correct template (sheet name: "Form_3CB ANNEX"):
      //   F22="For,"  G22="AUDIT FIRM_NAME"  → FIRM_NAME
      //   G23="Chartered Accountants"
      //   G24="FRN: ___________"  → FRN
      //   B25="Place: "  C25="[PLACE]"  → PLACE
      //   B26="Date: "   C26="[REPORT DATE]"  → SIGN_DATE
      //   B27="UDIN:"    C27="[UDIN]"  → UDIN
      //   G28="[Signing partner Name]"  → PARTNER_NAME
      //   G29="Partner"
      //   F30="Membership No.: "  G30="[Membership No]"  → MEMBERSHIP_NO
      addUpdate("Form_3CB ANNEX", "G22", autoValues.FIRM_NAME);
      addUpdate("Form_3CB ANNEX", "G24", autoValues.FRN);
      addUpdate("Form_3CB ANNEX", "C25", autoValues.PLACE);
      addUpdate("Form_3CB ANNEX", "C26", autoValues.SIGN_DATE);
      addUpdate("Form_3CB ANNEX", "C27", autoValues.UDIN);
      addUpdate("Form_3CB ANNEX", "G28", autoValues.PARTNER_NAME);
      addUpdate("Form_3CB ANNEX", "G30", autoValues.MEMBERSHIP_NO);
    }

    // Form_3CD signature block — same cells exist in both 3CA-3CD and 3CB-3CD
    addUpdate("Form_3CD", "H235", autoValues.FIRM_NAME);
    addUpdate("Form_3CD", "I237", autoValues.FRN);
    addUpdate("Form_3CD", "I243", autoValues.MEMBERSHIP_NO);

    // 01_Control header block — always write for both form types (sign-off visibility)
    // Entity + sign-off fields (named ranges resolve to F-column cells in 01_Control;
    // we belt-and-suspenders by writing to the named-range targets AND the C-column
    // display cells that the sheet uses for on-screen audit trail display).
    addUpdate("01_Control", "C7",  autoValues.ENTITY_NAME);
    addUpdate("01_Control", "C9",  autoValues.PAN);
    addUpdate("01_Control", "C14", autoValues.PREVIOUS_YEAR);
    addUpdate("01_Control", "C15", autoValues.ASSESSMENT_YEAR);
    addUpdate("01_Control", "C20", autoValues.FIRM_NAME);
    addUpdate("01_Control", "C21", autoValues.PARTNER_NAME);
    addUpdate("01_Control", "C22", autoValues.FRN);
    addUpdate("01_Control", "C23", autoValues.MEMBERSHIP_NO);
    addUpdate("01_Control", "C26", autoValues.PLACE);
    // F-column: named-range targets (BS_DATE_0→G16 already handled; F24=UDIN, F25=REPORT_DATE)
    // NOTE: F16/F17 are label cells ("31 March,") — the BS_DATE value cell is G16
    // (named range BS_DATE_0 → 01_Control!$G$16) which is filled by the NR pass.
    addUpdate("01_Control", "G16", autoValues.BS_DATE);
    addUpdate("01_Control", "G17", autoValues.BS_DATE);
    addUpdate("01_Control", "F24", autoValues.UDIN);
    addUpdate("01_Control", "F25", autoValues.REPORT_DATE);

    // ── Apply updates directly into sheet XMLs ────────────────────────────────
    // Compute the FY end year (e.g. "2026") for boilerplate template substitutions
    // like "31st March, ____" that appear inside shared-string or inline-string cells.
    const fyEndYear = (() => {
      const m = (fy || "").match(/(\d{4})/);
      return m ? String(parseInt(m[1]) + 1) : "";
    })();

    // Boilerplate string substitutions — applied as plain-text XML replaces AFTER
    // cell-level updates, so formatted dates land in templated paragraphs too.
    function applyBoilerplateSubs(xml: string): string {
      let out = xml;
      if (fyEndYear) {
        // "31st March, ____"  → "31st March, 2026"
        // Template writers used 3+ underscores as a blank; replace any run of 3+ underscores
        // that follows "March," with the FY end year.
        out = out.replace(/(March,\s*)_{3,}/g, `$1${fyEndYear}`);
        // Standalone "____" after "as on" / "for the year ended" / bare dates
        out = out.replace(/(\b(?:as on|ended on|as at)\s+[^_<>]{0,40}?)_{3,}/gi, `$1${fyEndYear}`);
      }
      // Clear "[No.]_ AUTO" annexure-number placeholders (template artifacts with no
      // real value source) — replace with a single space so the cell is no longer noisy.
      out = out.replace(/\[No\.\]_\s*AUTO/g, "");
      // Clear sign-off "________ AUTO" remnants when we failed to resolve them above
      out = out.replace(/_{3,}\s*AUTO/g, "");
      return out;
    }

    for (const [sheetName, cellUpdates] of updates) {
      const sheetPath = sheetPaths.get(sheetName);
      if (!sheetPath || !zip[sheetPath]) continue;

      let xml = _dec.decode(zip[sheetPath]);
      for (const [addr, value] of cellUpdates) {
        xml = setCellInXml(xml, addr, value);
      }
      xml = applyBoilerplateSubs(xml);
      zip[sheetPath] = _enc.encode(xml);
    }

    // Apply boilerplate subs to sharedStrings.xml — many template paragraphs
    // live in shared strings rather than inline strings, so cell-level edits miss them.
    // Also replace Form_3CA / 3CB body-text placeholders that the template uses.
    if (zip["xl/sharedStrings.xml"]) {
      let ssXml = _dec.decode(zip["xl/sharedStrings.xml"]);
      ssXml = applyBoilerplateSubs(ssXml);

      // Form body-text bracket placeholders ─────────────────────────────────
      // These appear verbatim in the template's shared strings and must be
      // replaced before the file is returned; otherwise the paragraphs in
      // Form_3CA / Form_3CB still read "[NAME AND ADDRESS OF ASSESSEE…]".
      if (autoValues.ENTITY_NAME) {
        ssXml = ssXml.replace(
          /\[NAME AND ADDRESS OF ASSESSEE WITH PAN\]/g,
          xmlEsc(autoValues.ENTITY_NAME + (autoValues.PAN ? ` (PAN: ${autoValues.PAN})` : ""))
        );
      }
      if (autoValues.FIRM_NAME) {
        ssXml = ssXml.replace(/\[NAME OF AUDIT FIRM\]/g, xmlEsc(autoValues.FIRM_NAME));
      }
      const reportDateForPlaceholder = autoValues.REPORT_DATE || autoValues.SIGN_DATE ||
        new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
      if (reportDateForPlaceholder) {
        // "[DATE]" in "audit report dated [DATE]"
        ssXml = ssXml.replace(/\[DATE\]/g, xmlEsc(reportDateForPlaceholder));
        // Also ensure autoValues.REPORT_DATE is set for downstream uses (e.g. direct cell writes)
        if (!autoValues.REPORT_DATE) autoValues.REPORT_DATE = reportDateForPlaceholder;
      }
      // "[NAME OF CLIENT]" — ANX_Form3CA annexure header uses this placeholder
      if (autoValues.ENTITY_NAME) {
        ssXml = ssXml.replace(/\[NAME OF CLIENT\]/g, xmlEsc(autoValues.ENTITY_NAME));
      }
      // [APPLICABLE ACT] — saved by Form3CA tab into form_3ca_applicable_act
      const applicableAct = (eng as any).form_3ca_applicable_act
        ? ((eng as any).form_3ca_act_other_text && (eng as any).form_3ca_applicable_act === "other"
            ? (eng as any).form_3ca_act_other_text
            : (eng as any).form_3ca_applicable_act)
        : "Companies Act, 2013";
      ssXml = ssXml.replace(/\[APPLICABLE ACT\]/g, xmlEsc(applicableAct));

      zip["xl/sharedStrings.xml"] = _enc.encode(ssXml);
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
        "Cache-Control": "no-store",
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
