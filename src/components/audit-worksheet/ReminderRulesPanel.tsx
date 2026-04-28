/**
 * ReminderRulesPanel — Phase 4A
 *
 * Compact, collapsible panel embedded in the Client Inbox header area.
 * Shows the current reminder schedule, how many queries are due, and
 * a single "Send Due Reminders" button that fires the caller's handler.
 *
 * Props:
 *   rules          — current ReminderRules from useReminderEngine
 *   onSetRules     — update handler from useReminderEngine
 *   pendingCount   — number of queries returned by useReminderEngine.pendingReminders
 *   onSendReminders— called when auditor clicks "Send Due Reminders"
 */
import { useState } from "react";
import { Button }   from "@/components/ui/button";
import { Badge }    from "@/components/ui/badge";
import { Switch }   from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Bell, ChevronDown, ChevronUp, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReminderRules } from "./hooks/useReminderEngine";
import { INTERVAL_OPTIONS } from "./hooks/useReminderEngine";

interface Props {
  rules:           ReminderRules;
  onSetRules:      (r: ReminderRules) => void;
  pendingCount:    number;
  onSendReminders: () => void;
}

export function ReminderRulesPanel({
  rules, onSetRules, pendingCount, onSendReminders,
}: Props) {
  const [open, setOpen] = useState(false);

  const statusLabel = rules.enabled
    ? `Auto · every ${rules.intervalDays}d`
    : "Disabled";

  return (
    <div className={cn(
      "rounded-lg border text-xs transition-colors",
      pendingCount > 0 && rules.enabled
        ? "border-orange-200 bg-orange-50/60"
        : "border-muted bg-muted/20",
    )}>
      {/* ── Summary row ── */}
      <div className="flex items-center gap-2 px-3 py-2">
        <Bell size={13} className={cn(
          pendingCount > 0 && rules.enabled ? "text-orange-600" : "text-muted-foreground",
        )} />
        <span className="font-medium text-foreground">Reminder Rules</span>
        <span className="text-muted-foreground">{statusLabel}</span>

        {pendingCount > 0 && rules.enabled && (
          <Badge className="ml-1 bg-orange-600 text-white text-[10px] h-4 px-1.5">
            {pendingCount} due
          </Badge>
        )}
        {pendingCount === 0 && rules.enabled && (
          <span className="text-green-600 text-[10px]">✓ up to date</span>
        )}

        <div className="flex items-center gap-1.5 ml-auto">
          {pendingCount > 0 && rules.enabled && (
            <Button size="sm" className="h-6 text-[10px] px-2.5 gap-1 bg-orange-600 hover:bg-orange-700"
              onClick={onSendReminders}>
              <Bell size={10} /> Send Reminders ({pendingCount})
            </Button>
          )}
          <button type="button"
            onClick={() => setOpen(v => !v)}
            className="text-muted-foreground hover:text-foreground transition-colors p-0.5">
            <Settings2 size={13} />
          </button>
          <button type="button"
            onClick={() => setOpen(v => !v)}
            className="text-muted-foreground hover:text-foreground transition-colors">
            {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>

      {/* ── Settings drawer ── */}
      {open && (
        <div className="border-t px-3 py-3 space-y-3 bg-background/70 rounded-b-lg">
          {/* Enable toggle */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Enable auto-reminders</span>
            <Switch
              checked={rules.enabled}
              onCheckedChange={v => onSetRules({ ...rules, enabled: v })}
            />
          </div>

          {/* Interval */}
          <div className={cn("flex items-center justify-between", !rules.enabled && "opacity-40 pointer-events-none")}>
            <div>
              <span className="text-xs font-medium">Reminder interval</span>
              <p className="text-[10px] text-muted-foreground">
                Send reminder if no reply within this many days of dispatch
              </p>
            </div>
            <Select
              value={String(rules.intervalDays)}
              onValueChange={v => onSetRules({ ...rules, intervalDays: Number(v) })}
              disabled={!rules.enabled}>
              <SelectTrigger className="h-7 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERVAL_OPTIONS.map(d => (
                  <SelectItem key={d} value={String(d)} className="text-xs">
                    {d} days
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Explanation */}
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Queries that have been <em>Open</em> or <em>Client Acknowledged</em> for
            longer than the interval will appear as "due" and are included when you
            click <strong>Send Reminders</strong>.
            Sent timestamps are saved locally so the same query won't re-trigger within
            the interval.
          </p>
        </div>
      )}
    </div>
  );
}
