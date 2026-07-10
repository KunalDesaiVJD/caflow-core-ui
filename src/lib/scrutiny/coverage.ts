/**
 * Pure grouping + coverage helpers for the templates-first Scrutiny view.
 *
 * "Which rules are auto-verified" is taken from the engine's OWN handler registry
 * (`TIER_A_CHECK_KINDS` + `TIER_B_CHECK_KINDS`) — reused, never re-listed — so the UI's
 * notion of coverage can never drift from what `run-scrutiny-v2` actually executes.
 * `detection_logic` parsing reuses `parseDetectionLogic` from the adapters.
 *
 * Framing is ADVISORY only (canonical decision #8): coverage is shown to the auditor,
 * it never blocks sign-off / UDIN.
 *
 * Pure + dependency-free (no React / Supabase) → unit-testable without a DB.
 */

import { TIER_A_CHECK_KINDS, TIER_B_CHECK_KINDS } from "./detectionEngine";
import { parseDetectionLogic } from "./adapters";
import type { Finding, RuleTemplate } from "./scrutinyUi";

/** The check kinds the deterministic engine can auto-verify (reused from the engine registry). */
export const HANDLED_CHECK_KINDS: ReadonlySet<string> = new Set<string>([
  ...TIER_A_CHECK_KINDS,
  ...TIER_B_CHECK_KINDS,
]);

/** The `detection_logic.check` kind for a rule (tolerant of object | JSON string | null). */
export function ruleCheckKind(rule: RuleTemplate): string {
  return String(parseDetectionLogic(rule.detection_logic)?.check ?? "");
}

/** True when the engine has a handler for this rule's check kind. */
export function isAutoChecked(rule: RuleTemplate): boolean {
  return HANDLED_CHECK_KINDS.has(ruleCheckKind(rule));
}

export type TemplateStatus = "hits" | "clean" | "advisory";

export interface TemplateGroup {
  rule: RuleTemplate;
  checkKind: string;
  auto: boolean;
  findings: Finding[];
  hitCount: number;
  high: number;
  medium: number;
  low: number;
  status: TemplateStatus;
}

const sevOf = (f: Finding): string => (f.severity ?? "").toUpperCase();

/**
 * Join findings onto every rule in the catalogue.
 * - `hits`     → rule produced ≥1 finding
 * - `clean`    → rule is auto-checked and produced 0 findings (evidence the check ran, nothing found)
 * - `advisory` → rule has no engine handler (manual review; v2 emits no finding row for it)
 */
export function groupByTemplate(rules: RuleTemplate[], findings: Finding[]): TemplateGroup[] {
  const byRule = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = f.rule_id ?? "";
    if (!key) continue;
    const arr = byRule.get(key);
    if (arr) arr.push(f);
    else byRule.set(key, [f]);
  }

  return rules.map((rule) => {
    const fs = byRule.get(rule.rule_id) ?? [];
    const auto = isAutoChecked(rule);
    const high = fs.filter((f) => sevOf(f) === "HIGH").length;
    const medium = fs.filter((f) => sevOf(f) === "MEDIUM").length;
    const low = fs.filter((f) => sevOf(f) === "LOW").length;
    const status: TemplateStatus = fs.length > 0 ? "hits" : auto ? "clean" : "advisory";
    return {
      rule,
      checkKind: ruleCheckKind(rule),
      auto,
      findings: fs,
      hitCount: fs.length,
      high,
      medium,
      low,
      status,
    };
  });
}

export interface CategoryGroup {
  category: string;
  templates: TemplateGroup[];
  hitCount: number;
  high: number;
  medium: number;
  low: number;
  autoCount: number;
  advisoryCount: number;
  cleanCount: number;
}

/** Roll template groups up by their `category`, sorted by hit count (busiest first), then name. */
export function groupByCategory(groups: TemplateGroup[]): CategoryGroup[] {
  const byCat = new Map<string, TemplateGroup[]>();
  for (const g of groups) {
    const cat = (g.rule.category ?? "").trim() || "Uncategorised";
    const arr = byCat.get(cat);
    if (arr) arr.push(g);
    else byCat.set(cat, [g]);
  }

  const cats: CategoryGroup[] = [];
  for (const [category, templates] of byCat) {
    cats.push({
      category,
      templates,
      hitCount: templates.reduce((s, t) => s + t.hitCount, 0),
      high: templates.reduce((s, t) => s + t.high, 0),
      medium: templates.reduce((s, t) => s + t.medium, 0),
      low: templates.reduce((s, t) => s + t.low, 0),
      autoCount: templates.filter((t) => t.auto).length,
      advisoryCount: templates.filter((t) => !t.auto).length,
      cleanCount: templates.filter((t) => t.status === "clean").length,
    });
  }

  return cats.sort((a, b) => b.hitCount - a.hitCount || a.category.localeCompare(b.category));
}

export interface Coverage {
  total: number;
  auto: number;
  advisory: number;
  withHits: number;
  totalHits: number;
}

/** Advisory coverage summary across the catalogue. */
export function computeCoverage(groups: TemplateGroup[]): Coverage {
  return {
    total: groups.length,
    auto: groups.filter((g) => g.auto).length,
    advisory: groups.filter((g) => !g.auto).length,
    withHits: groups.filter((g) => g.hitCount > 0).length,
    totalHits: groups.reduce((s, g) => s + g.hitCount, 0),
  };
}

export interface AdvisoryCategory {
  category: string;
  rules: RuleTemplate[];
}

/**
 * The rules the engine does NOT auto-verify (Tier C / no handler), grouped by category —
 * the "check these manually" list for the advisory coverage panel. Advisory only (decision #8).
 */
export function advisoryRulesByCategory(rules: RuleTemplate[]): AdvisoryCategory[] {
  const byCat = new Map<string, RuleTemplate[]>();
  for (const r of rules) {
    if (isAutoChecked(r)) continue;
    const cat = (r.category ?? "").trim() || "Uncategorised";
    const arr = byCat.get(cat);
    if (arr) arr.push(r);
    else byCat.set(cat, [r]);
  }
  return [...byCat.entries()]
    .map(([category, rs]) => ({ category, rules: rs }))
    .sort((a, b) => b.rules.length - a.rules.length || a.category.localeCompare(b.category));
}
