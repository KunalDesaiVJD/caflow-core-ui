/**
 * Rule-spec validator — the deterministic gate for the AI Rule Composer.
 *
 * The composer lets a user describe a rule in plain English; the AI drafts a structured
 * scrutiny_rules record (usually with a generic `expr` detection_logic). Before that draft is
 * shown for review, dry-run, or applied, it passes through validateRule() here so that:
 *   - malformed drafts are rejected (not silently saved),
 *   - a draft whose `check` has no engine handler is flagged as NOT runnable,
 *   - the `expr` spec's grain / operators / aggregate / conditions are structurally sound.
 *
 * Pure + dependency-free (only imports the engine's known-check registries) → unit-testable and
 * safe to run in the browser before write.
 */

import { TIER_A_CHECK_KINDS, TIER_B_CHECK_KINDS, GENERIC_CHECK_KINDS } from "./detectionEngine";

export const KNOWN_CHECKS: ReadonlySet<string> = new Set([
  ...TIER_A_CHECK_KINDS,
  ...TIER_B_CHECK_KINDS,
  ...GENERIC_CHECK_KINDS,
]);

export const VALID_OPS: ReadonlySet<string> = new Set([
  "=", "==", ">", ">=", "<", "<=", "!=", "<>",
  "between", "contains", "not_contains", "in",
  "is_blank", "is_not_blank", "is_round",
]);
export const VALID_GRAINS: ReadonlySet<string> = new Set(["voucher", "account", "aggregate"]);
export const VALID_FNS: ReadonlySet<string> = new Set(["sum", "count", "max"]);
export const VALID_BY: ReadonlySet<string> = new Set(["party", "ledger", "day", "month", "year", "amount", "date", "voucher_type"]);
export const VALID_SEVERITY: ReadonlySet<string> = new Set(["high", "medium", "low"]);

export interface ComposedRule {
  rule_id: string;
  rule_name: string;
  category: string;
  severity: string;
  detection_level?: string;
  detection_logic: Record<string, unknown>;
  threshold_value?: number | null;
  threshold_type?: string | null;
  audit_query_template?: string | null;
  legal_reference?: string | null;
  prior_year_needed?: boolean;
}

export interface ValidationResult {
  /** true when there are zero errors (warnings are allowed) */
  valid: boolean;
  /** the engine can actually execute this rule's check */
  runnable: boolean;
  errors: string[];
  warnings: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function validateCond(c: unknown, path: string, errors: string[]): void {
  if (isObj(c) && (Array.isArray(c.all) || Array.isArray(c.any))) {
    const group = (c.all ?? c.any) as unknown[];
    group.forEach((sub, i) => validateCond(sub, `${path}.${Array.isArray(c.all) ? "all" : "any"}[${i}]`, errors));
    return;
  }
  if (!isObj(c)) { errors.push(`${path}: condition must be an object`); return; }
  if (!str(c.field)) errors.push(`${path}: missing 'field'`);
  if (!str(c.op)) errors.push(`${path}: missing 'op'`);
  else if (!VALID_OPS.has(str(c.op))) errors.push(`${path}: unknown operator '${str(c.op)}'`);
}

function validateExpr(dl: Record<string, unknown>, errors: string[], warnings: string[]): void {
  const grain = str(dl.grain) || "voucher";
  if (!VALID_GRAINS.has(grain)) errors.push(`detection_logic.grain '${grain}' is not one of voucher/account/aggregate`);

  if (dl.where !== undefined) {
    const where = dl.where;
    if (Array.isArray(where)) where.forEach((c, i) => validateCond(c, `where[${i}]`, errors));
    else validateCond(where, "where", errors);
  }

  if (grain === "aggregate") {
    if (!isObj(dl.aggregate)) {
      errors.push("aggregate grain requires an 'aggregate' object");
    } else {
      const agg = dl.aggregate as Record<string, unknown>;
      const by = Array.isArray(agg.by) ? (agg.by as unknown[]) : [];
      if (by.length === 0) errors.push("aggregate.by must list at least one grouping key");
      for (const b of by) if (!VALID_BY.has(str(b))) errors.push(`aggregate.by has unknown key '${str(b)}'`);
      if (!VALID_FNS.has(str(agg.fn))) errors.push(`aggregate.fn '${str(agg.fn)}' must be sum/count/max`);
      if (!isObj(agg.having) || !str((agg.having as Record<string, unknown>).op)) {
        errors.push("aggregate.having must be { op, value }");
      } else if (!VALID_OPS.has(str((agg.having as Record<string, unknown>).op))) {
        errors.push(`aggregate.having.op is invalid`);
      }
    }
  }

  if (dl.vs_prior_year !== undefined) {
    const vpy = dl.vs_prior_year;
    if (!isObj(vpy) || typeof vpy.pct !== "number") errors.push("vs_prior_year must be { op?, pct:number }");
    if (grain !== "account") warnings.push("vs_prior_year is evaluated on the account grain; set grain:'account'");
  }

  if (grain === "voucher" && dl.where === undefined && dl.scope === undefined) {
    warnings.push("voucher-grain expr with no scope/where will flag EVERY voucher — add a condition");
  }
}

/** Validate an AI-composed (or hand-written) rule draft. */
export function validateRule(rule: Partial<ComposedRule>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!str(rule.rule_id)) errors.push("rule_id is required");
  else if (!/^[A-Za-z]{2,8}-\d{1,4}$/.test(str(rule.rule_id))) warnings.push(`rule_id '${rule.rule_id}' does not follow the CAT-001 convention`);
  if (!str(rule.rule_name)) errors.push("rule_name is required");
  if (!str(rule.category)) errors.push("category is required");
  if (rule.severity !== undefined && !VALID_SEVERITY.has(str(rule.severity).toLowerCase())) {
    errors.push(`severity '${rule.severity}' must be high/medium/low`);
  }
  if (!str(rule.audit_query_template)) warnings.push("audit_query_template is empty — findings will use a generic message");

  const dl = rule.detection_logic;
  let runnable = false;
  if (!isObj(dl)) {
    errors.push("detection_logic must be an object");
  } else {
    const check = str(dl.check);
    if (!check) {
      errors.push("detection_logic.check (the rule kind) is required");
    } else if (!KNOWN_CHECKS.has(check)) {
      errors.push(`detection_logic.check '${check}' has no engine handler — this rule would NOT run. Use 'expr' or a supported check.`);
    } else {
      runnable = true;
      if (check === "expr") validateExpr(dl, errors, warnings);
    }
  }

  return { valid: errors.length === 0, runnable, errors, warnings };
}
