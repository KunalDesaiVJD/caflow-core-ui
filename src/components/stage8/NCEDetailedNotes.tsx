import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type ColPattern = "A" | "B";

interface NoteRowDef {
  id: string;
  label: string;
  indent?: number;            // 0 = none, 1 = 1 level, 2 = 2 levels
  isSectionHeader?: boolean;  // label-only row, no inputs
  isTotal?: boolean;          // auto-calculated, bold
  formulaAdd?: string[];      // row IDs to add
  formulaSub?: string[];      // row IDs to subtract
  // Pattern A only — disable LT or ST columns
  naLT?: boolean;
  naST?: boolean;
  // Pattern B only — disable both columns
  naAll?: boolean;
}

interface NoteConfig {
  noteType: string;  // DB note_type key
  title: string;     // accordion header
  pattern: ColPattern;
  rows: NoteRowDef[];
}

interface NoteData {
  cy: Record<string, number>;
  py: Record<string, number>;
}

interface Props {
  engagementId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const INDENT_CLS = ["pl-3", "pl-7", "pl-11", "pl-14"] as const;
function indentCls(level = 0) {
  return INDENT_CLS[Math.min(level, INDENT_CLS.length - 1)];
}

function parseFY(fy: string): { cy: number; py: number } {
  if (!fy) {
    const y = new Date().getFullYear();
    return { cy: y, py: y - 1 };
  }
  const parts = fy.split("-");
  if (parts.length === 2) {
    const end = parseInt(parts[1]);
    const fullEnd = end < 100 ? 2000 + end : end;
    return { cy: fullEnd, py: fullEnd - 1 };
  }
  const y = parseInt(fy) || new Date().getFullYear();
  return { cy: y, py: y - 1 };
}

/**
 * Compute auto-calculated totals from raw data.
 * Pattern B: cy[rowId], py[rowId].
 * Pattern A: cy[rowId_lt], cy[rowId_st], py[rowId_lt], py[rowId_st].
 * Rows must be ordered so that dependent totals appear after their sources.
 */
function computeDisplayData(
  config: NoteConfig,
  cy: Record<string, number>,
  py: Record<string, number>
): { cy: Record<string, number>; py: Record<string, number> } {
  const outCy = { ...cy };
  const outPy = { ...py };

  for (const row of config.rows) {
    if (!row.isTotal) continue;
    const adds = row.formulaAdd ?? [];
    const subs = row.formulaSub ?? [];

    if (config.pattern === "B") {
      let cVal = 0, pVal = 0;
      for (const id of adds) { cVal += outCy[id] ?? 0; pVal += outPy[id] ?? 0; }
      for (const id of subs) { cVal -= outCy[id] ?? 0; pVal -= outPy[id] ?? 0; }
      outCy[row.id] = Math.round(cVal * 100) / 100;
      outPy[row.id] = Math.round(pVal * 100) / 100;
    } else {
      // Pattern A — compute _lt and _st variants from base IDs
      let ltC = 0, ltP = 0, stC = 0, stP = 0;
      for (const id of adds) {
        ltC += outCy[id + "_lt"] ?? 0; ltP += outPy[id + "_lt"] ?? 0;
        stC += outCy[id + "_st"] ?? 0; stP += outPy[id + "_st"] ?? 0;
      }
      for (const id of subs) {
        ltC -= outCy[id + "_lt"] ?? 0; ltP -= outPy[id + "_lt"] ?? 0;
        stC -= outCy[id + "_st"] ?? 0; stP -= outPy[id + "_st"] ?? 0;
      }
      outCy[row.id + "_lt"] = Math.round(ltC * 100) / 100;
      outPy[row.id + "_lt"] = Math.round(ltP * 100) / 100;
      outCy[row.id + "_st"] = Math.round(stC * 100) / 100;
      outPy[row.id + "_st"] = Math.round(stP * 100) / 100;
    }
  }
  return { cy: outCy, py: outPy };
}

function fmtNum(v: number): string {
  return v !== 0 ? v.toLocaleString("en-IN") : "—";
}

// ─── Note Configs ─────────────────────────────────────────────────────────────

const NOTES_CONFIG: NoteConfig[] = [
  // ── Note A: Borrowings (Pattern A) ──────────────────────────────────────
  {
    noteType: "borrowings",
    title: "Note 3: Borrowings",
    pattern: "A",
    rows: [
      { id: "sec_hdr",           label: "Secured",                                          isSectionHeader: true },
      { id: "sec_term_bank",     label: "Term loans — Banks",                               indent: 1 },
      { id: "sec_term_fi",       label: "Term loans — Financial institutions",              indent: 1 },
      { id: "sec_term_others",   label: "Term loans — Others",                              indent: 1 },
      { id: "sec_demand_bank",   label: "Loans on demand — Banks",                          indent: 1 },
      { id: "sec_demand_other",  label: "Loans on demand — Others",                         indent: 1 },
      { id: "sec_deferred",      label: "Deferred payment liabilities",                     indent: 1 },
      { id: "sec_related",       label: "Loans from related parties",                       indent: 1 },
      { id: "sec_other",         label: "Other secured loans",                              indent: 1 },
      {
        id: "sec_total", label: "Total (A)", isTotal: true,
        formulaAdd: ["sec_term_bank","sec_term_fi","sec_term_others","sec_demand_bank",
                     "sec_demand_other","sec_deferred","sec_related","sec_other"],
      },
      { id: "unsec_hdr",           label: "Unsecured",                                        isSectionHeader: true },
      { id: "unsec_term_bank",     label: "Term loans — Banks",                               indent: 1 },
      { id: "unsec_term_fi",       label: "Term loans — Financial institutions",              indent: 1 },
      { id: "unsec_term_others",   label: "Term loans — Others",                              indent: 1 },
      { id: "unsec_demand_bank",   label: "Loans on demand — Banks",                          indent: 1 },
      { id: "unsec_demand_other",  label: "Loans on demand — Others",                         indent: 1 },
      { id: "unsec_deferred",      label: "Deferred payment liabilities",                     indent: 1 },
      { id: "unsec_related",       label: "Loans from related parties",                       indent: 1 },
      { id: "unsec_other",         label: "Other unsecured loans",                            indent: 1 },
      {
        id: "unsec_total", label: "Total (B)", isTotal: true,
        formulaAdd: ["unsec_term_bank","unsec_term_fi","unsec_term_others","unsec_demand_bank",
                     "unsec_demand_other","unsec_deferred","unsec_related","unsec_other"],
      },
      { id: "total_ab", label: "Total (A + B)", isTotal: true, formulaAdd: ["sec_total","unsec_total"] },
    ],
  },

  // ── Note B: Other Long-Term Liabilities (Pattern B) ─────────────────────
  {
    noteType: "other_lt_liab",
    title: "Note 4: Other Long-Term Liabilities",
    pattern: "B",
    rows: [
      { id: "adv_customers", label: "(a) Advance from customers" },
      { id: "others",        label: "(b) Others (please specify)" },
      { id: "total",         label: "Total", isTotal: true, formulaAdd: ["adv_customers","others"] },
    ],
  },

  // ── Note C: Provisions (Pattern A) ──────────────────────────────────────
  {
    noteType: "provisions",
    title: "Note 5 & 9: Provisions (Long-Term & Short-Term)",
    pattern: "A",
    rows: [
      { id: "gratuity",   label: "Provision for gratuity" },
      { id: "leave_enc",  label: "Provision for leave encashment" },
      { id: "income_tax", label: "Provision for income tax" },
      { id: "other_prov", label: "Other provisions" },
      { id: "specify",    label: "Others (please specify)" },
      {
        id: "total", label: "Total", isTotal: true,
        formulaAdd: ["gratuity","leave_enc","income_tax","other_prov","specify"],
      },
    ],
  },

  // ── Note D: Trade Payables (Pattern B) ──────────────────────────────────
  {
    noteType: "trade_payables",
    title: "Note 7: Trade Payables",
    pattern: "B",
    rows: [
      { id: "msme",   label: "(a) Dues to Micro and Small Enterprises (MSME)" },
      { id: "others", label: "(b) Others" },
      { id: "total",  label: "Total", isTotal: true, formulaAdd: ["msme","others"] },
    ],
  },

  // ── Note E: Other Current Liabilities (Pattern B) ───────────────────────
  {
    noteType: "other_cl",
    title: "Note 8: Other Current Liabilities",
    pattern: "B",
    rows: [
      { id: "inc_advance", label: "Income received in advance" },
      { id: "unearned",    label: "Unearned revenue" },
      { id: "gst_payable", label: "GST payable" },
      { id: "tds_payable", label: "TDS payable" },
      { id: "emp_payable", label: "Other payables — Employees" },
      { id: "tax_payable", label: "Other payables — Tax" },
      { id: "other_cl",    label: "Other payables — Others" },
      {
        id: "total", label: "Total", isTotal: true,
        formulaAdd: ["inc_advance","unearned","gst_payable","tds_payable",
                     "emp_payable","tax_payable","other_cl"],
      },
    ],
  },

  // ── Note F: Capital Work-in-Progress (Pattern B) ────────────────────────
  {
    noteType: "cwip",
    title: "Note 11: Capital Work-in-Progress",
    pattern: "B",
    rows: [
      { id: "opening",     label: "Opening balance" },
      { id: "additions",   label: "Add: Additions during the year",         indent: 1 },
      { id: "capitalized", label: "Less: Capitalised during the year",      indent: 1 },
      {
        id: "closing", label: "Closing balance", isTotal: true,
        formulaAdd: ["opening","additions"], formulaSub: ["capitalized"],
      },
    ],
  },

  // ── Note G: Non-Current Investments (Pattern A) ─────────────────────────
  {
    noteType: "investments",
    title: "Note 13: Non-Current Investments",
    pattern: "A",
    rows: [
      { id: "quot_hdr",      label: "Quoted Investments",              isSectionHeader: true },
      { id: "quot_property", label: "Investment in property",          indent: 1 },
      { id: "quot_equity",   label: "Equity shares",                   indent: 1 },
      { id: "quot_pref",     label: "Preference shares",               indent: 1 },
      { id: "quot_govt",     label: "Govt & trust securities",         indent: 1 },
      { id: "quot_deb",      label: "Debentures / bonds",              indent: 1 },
      { id: "quot_mf",       label: "Mutual funds",                    indent: 1 },
      { id: "quot_partner",  label: "Partnership interests",           indent: 1 },
      { id: "quot_other",    label: "Other NC investments",            indent: 1 },
      {
        id: "quot_total", label: "Total Quoted (A)", isTotal: true,
        formulaAdd: ["quot_property","quot_equity","quot_pref","quot_govt",
                     "quot_deb","quot_mf","quot_partner","quot_other"],
      },
      { id: "unquot_hdr",      label: "Unquoted Investments",            isSectionHeader: true },
      { id: "unquot_property", label: "Investment in property",          indent: 1 },
      { id: "unquot_equity",   label: "Equity shares",                   indent: 1 },
      { id: "unquot_pref",     label: "Preference shares",               indent: 1 },
      { id: "unquot_govt",     label: "Govt & trust securities",         indent: 1 },
      { id: "unquot_deb",      label: "Debentures / bonds",              indent: 1 },
      { id: "unquot_mf",       label: "Mutual funds",                    indent: 1 },
      { id: "unquot_partner",  label: "Partnership interests",           indent: 1 },
      { id: "unquot_other",    label: "Other NC investments",            indent: 1 },
      {
        id: "unquot_total", label: "Total Unquoted (B)", isTotal: true,
        formulaAdd: ["unquot_property","unquot_equity","unquot_pref","unquot_govt",
                     "unquot_deb","unquot_mf","unquot_partner","unquot_other"],
      },
      {
        id: "total_ab", label: "Total NC Investments (A + B)", isTotal: true,
        formulaAdd: ["quot_total","unquot_total"],
      },
    ],
  },

  // ── Note H: Loans & Advances (Pattern A) ────────────────────────────────
  {
    noteType: "loans_advances",
    title: "Note 14: Long-Term Loans and Advances",
    pattern: "A",
    rows: [
      { id: "sec_hdr",        label: "Secured",                                      isSectionHeader: true },
      { id: "sec_cap_good",   label: "Capital advances — good",                      indent: 1 },
      { id: "sec_cap_doubt",  label: "Capital advances — doubtful",                  indent: 1 },
      { id: "sec_cap_prov",   label: "Less: Provision for doubtful advances",        indent: 2 },
      { id: "sec_related",    label: "Advances to related parties",                  indent: 1 },
      { id: "sec_prepaid",    label: "Prepaid expenses",                             indent: 1 },
      { id: "sec_adv_tax",    label: "Advance tax / TDS",                            indent: 1 },
      { id: "sec_gst",        label: "GST input credit receivable",                  indent: 1 },
      { id: "sec_security",   label: "Security deposits",                            indent: 1 },
      { id: "sec_govt",       label: "Advances to government authorities",           indent: 1 },
      { id: "sec_others",     label: "Others",                                       indent: 1 },
      {
        id: "sec_total", label: "Total (A)", isTotal: true,
        formulaAdd: ["sec_cap_good","sec_cap_doubt","sec_related","sec_prepaid",
                     "sec_adv_tax","sec_gst","sec_security","sec_govt","sec_others"],
        formulaSub: ["sec_cap_prov"],
      },
      { id: "unsec_hdr",        label: "Unsecured",                                    isSectionHeader: true },
      { id: "unsec_cap_good",   label: "Capital advances — good",                      indent: 1 },
      { id: "unsec_cap_doubt",  label: "Capital advances — doubtful",                  indent: 1 },
      { id: "unsec_cap_prov",   label: "Less: Provision for doubtful advances",        indent: 2 },
      { id: "unsec_related",    label: "Advances to related parties",                  indent: 1 },
      { id: "unsec_prepaid",    label: "Prepaid expenses",                             indent: 1 },
      { id: "unsec_adv_tax",    label: "Advance tax / TDS",                            indent: 1 },
      { id: "unsec_gst",        label: "GST input credit receivable",                  indent: 1 },
      { id: "unsec_security",   label: "Security deposits",                            indent: 1 },
      { id: "unsec_govt",       label: "Advances to government authorities",           indent: 1 },
      { id: "unsec_others",     label: "Others",                                       indent: 1 },
      {
        id: "unsec_total", label: "Total (B)", isTotal: true,
        formulaAdd: ["unsec_cap_good","unsec_cap_doubt","unsec_related","unsec_prepaid",
                     "unsec_adv_tax","unsec_gst","unsec_security","unsec_govt","unsec_others"],
        formulaSub: ["unsec_cap_prov"],
      },
      {
        id: "total_ab", label: "Total (A + B)", isTotal: true,
        formulaAdd: ["sec_total","unsec_total"],
      },
    ],
  },

  // ── Note I: Other Non-Current Assets (Pattern B) ────────────────────────
  {
    noteType: "other_nc_assets",
    title: "Note 15: Other Non-Current Assets",
    pattern: "B",
    rows: [
      { id: "security_dep", label: "Security deposits" },
      { id: "prepaid",      label: "Prepaid expenses" },
      { id: "others",       label: "Others" },
      { id: "total", label: "Total", isTotal: true, formulaAdd: ["security_dep","prepaid","others"] },
    ],
  },

  // ── Note J: Inventories (Pattern B) ─────────────────────────────────────
  {
    noteType: "inventories",
    title: "Note 17: Inventories",
    pattern: "B",
    rows: [
      { id: "raw_mat",     label: "Raw materials" },
      { id: "wip",         label: "Work-in-progress" },
      { id: "finished",    label: "Finished goods" },
      { id: "stock_trade", label: "Stock-in-trade" },
      { id: "stores",      label: "Stores and spares" },
      { id: "loose_tools", label: "Loose tools" },
      { id: "others",      label: "Others" },
      {
        id: "total", label: "Total", isTotal: true,
        formulaAdd: ["raw_mat","wip","finished","stock_trade","stores","loose_tools","others"],
      },
    ],
  },

  // ── Note K: Trade Receivables (Pattern B) ───────────────────────────────
  {
    noteType: "trade_receivables",
    title: "Note 18: Trade Receivables",
    pattern: "B",
    rows: [
      { id: "ka_hdr",       label: "(A) Outstanding for less than 6 months",              isSectionHeader: true },
      { id: "ka_secured",   label: "Secured, considered good",                            indent: 1 },
      { id: "ka_unsecured", label: "Unsecured, considered good",                          indent: 1 },
      { id: "ka_doubtful",  label: "Doubtful",                                            indent: 1 },
      { id: "ka_less_prov", label: "Less: Provision for doubtful receivables",            indent: 2 },
      {
        id: "ka_total", label: "Total (A)", isTotal: true, indent: 1,
        formulaAdd: ["ka_secured","ka_unsecured","ka_doubtful"], formulaSub: ["ka_less_prov"],
      },
      { id: "kb_hdr",       label: "(B) Outstanding for more than 6 months",              isSectionHeader: true },
      { id: "kb_secured",   label: "Secured, considered good",                            indent: 1 },
      { id: "kb_unsecured", label: "Unsecured, considered good",                          indent: 1 },
      { id: "kb_doubtful",  label: "Doubtful",                                            indent: 1 },
      { id: "kb_less_prov", label: "Less: Provision for doubtful receivables",            indent: 2 },
      { id: "kb_unbilled",  label: "Unbilled receivables",                                indent: 1 },
      {
        id: "kb_total", label: "Total (B)", isTotal: true, indent: 1,
        formulaAdd: ["kb_secured","kb_unsecured","kb_doubtful","kb_unbilled"],
        formulaSub: ["kb_less_prov"],
      },
      {
        id: "total_ab", label: "Total (A + B)", isTotal: true,
        formulaAdd: ["ka_total","kb_total"],
      },
    ],
  },

  // ── Note L: Cash & Bank Balances (Pattern B) ────────────────────────────
  {
    noteType: "cash_bank",
    title: "Note 19: Cash and Bank Balances",
    pattern: "B",
    rows: [
      { id: "la_hdr",       label: "(A) Cash and Cash Equivalents",               isSectionHeader: true },
      { id: "la_current",   label: "Balance in current account",                  indent: 1 },
      { id: "la_cc",        label: "Balance in cash credit account",              indent: 1 },
      { id: "la_fd_3m",     label: "Fixed deposits with maturity < 3 months",     indent: 1 },
      { id: "la_cheques",   label: "Cheques / drafts in hand",                    indent: 1 },
      { id: "la_cash",      label: "Cash in hand",                                indent: 1 },
      {
        id: "la_total", label: "Total (A)", isTotal: true, indent: 1,
        formulaAdd: ["la_current","la_cc","la_fd_3m","la_cheques","la_cash"],
      },
      { id: "lb_hdr",       label: "(B) Other Bank Balances",                     isSectionHeader: true },
      { id: "lb_earmarked", label: "Earmarked balances (e.g., unpaid dividends)", indent: 1 },
      { id: "lb_fd_3_12",   label: "Fixed deposits with maturity 3–12 months",    indent: 1 },
      { id: "lb_margin",    label: "Margin money deposits",                        indent: 1 },
      { id: "lb_others",    label: "Others",                                       indent: 1 },
      {
        id: "lb_total", label: "Total (B)", isTotal: true, indent: 1,
        formulaAdd: ["lb_earmarked","lb_fd_3_12","lb_margin","lb_others"],
      },
      {
        id: "total_ab", label: "Total (A + B)", isTotal: true,
        formulaAdd: ["la_total","lb_total"],
      },
    ],
  },

  // ── Note M: Other Current Assets (Pattern B) ────────────────────────────
  {
    noteType: "other_ca",
    title: "Note 21: Other Current Assets",
    pattern: "B",
    rows: [
      { id: "specify", label: "Specify nature" },
      { id: "total",   label: "Total", isTotal: true, formulaAdd: ["specify"] },
    ],
  },

  // ── Note N: Revenue from Operations (Pattern B) ─────────────────────────
  {
    noteType: "revenue_ops",
    title: "Note 22: Revenue from Operations",
    pattern: "B",
    rows: [
      { id: "sale_products", label: "Sale of products" },
      { id: "sale_services", label: "Sale of services" },
      { id: "other_ops",     label: "Other operations" },
      { id: "other_op_rev",  label: "Other operating revenue" },
      { id: "other_adj",     label: "Other adjustments" },
      {
        id: "total", label: "Total", isTotal: true,
        formulaAdd: ["sale_products","sale_services","other_ops","other_op_rev","other_adj"],
      },
    ],
  },

  // ── Note O: Other Income (Pattern B) ────────────────────────────────────
  {
    noteType: "other_income",
    title: "Note 23: Other Income",
    pattern: "B",
    rows: [
      { id: "interest",     label: "Interest income" },
      { id: "dividend",     label: "Dividend income" },
      { id: "net_gain",     label: "Net gain on sale of investments" },
      { id: "other_non_op", label: "Other non-operating income" },
      {
        id: "total", label: "Total", isTotal: true,
        formulaAdd: ["interest","dividend","net_gain","other_non_op"],
      },
    ],
  },

  // ── Note P: Cost of Goods Sold (Pattern B — multi-level) ────────────────
  {
    noteType: "cogs",
    title: "Note 24: Cost of Goods Sold",
    pattern: "B",
    rows: [
      // A: Materials consumed
      { id: "pa_hdr",         label: "(A) Cost of Materials Consumed",                     isSectionHeader: true },
      { id: "raw_open",       label: "Opening stock of raw materials",                     indent: 1 },
      { id: "raw_purch",      label: "Add: Purchases of raw materials",                   indent: 2 },
      { id: "raw_close",      label: "Less: Closing stock of raw materials",              indent: 2 },
      {
        id: "raw_consumed", label: "Raw material consumed (a)", isTotal: true, indent: 1,
        formulaAdd: ["raw_open","raw_purch"], formulaSub: ["raw_close"],
      },
      { id: "pack_open",      label: "Opening stock of packing materials",                 indent: 1 },
      { id: "pack_purch",     label: "Add: Purchases of packing materials",               indent: 2 },
      { id: "pack_close",     label: "Less: Closing stock of packing materials",          indent: 2 },
      {
        id: "pack_consumed", label: "Packing material consumed (b)", isTotal: true, indent: 1,
        formulaAdd: ["pack_open","pack_purch"], formulaSub: ["pack_close"],
      },
      { id: "other_open",     label: "Opening stock of other materials",                   indent: 1 },
      { id: "other_purch",    label: "Add: Purchases of other materials",                 indent: 2 },
      { id: "other_close",    label: "Less: Closing stock of other materials",            indent: 2 },
      {
        id: "other_consumed", label: "Other material consumed (c)", isTotal: true, indent: 1,
        formulaAdd: ["other_open","other_purch"], formulaSub: ["other_close"],
      },
      {
        id: "pa_total", label: "Total (A = a + b + c)", isTotal: true,
        formulaAdd: ["raw_consumed","pack_consumed","other_consumed"],
      },
      // B: Purchases of stock-in-trade
      { id: "pb_hdr",         label: "(B) Purchases of Stock-in-Trade",                    isSectionHeader: true },
      { id: "pb_row1",        label: "Purchases (category 1)",                            indent: 1 },
      { id: "pb_row2",        label: "Purchases (category 2)",                            indent: 1 },
      { id: "pb_row3",        label: "Purchases (category 3)",                            indent: 1 },
      { id: "pb_total",       label: "Total (B)", isTotal: true, formulaAdd: ["pb_row1","pb_row2","pb_row3"] },
      // C: Changes in inventories
      { id: "pc_hdr",         label: "(C) Changes in Inventories of Finished Goods, WIP & Stock-in-Trade", isSectionHeader: true },
      { id: "pc_i_hdr",       label: "Opening Inventories (I)",                           isSectionHeader: true, indent: 1 },
      { id: "pc_open_trade",  label: "Opening: Stock-in-trade",                           indent: 2 },
      { id: "pc_open_wip",    label: "Opening: Work-in-progress",                         indent: 2 },
      { id: "pc_open_fg",     label: "Opening: Finished goods",                           indent: 2 },
      {
        id: "pc_i_total", label: "Total Opening (I)", isTotal: true, indent: 1,
        formulaAdd: ["pc_open_trade","pc_open_wip","pc_open_fg"],
      },
      { id: "pc_ii_hdr",      label: "Closing Inventories (II)",                          isSectionHeader: true, indent: 1 },
      { id: "pc_close_trade", label: "Closing: Stock-in-trade",                           indent: 2 },
      { id: "pc_close_wip",   label: "Closing: Work-in-progress",                         indent: 2 },
      { id: "pc_close_fg",    label: "Closing: Finished goods",                           indent: 2 },
      {
        id: "pc_ii_total", label: "Total Closing (II)", isTotal: true, indent: 1,
        formulaAdd: ["pc_close_trade","pc_close_wip","pc_close_fg"],
      },
      {
        id: "pc_total", label: "(Increase) / Decrease in Inventories  (C = I − II)", isTotal: true,
        formulaAdd: ["pc_i_total"], formulaSub: ["pc_ii_total"],
      },
      {
        id: "total_abc", label: "Total (A + B + C)", isTotal: true,
        formulaAdd: ["pa_total","pb_total","pc_total"],
      },
    ],
  },

  // ── Note Q: Employee Benefits Expense (Pattern B) ───────────────────────
  {
    noteType: "employee_exp",
    title: "Note 25: Employee Benefits Expense",
    pattern: "B",
    rows: [
      { id: "salaries",      label: "Salaries, wages and bonus" },
      { id: "pf",            label: "Contribution to provident fund" },
      { id: "gratuity",      label: "Gratuity" },
      { id: "staff_welfare", label: "Staff welfare expenses" },
      { id: "other_allow",   label: "Other allowances" },
      {
        id: "total", label: "Total", isTotal: true,
        formulaAdd: ["salaries","pf","gratuity","staff_welfare","other_allow"],
      },
    ],
  },

  // ── Note R: Finance Costs (Pattern B) ───────────────────────────────────
  {
    noteType: "finance_costs",
    title: "Note 26: Finance Costs",
    pattern: "B",
    rows: [
      { id: "int_bank",        label: "Interest on bank borrowings" },
      { id: "int_lease",       label: "Interest on finance leases" },
      { id: "int_other",       label: "Interest on other borrowings" },
      { id: "bank_charges",    label: "Bank charges" },
      { id: "disc_charges",    label: "Finance charges — Discounting" },
      { id: "guarantee",       label: "Finance charges — Guarantee" },
      { id: "other_fin",       label: "Finance charges — Other" },
      { id: "int_partners",    label: "Interest on partners' capital" },
      { id: "other_borrowing", label: "Other borrowing costs" },
      { id: "fx_loss",         label: "Foreign exchange loss on financing" },
      {
        id: "total", label: "Total", isTotal: true,
        formulaAdd: ["int_bank","int_lease","int_other","bank_charges","disc_charges",
                     "guarantee","other_fin","int_partners","other_borrowing","fx_loss"],
      },
    ],
  },

  // ── Note S: Other Expenses (Pattern B) ──────────────────────────────────
  {
    noteType: "other_expenses",
    title: "Note 28: Other Expenses",
    pattern: "B",
    rows: [
      { id: "stores_spares",   label: "Stores and spares consumed" },
      { id: "power",           label: "Power and fuel" },
      { id: "rent",            label: "Rent" },
      { id: "repairs_bldg",    label: "Repairs — Buildings" },
      { id: "repairs_mach",    label: "Repairs — Machinery" },
      { id: "insurance",       label: "Insurance" },
      { id: "rates_taxes",     label: "Rates and taxes" },
      { id: "labour",          label: "Labour charges" },
      { id: "travel",          label: "Travelling and conveyance" },
      { id: "auditor_rem",     label: "Auditor's remuneration" },
      { id: "printing",        label: "Printing and stationery" },
      { id: "communication",   label: "Communication expenses" },
      { id: "legal",           label: "Legal and professional charges" },
      { id: "advertisement",   label: "Advertisement" },
      { id: "biz_promotion",   label: "Business promotion expenses" },
      { id: "commission",      label: "Commission" },
      { id: "clearing_fwd",    label: "Clearing and forwarding charges" },
      { id: "ppe_loss",        label: "Loss on sale / discard of PPE" },
      { id: "fx_loss_ops",     label: "Foreign exchange loss (operations)" },
      { id: "contract_cancel", label: "Contract cancellation loss" },
      { id: "invest_loss",     label: "Loss on investments" },
      { id: "diminution",      label: "Provision for diminution in investments" },
      { id: "doubtful_debt",   label: "Provision for doubtful debts" },
      { id: "miscellaneous",   label: "Miscellaneous expenses" },
      { id: "other_exp",       label: "Other expenses" },
      {
        id: "total", label: "Total", isTotal: true,
        formulaAdd: ["stores_spares","power","rent","repairs_bldg","repairs_mach",
                     "insurance","rates_taxes","labour","travel","auditor_rem","printing",
                     "communication","legal","advertisement","biz_promotion","commission",
                     "clearing_fwd","ppe_loss","fx_loss_ops","contract_cancel","invest_loss",
                     "diminution","doubtful_debt","miscellaneous","other_exp"],
      },
    ],
  },
];

// ─── NumInput ─────────────────────────────────────────────────────────────────

function NumInput({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const [local, setLocal] = useState(value === 0 ? "" : String(value));

  useEffect(() => {
    setLocal(value === 0 ? "" : String(value));
  }, [value]);

  return (
    <Input
      type="text"
      inputMode="decimal"
      className={cn(
        "h-7 text-xs text-right px-2 py-0 w-full min-w-[80px]",
        disabled && "bg-muted/60 text-muted-foreground cursor-not-allowed"
      )}
      disabled={disabled}
      value={local}
      placeholder="—"
      onChange={e => setLocal(e.target.value)}
      onBlur={() => {
        const parsed = parseFloat(local.replace(/,/g, "")) || 0;
        setLocal(parsed === 0 ? "" : String(parsed));
        onChange(parsed);
      }}
    />
  );
}

// ─── Pattern B Table ──────────────────────────────────────────────────────────

function PatternBTable({
  config,
  cy: rawCy,
  py: rawPy,
  cyYear,
  pyYear,
  onChangeCy,
  onChangePy,
}: {
  config: NoteConfig;
  cy: Record<string, number>;
  py: Record<string, number>;
  cyYear: number;
  pyYear: number;
  onChangeCy: (key: string, v: number) => void;
  onChangePy: (key: string, v: number) => void;
}) {
  const { cy, py } = useMemo(
    () => computeDisplayData(config, rawCy, rawPy),
    [config, rawCy, rawPy]
  );

  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/40">
          <TableHead className="text-xs w-[55%]">Particulars</TableHead>
          <TableHead className="text-xs text-right w-[22.5%]">
            31 March {cyYear} (₹)
          </TableHead>
          <TableHead className="text-xs text-right w-[22.5%]">
            31 March {pyYear} (₹)
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {config.rows.map(row => {
          if (row.isSectionHeader) {
            return (
              <TableRow key={row.id} className="bg-muted/20">
                <TableCell
                  colSpan={3}
                  className={cn("text-xs font-semibold py-1.5", indentCls(row.indent))}
                >
                  {row.label}
                </TableCell>
              </TableRow>
            );
          }

          if (row.isTotal) {
            return (
              <TableRow key={row.id} className="bg-muted/10 border-t border-border/60">
                <TableCell
                  className={cn("text-xs font-semibold py-1.5", indentCls(row.indent))}
                >
                  {row.label}
                </TableCell>
                <TableCell className="text-xs text-right py-1.5 font-semibold">
                  {fmtNum(cy[row.id] ?? 0)}
                </TableCell>
                <TableCell className="text-xs text-right py-1.5 font-semibold">
                  {fmtNum(py[row.id] ?? 0)}
                </TableCell>
              </TableRow>
            );
          }

          return (
            <TableRow key={row.id} className="hover:bg-muted/10">
              <TableCell className={cn("text-xs py-1", indentCls(row.indent))}>
                {row.label}
              </TableCell>
              <TableCell className="p-1">
                <NumInput
                  value={rawCy[row.id] ?? 0}
                  onChange={v => onChangeCy(row.id, v)}
                  disabled={row.naAll}
                />
              </TableCell>
              <TableCell className="p-1">
                <NumInput
                  value={rawPy[row.id] ?? 0}
                  onChange={v => onChangePy(row.id, v)}
                  disabled={row.naAll}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// ─── Pattern A Table ──────────────────────────────────────────────────────────
// Column order (per spec): Particulars | LT CY | LT PY | ST CY | ST PY

function PatternATable({
  config,
  cy: rawCy,
  py: rawPy,
  cyYear,
  pyYear,
  onChangeCy,
  onChangePy,
}: {
  config: NoteConfig;
  cy: Record<string, number>;
  py: Record<string, number>;
  cyYear: number;
  pyYear: number;
  onChangeCy: (key: string, v: number) => void;
  onChangePy: (key: string, v: number) => void;
}) {
  const { cy, py } = useMemo(
    () => computeDisplayData(config, rawCy, rawPy),
    [config, rawCy, rawPy]
  );

  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/40">
          <TableHead rowSpan={2} className="text-xs w-[28%] align-bottom border-r">
            Particulars
          </TableHead>
          <TableHead colSpan={2} className="text-xs text-center border-r border-b-0">
            Long Term (₹)
          </TableHead>
          <TableHead colSpan={2} className="text-xs text-center border-b-0">
            Short Term (₹)
          </TableHead>
        </TableRow>
        <TableRow className="bg-muted/40">
          <TableHead className="text-xs text-right">31 Mar {cyYear}</TableHead>
          <TableHead className="text-xs text-right border-r">31 Mar {pyYear}</TableHead>
          <TableHead className="text-xs text-right">31 Mar {cyYear}</TableHead>
          <TableHead className="text-xs text-right">31 Mar {pyYear}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {config.rows.map(row => {
          if (row.isSectionHeader) {
            return (
              <TableRow key={row.id} className="bg-muted/20">
                <TableCell
                  colSpan={5}
                  className={cn("text-xs font-semibold py-1.5", indentCls(row.indent))}
                >
                  {row.label}
                </TableCell>
              </TableRow>
            );
          }

          if (row.isTotal) {
            const ltCv = cy[row.id + "_lt"] ?? 0;
            const ltPv = py[row.id + "_lt"] ?? 0;
            const stCv = cy[row.id + "_st"] ?? 0;
            const stPv = py[row.id + "_st"] ?? 0;
            return (
              <TableRow key={row.id} className="bg-muted/10 border-t border-border/60">
                <TableCell
                  className={cn("text-xs font-semibold py-1.5 border-r", indentCls(row.indent))}
                >
                  {row.label}
                </TableCell>
                <TableCell className="text-xs text-right py-1.5 font-semibold">{fmtNum(ltCv)}</TableCell>
                <TableCell className="text-xs text-right py-1.5 font-semibold border-r">{fmtNum(ltPv)}</TableCell>
                <TableCell className="text-xs text-right py-1.5 font-semibold">{fmtNum(stCv)}</TableCell>
                <TableCell className="text-xs text-right py-1.5 font-semibold">{fmtNum(stPv)}</TableCell>
              </TableRow>
            );
          }

          return (
            <TableRow key={row.id} className="hover:bg-muted/10">
              <TableCell className={cn("text-xs py-1 border-r", indentCls(row.indent))}>
                {row.label}
              </TableCell>
              {/* LT CY */}
              <TableCell className="p-1">
                <NumInput
                  value={rawCy[row.id + "_lt"] ?? 0}
                  onChange={v => onChangeCy(row.id + "_lt", v)}
                  disabled={row.naLT}
                />
              </TableCell>
              {/* LT PY */}
              <TableCell className="p-1 border-r">
                <NumInput
                  value={rawPy[row.id + "_lt"] ?? 0}
                  onChange={v => onChangePy(row.id + "_lt", v)}
                  disabled={row.naLT}
                />
              </TableCell>
              {/* ST CY */}
              <TableCell className="p-1">
                <NumInput
                  value={rawCy[row.id + "_st"] ?? 0}
                  onChange={v => onChangeCy(row.id + "_st", v)}
                  disabled={row.naST}
                />
              </TableCell>
              {/* ST PY */}
              <TableCell className="p-1">
                <NumInput
                  value={rawPy[row.id + "_st"] ?? 0}
                  onChange={v => onChangePy(row.id + "_st", v)}
                  disabled={row.naST}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function NCEDetailedNotes({ engagementId }: Props) {
  const [noteData, setNoteData]   = useState<Record<string, NoteData>>({});
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [eng, setEng]             = useState<any>(null);

  // ── Derived year labels (from self-fetched engagement) ──────────────────
  const financialYear = (eng?.financial_year as string) || "";
  const clientName    = (eng?.clients?.name  as string) || "";
  const { cy: cyYear, py: pyYear } = useMemo(() => parseFY(financialYear), [financialYear]);

  // ── Load ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!engagementId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);

      // 1. Fetch engagement — get FY and client name
      const { data: engRow } = await supabase
        .from("audit_engagements")
        .select("financial_year, clients(name), firms(*), partner:users!partner_id(name)")
        .eq("id", engagementId)
        .single();
      if (cancelled) return;
      if (engRow) setEng(engRow);

      // 2. Fetch all saved notes for this engagement
      const { data, error } = await supabase
        .from("nce_financial_notes")
        .select("note_type, cy_data, py_data")
        .eq("engagement_id", engagementId);
      if (!cancelled) {
        if (!error && data) {
          const built: Record<string, NoteData> = {};
          for (const row of data) {
            built[row.note_type] = {
              cy: (row.cy_data as Record<string, number>) || {},
              py: (row.py_data as Record<string, number>) || {},
            };
          }
          setNoteData(built);
        }
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [engagementId]);

  // ── Change handler ──────────────────────────────────────────────────────
  const handleChange = useCallback(
    (noteType: string, key: string, isCY: boolean, value: number) => {
      setNoteData(prev => {
        const cur = prev[noteType] ?? { cy: {}, py: {} };
        return isCY
          ? { ...prev, [noteType]: { ...cur, cy: { ...cur.cy, [key]: value } } }
          : { ...prev, [noteType]: { ...cur, py: { ...cur.py, [key]: value } } };
      });
    },
    []
  );

  // ── Save ────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      const rows = NOTES_CONFIG.map(nc => {
        const d = noteData[nc.noteType] ?? { cy: {}, py: {} };
        return {
          engagement_id:  engagementId,
          financial_year: financialYear,
          note_type:      nc.noteType,
          cy_data:        d.cy as any,
          py_data:        d.py as any,
          updated_at:     new Date().toISOString(),
        };
      });
      const { error } = await supabase
        .from("nce_financial_notes")
        .upsert(rows, { onConflict: "engagement_id,financial_year,note_type" });
      if (error) throw error;
      toast.success("Notes saved successfully");
    } catch (err: any) {
      toast.error(err.message || "Failed to save notes");
    } finally {
      setSaving(false);
    }
  };

  // ── Loading state ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin h-6 w-6 text-muted-foreground" />
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────
  const SaveBtn = () => (
    <Button size="sm" onClick={handleSave} disabled={saving}>
      {saving
        ? <Loader2 className="animate-spin h-4 w-4 mr-1.5" />
        : <Save className="h-4 w-4 mr-1.5" />}
      Save All Notes
    </Button>
  );

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="text-center space-y-0.5 pb-3 border-b">
        {clientName && (
          <p className="text-sm font-semibold uppercase tracking-wide">{clientName}</p>
        )}
        <p className="text-xs text-muted-foreground">
          Notes forming part of the Financial Statements for the year ended, 31st March, {cyYear}
        </p>
      </div>

      {/* Top save */}
      <div className="flex justify-end">
        <SaveBtn />
      </div>

      {/* Notes accordion — all collapsed by default */}
      <Accordion type="multiple" className="space-y-1.5">
        {NOTES_CONFIG.map(nc => {
          const d = noteData[nc.noteType] ?? { cy: {}, py: {} };
          return (
            <AccordionItem
              key={nc.noteType}
              value={nc.noteType}
              className="border rounded-lg px-4 bg-background"
            >
              <AccordionTrigger className="text-sm font-medium py-3 hover:no-underline">
                {nc.title}
              </AccordionTrigger>
              <AccordionContent className="pb-4">
                <div className="overflow-x-auto rounded border">
                  {nc.pattern === "A" ? (
                    <PatternATable
                      config={nc}
                      cy={d.cy}
                      py={d.py}
                      cyYear={cyYear}
                      pyYear={pyYear}
                      onChangeCy={(key, v) => handleChange(nc.noteType, key, true,  v)}
                      onChangePy={(key, v) => handleChange(nc.noteType, key, false, v)}
                    />
                  ) : (
                    <PatternBTable
                      config={nc}
                      cy={d.cy}
                      py={d.py}
                      cyYear={cyYear}
                      pyYear={pyYear}
                      onChangeCy={(key, v) => handleChange(nc.noteType, key, true,  v)}
                      onChangePy={(key, v) => handleChange(nc.noteType, key, false, v)}
                    />
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>

      {/* Bottom save */}
      <div className="flex justify-end pt-2">
        <SaveBtn />
      </div>
    </div>
  );
}
