/**
 * Command-centre helpers (Phase 6, Ticket 6.1 — behind VITE_SCRUTINY_V2).
 *
 * Pure aggregation + geometry for the Overview dashboard:
 *  - riskByCategory: per-category severity rollup + a weighted risk score (the risk-radar data)
 *  - radarGeometry: SVG points for a spider/radar chart from those scores (no chart dependency)
 *  - attentionFeed: a prioritised "what needs action" list (high findings, drafts awaiting a
 *    checker, prior-year recurrences, missing judgment facts)
 *
 * Pure + dependency-free → unit-testable without a DB.
 */

import type { Finding } from "./scrutinyUi";

const sevU = (f: Finding): string => (f.severity ?? "").toUpperCase();
const catOf = (f: Finding): string => (f.rule_id ?? "").split("-")[0] || "GEN";

export interface CategoryRisk {
  category: string;
  high: number;
  medium: number;
  low: number;
  total: number;
  score: number; // high*5 + medium*2 + low*1
}

/** Per-category severity rollup + weighted risk score, highest risk first. */
export function riskByCategory(findings: Finding[]): CategoryRisk[] {
  const m = new Map<string, CategoryRisk>();
  for (const f of findings) {
    const c = catOf(f);
    const cur = m.get(c) ?? { category: c, high: 0, medium: 0, low: 0, total: 0, score: 0 };
    const s = sevU(f);
    if (s === "HIGH") cur.high++;
    else if (s === "MEDIUM") cur.medium++;
    else cur.low++;
    cur.total++;
    m.set(c, cur);
  }
  const out = [...m.values()];
  for (const c of out) c.score = c.high * 5 + c.medium * 2 + c.low * 1;
  return out.sort((a, b) => b.score - a.score || b.total - a.total);
}

// ── Radar (spider) geometry ────────────────────────────────────────────────

export interface RadarAxis {
  label: string;
  value: number;
  x: number; // data point
  y: number;
  ax: number; // axis outer end
  ay: number;
}

export interface RadarGeometry {
  size: number;
  center: number;
  rings: number[]; // ring radii
  axes: RadarAxis[];
  polygon: string; // "x,y x,y ..." for the data polygon
}

/** SVG geometry for a radar chart. Values are normalised to the largest value. */
export function radarGeometry(items: { label: string; value: number }[], size = 240, rings = 4): RadarGeometry {
  const center = size / 2;
  const radius = center * 0.8;
  const max = Math.max(1, ...items.map((i) => i.value));
  const n = Math.max(1, items.length);
  const axes: RadarAxis[] = items.map((it, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2; // first axis at the top
    const r = (it.value / max) * radius;
    return {
      label: it.label,
      value: it.value,
      x: center + Math.cos(angle) * r,
      y: center + Math.sin(angle) * r,
      ax: center + Math.cos(angle) * radius,
      ay: center + Math.sin(angle) * radius,
    };
  });
  const polygon = axes.map((a) => `${a.x.toFixed(1)},${a.y.toFixed(1)}`).join(" ");
  const ringRadii = Array.from({ length: rings }, (_, k) => (radius * (k + 1)) / rings);
  return { size, center, rings: ringRadii, axes, polygon };
}

// ── Attention feed ─────────────────────────────────────────────────────────

export type AttentionKind = "high_finding" | "draft" | "recurring" | "missing_fact";

export interface AttentionItem {
  kind: AttentionKind;
  label: string;
}

export interface AttentionInputs {
  findings: Finding[];
  draftCount: number;
  recurringCount: number;
  missingFacts: string[];
}

/** Prioritised "what needs action" list for the command centre. */
export function attentionFeed(inp: AttentionInputs): AttentionItem[] {
  const out: AttentionItem[] = [];
  const high = inp.findings.filter((f) => sevU(f) === "HIGH").length;
  if (high) out.push({ kind: "high_finding", label: `${high} high-risk finding${high !== 1 ? "s" : ""} to review` });
  if (inp.draftCount) out.push({ kind: "draft", label: `${inp.draftCount} draft quer${inp.draftCount !== 1 ? "ies" : "y"} awaiting a second reviewer` });
  if (inp.recurringCount) out.push({ kind: "recurring", label: `${inp.recurringCount} finding${inp.recurringCount !== 1 ? "s" : ""} recurring from a prior-year waiver` });
  for (const m of inp.missingFacts.slice(0, 5)) out.push({ kind: "missing_fact", label: `Missing judgment fact: ${m}` });
  return out;
}
