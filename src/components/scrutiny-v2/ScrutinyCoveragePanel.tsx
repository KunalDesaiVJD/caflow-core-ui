/**
 * Advisory coverage panel (Ticket 1.4, v2).
 *
 * A collapsible panel that makes the engine's coverage explicit: how many of the 119 rules are
 * auto-verified vs. need manual review, and — expanded — the exact list of not-auto-verified
 * rules by category (the "check these by hand" list).
 *
 * ADVISORY ONLY (canonical decision #8): coverage is shown to the auditor, it never blocks
 * sign-off / UDIN. Built entirely from the rule catalogue via `advisoryRulesByCategory`.
 */

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, Info } from "lucide-react";
import { type RuleTemplate } from "@/lib/scrutiny/scrutinyUi";
import { advisoryRulesByCategory } from "@/lib/scrutiny/coverage";

interface Props {
  rules: RuleTemplate[];
}

export default function ScrutinyCoveragePanel({ rules }: Props) {
  const [open, setOpen] = useState(false);
  const advisoryCats = useMemo(() => advisoryRulesByCategory(rules), [rules]);

  const total = rules.length;
  if (total === 0) return null;
  const advisoryCount = advisoryCats.reduce((s, c) => s + c.rules.length, 0);
  const auto = total - advisoryCount;

  return (
    <div className="rounded-md border bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/40"
      >
        {open ? <ChevronDown size={16} className="text-muted-foreground" /> : <ChevronRight size={16} className="text-muted-foreground" />}
        <Info size={14} className="text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">Coverage &amp; method</span>
        <span className="text-xs text-muted-foreground">
          — {auto}/{total} auto-verified · {advisoryCount} need manual review · advisory, never blocks sign-off
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            The deterministic engine auto-verifies {auto} of {total} rules. The rules below are not auto-verified
            (Tier-C / judgment checks) and should be reviewed manually — this is advisory and never blocks sign-off / UDIN.
          </p>
          {advisoryCats.map((c) => (
            <div key={c.category}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-foreground">{c.category}</span>
                <Badge variant="outline" className="text-xs">{c.rules.length}</Badge>
              </div>
              <ul className="space-y-0.5">
                {c.rules.map((r) => (
                  <li key={r.rule_id} className="text-xs text-muted-foreground flex gap-2">
                    <span className="font-mono shrink-0">{r.rule_id}</span>
                    <span className="truncate">{r.rule_name || ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
