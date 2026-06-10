/**
 * Universal NCE Validator — checks the ENTIRE COA → Note chain for ALL NCE clients.
 *
 * For each engagement with COA mappings, for each NCE FS code:
 *   COA CY  = signed TB closing sum (using sign convention from fsSignConvention.ts)
 *   Note CY = computed grand total from cy_data (reproduces computeNoteTotals logic)
 *   Drift   = COA CY − Note CY
 *
 * Run: node scripts/universal-nce-validator.mjs
 * Requires: npx supabase linked to the project (uses `npx supabase db query --linked`)
 */

import { execSync } from "child_process";
import { resolve } from "path";

const PROJECT_DIR = resolve(import.meta.dirname, "..");

// ── NCE_CODE_TO_NOTE mapping (from nceAutoPopulate.ts) ──────────────────────
const NCE_CODE_TO_NOTE = {
  NCE_LTB:      { note: "borrowings",       col: "lt" },
  NCE_STB:      { note: "borrowings",       col: "st" },
  NCE_OLTL:     { note: "other_lt_liab" },
  NCE_LTP:      { note: "provisions",       col: "lt" },
  NCE_STP:      { note: "provisions",       col: "st" },
  NCE_TP:       { note: "trade_payables" },
  NCE_OCL:      { note: "other_cl" },
  NCE_CWIP:     { note: "cwip" },
  NCE_NCINV:    { note: "investments",      col: "lt" },
  NCE_CINV:     { note: "investments",      col: "st" },
  NCE_LTLA:     { note: "loans_advances",   col: "lt" },
  NCE_STLA:     { note: "loans_advances",   col: "st" },
  NCE_ONCA:     { note: "other_nc_assets" },
  NCE_STCK:     { note: "inventories" },
  NCE_TR:       { note: "trade_receivables" },
  NCE_CASH:     { note: "cash_bank" },
  NCE_OCA:      { note: "other_ca" },
  NCE_REV_OPS:  { note: "revenue_ops" },
  NCE_REV_OTH:  { note: "other_income" },
  NCE_COGS:     { note: "cogs", config: "cogs_a" },
  NCE_CII:      { note: "cogs", config: "cogs_c" },
  NCE_EMP_EXP:  { note: "employee_exp" },
  NCE_FIN_COST: { note: "finance_costs" },
  NCE_OTH_EXP:  { note: "other_expenses" },
};

// ── Note natural side (from fsSignConvention.ts) ────────────────────────────
const NOTE_NATURE = {
  borrowings:       "CR",
  other_lt_liab:    "CR",
  provisions:       "CR",
  trade_payables:   "CR",
  other_cl:         "CR",
  revenue_ops:      "CR",
  other_income:     "CR",
  cwip:             "DR",
  investments:      "DR",
  loans_advances:   "DR",
  other_nc_assets:  "DR",
  inventories:      "DR",
  trade_receivables:"DR",
  cash_bank:        "DR",
  other_ca:         "DR",
  cogs:             "DR",
  employee_exp:     "DR",
  finance_costs:    "DR",
  other_expenses:   "DR",
};

// ── FS_CODE_NATURE (for COA side) ───────────────────────────────────────────
const FS_CODE_NATURE = {
  NCE_PCAP:"CR", NCE_RES:"CR", NCE_NCB:"CR", NCE_CAP:"CR",
  NCE_LTB:"CR", NCE_STB:"CR", NCE_OLTL:"CR", NCE_LTP:"CR", NCE_STP:"CR",
  NCE_TP:"CR", NCE_OCL:"CR",
  NCE_CWIP:"DR", NCE_NCINV:"DR", NCE_CINV:"DR", NCE_LTLA:"DR", NCE_STLA:"DR",
  NCE_ONCA:"DR", NCE_STCK:"DR", NCE_TR:"DR", NCE_CASH:"DR", NCE_OCA:"DR",
  NCE_REV_OPS:"CR", NCE_REV_OTH:"CR",
  NCE_COGS:"DR", NCE_CII:"DR", NCE_EMP_EXP:"DR", NCE_FIN_COST:"DR", NCE_OTH_EXP:"DR",
};

// ── Note configs (simplified for grand total computation) ───────────────────
// Each config defines rows with formulaAdd/Sub for isTotal rows.
// The grand total is the LAST isTotal row.
const NOTES_CONFIG = {
  borrowings: {
    pattern: "A",
    rows: [
      { id: "sec_term_bank" }, { id: "sec_term_fi" }, { id: "sec_term_others" },
      { id: "sec_demand_bank" }, { id: "sec_demand_other" }, { id: "sec_deferred" },
      { id: "sec_related" }, { id: "sec_other" },
      { id: "sec_total", isTotal: true, sectionTag: "secured",
        formulaAdd: ["sec_term_bank","sec_term_fi","sec_term_others","sec_demand_bank",
                     "sec_demand_other","sec_deferred","sec_related","sec_other"] },
      { id: "unsec_term_bank" }, { id: "unsec_term_fi" }, { id: "unsec_term_others" },
      { id: "unsec_demand_bank" }, { id: "unsec_demand_other" }, { id: "unsec_deferred" },
      { id: "unsec_related" }, { id: "unsec_other" },
      { id: "unsec_total", isTotal: true, sectionTag: "unsecured",
        formulaAdd: ["unsec_term_bank","unsec_term_fi","unsec_term_others","unsec_demand_bank",
                     "unsec_demand_other","unsec_deferred","unsec_related","unsec_other"] },
      { id: "total_ab", isTotal: true, formulaAdd: ["sec_total","unsec_total"] },
    ],
  },
  other_lt_liab: {
    pattern: "B",
    rows: [
      { id: "adv_customers" }, { id: "others" },
      { id: "total", isTotal: true, formulaAdd: ["adv_customers","others"] },
    ],
  },
  provisions: {
    pattern: "A",
    rows: [
      { id: "income_tax" }, { id: "other_prov" },
      { id: "total", isTotal: true, formulaAdd: ["income_tax","other_prov"] },
    ],
  },
  trade_payables: {
    pattern: "B",
    rows: [
      { id: "msme" }, { id: "others" },
      { id: "total", isTotal: true, formulaAdd: ["msme","others"] },
    ],
  },
  other_cl: {
    pattern: "B",
    rows: [
      { id: "inc_advance" }, { id: "unearned" }, { id: "gst_payable" },
      { id: "tds_payable" }, { id: "emp_payable" }, { id: "tax_payable" },
      { id: "other_cl" }, { id: "rev_pcos" }, { id: "adv_members" },
      { id: "total", isTotal: true,
        formulaAdd: ["inc_advance","unearned","gst_payable","tds_payable",
                     "emp_payable","tax_payable","other_cl","rev_pcos","adv_members"] },
    ],
  },
  cwip: {
    pattern: "B",
    rows: [
      { id: "opening" }, { id: "additions" }, { id: "capitalized" },
      { id: "closing", isTotal: true,
        formulaAdd: ["opening","additions"], formulaSub: ["capitalized"] },
    ],
  },
  investments: {
    pattern: "A",
    rows: [
      { id: "quot_property" }, { id: "quot_equity" }, { id: "quot_pref" },
      { id: "quot_govt" }, { id: "quot_deb" }, { id: "quot_mf" },
      { id: "quot_partner" }, { id: "quot_other" },
      { id: "quot_total", isTotal: true,
        formulaAdd: ["quot_property","quot_equity","quot_pref","quot_govt",
                     "quot_deb","quot_mf","quot_partner","quot_other"] },
      { id: "unquot_property" }, { id: "unquot_equity" }, { id: "unquot_pref" },
      { id: "unquot_govt" }, { id: "unquot_deb" }, { id: "unquot_mf" },
      { id: "unquot_partner" }, { id: "unquot_other" },
      { id: "unquot_total", isTotal: true,
        formulaAdd: ["unquot_property","unquot_equity","unquot_pref","unquot_govt",
                     "unquot_deb","unquot_mf","unquot_partner","unquot_other"] },
      { id: "total_ab", isTotal: true, formulaAdd: ["quot_total","unquot_total"] },
    ],
  },
  loans_advances: {
    pattern: "A",
    rows: [
      { id: "sec_cap_good" }, { id: "sec_cap_doubt" }, { id: "sec_cap_prov" },
      { id: "sec_related" }, { id: "sec_prepaid" }, { id: "sec_adv_tax" },
      { id: "sec_gst" }, { id: "sec_security" }, { id: "sec_govt" }, { id: "sec_others" },
      { id: "sec_total", isTotal: true, sectionTag: "secured",
        formulaAdd: ["sec_cap_good","sec_cap_doubt","sec_related","sec_prepaid",
                     "sec_adv_tax","sec_gst","sec_security","sec_govt","sec_others"],
        formulaSub: ["sec_cap_prov"] },
      { id: "unsec_cap_good" }, { id: "unsec_cap_doubt" }, { id: "unsec_cap_prov" },
      { id: "unsec_related" }, { id: "unsec_prepaid" }, { id: "unsec_adv_tax" },
      { id: "unsec_gst" }, { id: "unsec_security" }, { id: "unsec_govt" }, { id: "unsec_others" },
      { id: "unsec_total", isTotal: true, sectionTag: "unsecured",
        formulaAdd: ["unsec_cap_good","unsec_cap_doubt","unsec_related","unsec_prepaid",
                     "unsec_adv_tax","unsec_gst","unsec_security","unsec_govt","unsec_others"],
        formulaSub: ["unsec_cap_prov"] },
      { id: "total_ab", isTotal: true, formulaAdd: ["sec_total","unsec_total"] },
    ],
  },
  other_nc_assets: {
    pattern: "B",
    rows: [
      { id: "security_dep" }, { id: "prepaid" }, { id: "others" },
      { id: "total", isTotal: true, formulaAdd: ["security_dep","prepaid","others"] },
    ],
  },
  inventories: {
    pattern: "B",
    rows: [
      { id: "raw_mat" }, { id: "wip" }, { id: "finished" }, { id: "stock_trade" },
      { id: "stores" }, { id: "loose_tools" }, { id: "others" },
      { id: "total", isTotal: true,
        formulaAdd: ["raw_mat","wip","finished","stock_trade","stores","loose_tools","others"] },
    ],
  },
  trade_receivables: {
    pattern: "B",
    rows: [
      { id: "ka_secured" }, { id: "ka_unsecured" }, { id: "ka_doubtful" }, { id: "ka_less_prov" },
      { id: "ka_total", isTotal: true,
        formulaAdd: ["ka_secured","ka_unsecured","ka_doubtful"], formulaSub: ["ka_less_prov"] },
      { id: "kb_secured" }, { id: "kb_unsecured" }, { id: "kb_doubtful" }, { id: "kb_less_prov" },
      { id: "kb_unbilled" },
      { id: "kb_total", isTotal: true,
        formulaAdd: ["kb_secured","kb_unsecured","kb_doubtful","kb_unbilled"],
        formulaSub: ["kb_less_prov"] },
      { id: "total_ab", isTotal: true, formulaAdd: ["ka_total","kb_total"] },
    ],
  },
  cash_bank: {
    pattern: "B",
    rows: [
      { id: "la_current" }, { id: "la_cc" }, { id: "la_fd_3m" },
      { id: "la_cheques" }, { id: "la_cash" },
      { id: "total", isTotal: true,
        formulaAdd: ["la_current","la_cc","la_fd_3m","la_cheques","la_cash"] },
    ],
  },
  other_ca: {
    pattern: "B",
    rows: [
      { id: "specify" },
      { id: "total", isTotal: true, formulaAdd: ["specify"] },
    ],
  },
  revenue_ops: {
    pattern: "B",
    rows: [
      { id: "sale_products" }, { id: "less_sale_return" }, { id: "less_drcr_prod" },
      { id: "net_sale_products", isTotal: true,
        formulaAdd: ["sale_products"], formulaSub: ["less_sale_return","less_drcr_prod"] },
      { id: "sale_services" }, { id: "less_drcr_svc" },
      { id: "net_sale_services", isTotal: true,
        formulaAdd: ["sale_services"], formulaSub: ["less_drcr_svc"] },
      { id: "other_op_rev" }, { id: "other_adj" },
      { id: "total", isTotal: true,
        formulaAdd: ["net_sale_products","net_sale_services","other_op_rev","other_adj"] },
    ],
  },
  other_income: {
    pattern: "B",
    rows: [
      { id: "bank_interest" }, { id: "other_interest" },
      { id: "total_interest", isTotal: true,
        formulaAdd: ["bank_interest","other_interest"] },
      { id: "dividend" }, { id: "net_gain" }, { id: "other_non_op" },
      { id: "total", isTotal: true,
        formulaAdd: ["total_interest","dividend","net_gain","other_non_op"] },
    ],
  },
  cogs: {
    pattern: "B",
    rows: [
      { id: "raw_open" }, { id: "raw_purch" }, { id: "raw_close" },
      { id: "raw_consumed", isTotal: true,
        formulaAdd: ["raw_open","raw_purch"], formulaSub: ["raw_close"] },
      { id: "pack_open" }, { id: "pack_purch" }, { id: "pack_close" },
      { id: "pack_consumed", isTotal: true,
        formulaAdd: ["pack_open","pack_purch"], formulaSub: ["pack_close"] },
      { id: "other_open" }, { id: "other_purch" }, { id: "other_close" },
      { id: "other_consumed", isTotal: true,
        formulaAdd: ["other_open","other_purch"], formulaSub: ["other_close"] },
      { id: "pa_total", isTotal: true,
        formulaAdd: ["raw_consumed","pack_consumed","other_consumed"] },
      { id: "pb_row1" }, { id: "pb_row2" }, { id: "pb_row3" },
      { id: "pb_total", isTotal: true, formulaAdd: ["pb_row1","pb_row2","pb_row3"] },
      { id: "pc_open_trade" }, { id: "pc_open_wip" }, { id: "pc_open_fg" },
      { id: "pc_i_total", isTotal: true,
        formulaAdd: ["pc_open_trade","pc_open_wip","pc_open_fg"] },
      { id: "pc_close_trade" }, { id: "pc_close_wip" }, { id: "pc_close_fg" },
      { id: "pc_ii_total", isTotal: true,
        formulaAdd: ["pc_close_trade","pc_close_wip","pc_close_fg"] },
      { id: "pc_total", isTotal: true,
        formulaAdd: ["pc_i_total"], formulaSub: ["pc_ii_total"] },
      { id: "total_abc", isTotal: true,
        formulaAdd: ["pa_total","pb_total","pc_total"] },
    ],
  },
  employee_exp: {
    pattern: "B",
    rows: [
      { id: "salaries" }, { id: "pf" }, { id: "gratuity" },
      { id: "staff_welfare" }, { id: "other_allow" },
      { id: "total", isTotal: true,
        formulaAdd: ["salaries","pf","gratuity","staff_welfare","other_allow"] },
    ],
  },
  finance_costs: {
    pattern: "B",
    rows: [
      { id: "int_bank" }, { id: "int_lease" }, { id: "int_other" },
      { id: "bank_charges" }, { id: "disc_charges" }, { id: "guarantee" },
      { id: "other_fin" }, { id: "int_partners" }, { id: "other_borrowing" }, { id: "fx_loss" },
      { id: "total", isTotal: true,
        formulaAdd: ["int_bank","int_lease","int_other","bank_charges","disc_charges",
                     "guarantee","other_fin","int_partners","other_borrowing","fx_loss"] },
    ],
  },
  other_expenses: {
    pattern: "B",
    rows: [
      { id: "advertisement" }, { id: "auditor_rem" }, { id: "biz_promotion" },
      { id: "clearing_fwd" }, { id: "commission" }, { id: "communication" },
      { id: "contract_cancel" }, { id: "fx_loss_ops" }, { id: "insurance" },
      { id: "labour" }, { id: "legal" }, { id: "invest_loss" }, { id: "ppe_loss" },
      { id: "miscellaneous" }, { id: "other_exp" }, { id: "power" }, { id: "printing" },
      { id: "diminution" }, { id: "doubtful_debt" }, { id: "rates_taxes" }, { id: "rent" },
      { id: "repairs_bldg" }, { id: "repairs_mach" }, { id: "stores_spares" }, { id: "travel" },
      { id: "total", isTotal: true,
        formulaAdd: ["stores_spares","power","rent","repairs_bldg","repairs_mach",
                     "insurance","rates_taxes","labour","travel","auditor_rem","printing",
                     "communication","legal","advertisement","biz_promotion","commission",
                     "clearing_fwd","ppe_loss","fx_loss_ops","contract_cancel","invest_loss",
                     "diminution","doubtful_debt","miscellaneous","other_exp"] },
    ],
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const META_KEYS = new Set(["_custom_rows", "_ejected_ledgers", "_hidden_rows",
  "_label_overrides", "_cy_sources"]);

function dbQuery(sql) {
  // Collapse multiline SQL to single line for shell compatibility
  const oneLine = sql.replace(/\s+/g, " ").trim();
  const escaped = oneLine.replace(/"/g, '\\"');
  const raw = execSync(
    `npx supabase db query --linked "${escaped}"`,
    { cwd: PROJECT_DIR, encoding: "utf8", maxBuffer: 50 * 1024 * 1024, timeout: 60000 }
  );
  const parsed = JSON.parse(raw.substring(raw.indexOf("{")));
  return parsed.rows || [];
}

function signedBalance(amount, balanceType, nature) {
  const cb = Math.abs(Number(amount ?? 0));
  if (cb === 0) return 0;
  const side = String(balanceType ?? "").trim().toUpperCase();
  if (!side || (side !== "DR" && side !== "CR"))
    return nature === "CR" ? +cb : -cb;
  return side === nature ? +cb : -cb;
}

/**
 * Reproduce computeNoteTotals for a single note, returning grand total CY.
 * For Pattern A, returns { lt, st } separate totals.
 * For Pattern B, returns a single total.
 */
function computeNoteTotal(noteType, cyData) {
  const config = NOTES_CONFIG[noteType];
  if (!config) return null;

  const customRows = Array.isArray(cyData._custom_rows) ? cyData._custom_rows : [];

  // Build numeric maps (strip meta keys)
  const rawCy = {};
  for (const [k, v] of Object.entries(cyData)) {
    if (META_KEYS.has(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) rawCy[k] = v;
  }

  // Build child-index
  const childrenOf = {};
  const crById = {};
  for (const cr of customRows) {
    crById[cr.id] = cr;
    if (cr.attachedTo) {
      (childrenOf[cr.attachedTo] ||= []).push(cr);
    }
  }

  const grandTotalRow = [...config.rows].reverse().find(r => r.isTotal);
  const grandTotalId = grandTotalRow?.id ?? null;

  if (config.pattern === "B") {
    const perRow = {};

    const aggregate = (id, seen) => {
      if (seen.has(id)) return 0;
      seen.add(id);
      let c = rawCy[id] ?? 0;
      const hasDescendants = (childrenOf[id] ?? []).length > 0;
      // Skip sources when row has children (prevents double-count)
      const self = crById[id];
      if (!hasDescendants && self?.sources?.length > 0) {
        const srcCy = self.sources.reduce((s, x) => s + (Number(x?.amountCy) || 0), 0);
        if ((rawCy[id] ?? 0) === 0) c += srcCy;
      }
      for (const child of childrenOf[id] ?? []) {
        c += aggregate(child.id, seen);
      }
      return c;
    };

    // Non-total rows
    for (const row of config.rows) {
      if (row.isTotal) continue;
      perRow[row.id] = aggregate(row.id, new Set());
    }
    for (const cr of customRows) {
      if (!(cr.id in perRow)) perRow[cr.id] = aggregate(cr.id, new Set());
    }

    // Total rows (formula-driven)
    for (const row of config.rows) {
      if (!row.isTotal) continue;
      const adds = row.formulaAdd ?? [];
      const subs = row.formulaSub ?? [];

      let extras = [];
      if (row.sectionTag) {
        extras = customRows.filter(cr => cr.section === row.sectionTag && !cr.attachedTo);
      } else if (row.id === grandTotalId) {
        extras = customRows.filter(cr => !cr.section && !cr.attachedTo);
      }

      let val = 0;
      for (const id of adds) {
        val += perRow[id] ?? rawCy[id] ?? 0;
      }
      for (const id of subs) {
        val -= perRow[id] ?? rawCy[id] ?? 0;
      }
      for (const cr of extras) {
        val += perRow[cr.id] ?? aggregate(cr.id, new Set());
      }

      perRow[row.id] = Math.round(val * 100) / 100;
    }

    return { total: grandTotalId ? (perRow[grandTotalId] ?? 0) : 0, perRow };
  }

  // Pattern A — LT/ST split
  const lookupSuffixed = (id) => {
    const ltKey = id + "_lt", stKey = id + "_st";
    const hasLt = ltKey in rawCy;
    const hasSt = stKey in rawCy;
    const useBare = !hasLt && !hasSt;
    return {
      lt: rawCy[ltKey] ?? (useBare ? rawCy[id] ?? 0 : 0),
      st: rawCy[stKey] ?? 0,
    };
  };

  const perRow = {};

  const aggregate = (id, seen) => {
    if (seen.has(id)) return { lt: 0, st: 0 };
    seen.add(id);
    const v = lookupSuffixed(id);
    let ltC = v.lt, stC = v.st;
    const hasDescendants = (childrenOf[id] ?? []).length > 0;
    // Skip sources when row has children (prevents double-count)
    const self = crById[id];
    if (!hasDescendants && self?.sources?.length > 0) {
      for (const x of self.sources) {
        const aC = Number(x?.amountCy) || 0;
        if (x?.column === "st") {
          if ((rawCy[id + "_st"] ?? 0) === 0) stC += aC;
        } else {
          if ((rawCy[id + "_lt"] ?? 0) === 0) ltC += aC;
        }
      }
    }
    for (const child of childrenOf[id] ?? []) {
      const r = aggregate(child.id, seen);
      ltC += r.lt; stC += r.st;
    }
    return { lt: ltC, st: stC };
  };

  for (const row of config.rows) {
    if (row.isTotal) continue;
    perRow[row.id] = aggregate(row.id, new Set());
  }
  for (const cr of customRows) {
    if (!(cr.id in perRow)) perRow[cr.id] = aggregate(cr.id, new Set());
  }

  for (const row of config.rows) {
    if (!row.isTotal) continue;
    const adds = row.formulaAdd ?? [];
    const subs = row.formulaSub ?? [];

    let extras = [];
    if (row.sectionTag) {
      extras = customRows.filter(cr => cr.section === row.sectionTag && !cr.attachedTo);
    } else if (row.id === grandTotalId) {
      extras = customRows.filter(cr => !cr.section && !cr.attachedTo);
    }

    let ltC = 0, stC = 0;
    for (const id of adds) {
      const v = perRow[id] ?? lookupSuffixed(id);
      ltC += v.lt; stC += v.st;
    }
    for (const id of subs) {
      const v = perRow[id] ?? lookupSuffixed(id);
      ltC -= v.lt; stC -= v.st;
    }
    for (const cr of extras) {
      const r = perRow[cr.id] ?? aggregate(cr.id, new Set());
      ltC += r.lt; stC += r.st;
    }

    perRow[row.id] = {
      lt: Math.round(ltC * 100) / 100,
      st: Math.round(stC * 100) / 100,
    };
  }

  const gt = grandTotalId ? (perRow[grandTotalId] ?? { lt: 0, st: 0 }) : { lt: 0, st: 0 };
  return { lt: gt.lt, st: gt.st, perRow };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Universal NCE Validator ===\n");

  // Step 1: Find all NCE engagements with COA mappings containing NCE codes
  console.log("Step 1: Finding all NCE engagements with COA mappings...");
  const engRows = dbQuery(`
    SELECT ae.id as engagement_id, c.name as client_name
    FROM audit_engagements ae
    JOIN clients c ON c.id = ae.client_id
    WHERE ae.coa_mapping IS NOT NULL
    AND ae.coa_mapping::text LIKE '%NCE_%'
    ORDER BY c.name
  `);

  console.log(`Found ${engRows.length} NCE engagements with COA mappings.\n`);

  const allResults = [];
  let cleanCount = 0;
  let driftCount = 0;

  for (const eng of engRows) {
    const engId = eng.engagement_id;
    const clientName = eng.client_name;
    console.log(`--- Checking: ${clientName} (${engId}) ---`);

    // Step 2: Fetch TB data (paginated at 1000)
    let allTb = [];
    let offset = 0;
    const PAGE_SIZE = 1000;
    while (true) {
      const tbRows = dbQuery(`
        SELECT ledger_name, closing_balance, balance_type
        FROM tally_trial_balance
        WHERE engagement_id = '${engId}'
        ORDER BY ledger_name
        LIMIT ${PAGE_SIZE} OFFSET ${offset}
      `);
      allTb.push(...tbRows);
      if (tbRows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    if (allTb.length === 0) {
      console.log(`  SKIP - no TB data`);
      continue;
    }

    // Step 3: Fetch COA mapping from audit_engagements.coa_mapping JSONB
    const coaRows = dbQuery(`
      SELECT kv.key as ledger_name, kv.value->>'code' as fs_code
      FROM audit_engagements ae, jsonb_each(ae.coa_mapping) kv
      WHERE ae.id = '${engId}'
      AND kv.value->>'code' LIKE 'NCE_%'
    `);

    if (coaRows.length === 0) {
      console.log(`  SKIP - no NCE COA mappings`);
      continue;
    }

    // Build ledger -> code map
    const ledgerToCode = {};
    for (const m of coaRows) {
      ledgerToCode[m.ledger_name] = m.fs_code;
    }

    // Step 4: Compute COA CY per FS code (signed)
    const coaCy = {};
    for (const row of allTb) {
      const code = ledgerToCode[row.ledger_name];
      if (!code) continue;
      const nature = FS_CODE_NATURE[code];
      if (!nature) continue;
      const signed = signedBalance(row.closing_balance, row.balance_type, nature);
      coaCy[code] = (coaCy[code] || 0) + signed;
    }

    // Step 5: Fetch note data
    const noteRows = dbQuery(`
      SELECT note_type, cy_data
      FROM nce_financial_notes
      WHERE engagement_id = '${engId}'
    `);

    const noteDataByType = {};
    for (const nr of noteRows) {
      noteDataByType[nr.note_type] = nr.cy_data || {};
    }

    // Step 6: For each FS code in NCE_CODE_TO_NOTE, compute drift
    const engDrifts = [];
    for (const [code, mapping] of Object.entries(NCE_CODE_TO_NOTE)) {
      const coaVal = Math.round((coaCy[code] || 0) * 100) / 100;
      const noteType = mapping.note;
      const cyData = noteDataByType[noteType];

      if (!cyData) {
        // No note data at all
        if (Math.abs(coaVal) > 1) {
          engDrifts.push({ code, coaCy: coaVal, noteCy: 0, drift: coaVal, reason: "no note data" });
        }
        continue;
      }

      const result = computeNoteTotal(noteType, cyData);
      if (!result) continue;

      let noteCy = 0;
      // COGS split: NCE_COGS reads pa_total, NCE_CII reads pc_total
      const configKey = mapping.config;
      if (configKey === "cogs_a" && result.perRow?.["pa_total"] !== undefined) {
        noteCy = result.perRow["pa_total"];
      } else if (configKey === "cogs_c" && result.perRow?.["pc_total"] !== undefined) {
        noteCy = result.perRow["pc_total"];
      } else if (mapping.col === "lt") {
        noteCy = result.lt ?? result.total ?? 0;
      } else if (mapping.col === "st") {
        noteCy = result.st ?? result.total ?? 0;
      } else {
        noteCy = result.total ?? ((result.lt ?? 0) + (result.st ?? 0));
      }
      noteCy = Math.round(noteCy * 100) / 100;

      const drift = Math.round((coaVal - noteCy) * 100) / 100;
      if (Math.abs(drift) > 1) {
        engDrifts.push({ code, coaCy: coaVal, noteCy, drift });
      }
    }

    if (engDrifts.length === 0) {
      console.log(`  CLEAN - zero drift across all codes`);
      cleanCount++;
    } else {
      console.log(`  DRIFT DETECTED in ${engDrifts.length} code(s):`);
      for (const d of engDrifts) {
        const formatted = new Intl.NumberFormat("en-IN").format(Math.abs(d.drift));
        console.log(`    ${d.code}: COA=${d.coaCy}, Note=${d.noteCy}, Drift=${d.drift >= 0 ? "+" : "-"}${formatted}${d.reason ? ` (${d.reason})` : ""}`);
      }
      driftCount++;
      allResults.push({ clientName, engId, drifts: engDrifts });
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("\n========================================");
  console.log("SUMMARY");
  console.log("========================================");
  console.log(`Total engagements checked: ${engRows.length}`);
  console.log(`CLEAN (zero drift):        ${cleanCount}`);
  console.log(`WITH DRIFT:                ${driftCount}`);

  if (allResults.length > 0) {
    console.log("\n--- Full Drift Details ---");
    for (const r of allResults) {
      console.log(`\n${r.clientName}:`);
      for (const d of r.drifts) {
        const formatted = new Intl.NumberFormat("en-IN").format(Math.abs(d.drift));
        console.log(`  ${d.code}: drift = ${d.drift >= 0 ? "+" : "-"}Rs.${formatted}${d.reason ? ` (${d.reason})` : ""}`);
      }
    }
  }

  // ── Filtered summary (exclude NCE_CII, no-note-data, and < Rs.100 drift) ──
  console.log("\n========================================");
  console.log("ACTIONABLE DRIFT (excl NCE_CII, no-note-data, <Rs.100)");
  console.log("========================================");
  let actionableCount = 0;
  for (const r of allResults) {
    const actionable = r.drifts.filter(d =>
      d.code !== "NCE_CII" && !d.reason && Math.abs(d.drift) >= 100
    );
    if (actionable.length > 0) {
      actionableCount++;
      console.log(`\n${r.clientName}:`);
      for (const d of actionable) {
        const formatted = new Intl.NumberFormat("en-IN").format(Math.abs(d.drift));
        console.log(`  ${d.code}: COA=${d.coaCy}, Note=${d.noteCy}, drift=${d.drift >= 0 ? "+" : "-"}Rs.${formatted}`);
      }
    }
  }
  if (actionableCount === 0) {
    console.log("  None! All engagements are clean (excluding NCE_CII).");
  } else {
    console.log(`\nTotal engagements with actionable drift: ${actionableCount}`);
  }

  console.log("\n=== Validation complete ===");
}

main().catch(console.error);
