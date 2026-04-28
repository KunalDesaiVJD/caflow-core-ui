/**
 * ReminderRulesPanel — Phase 4A / Phase 4C
 *
 * Compact, collapsible panel embedded in the Client Inbox header area.
 * Shows the current reminder schedule, how many queries are due for a
 * regular reminder, and how many are ready to escalate.
 *
 * Phase 4C additions:
 *   • escalationCount + onEscalate prop
 *   • escalateAfterReminders threshold picker in settings
 *   • Red "Escalate (N)" button when escalation candidates exist
 */
import { useState } from "react";
import { Button }   from "@/components/ui/button";
import { Badge }    from "@/components/ui/badge";
import { Switch }   from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Bell, ChevronDown, ChevronUp, Settings2, AlertOctagon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReminderRules } from "./hooks/useReminderEngine";
import { INTERVAL_OPTIONS, ESCALATE_OPTIONS } from "./hooks/useReminderEngine";

interface Props {
  rules:            ReminderRules;
  onSetRules:       (r: ReminderRules) => void;
  pendingCount:     number;
  onSendReminders:  () => void;
  /** Phase 4C */
  escalationCount:  number;
  onEscalate:       () => void;
}

export function ReminderRulesPanel({
  rules, onSetRules,
  pendingCount, onSendReminders,
  escalationCount, onEscalate,
}: Props) {
  const [open, setOpen] = useState(false);

  const hasPending    = pendingCount    > 0 && rules.enabled;
  const hasEscalation = escalationCount > 0 && rules.enabled;

  const statusLabel = rules.enabled
    ? `Auto · every ${rules.intervalDays}d · escalate after ${rules.escalateAfterReminders} reminders`
    : "Disabled";

  return (
    <div className={cn(
      "rounded-lg border text-xs transition-colors",
      hasEscalation ? "border-red-200 bg-red-50/40"
        : hasPending  ? "border-orange-200 bg-orange-50/60"
        : "border-muted bg-muted/20",
    )}>
      {/* ── Summary row ── */}
      <div className="flex items-center gap-2 px-3 py-2 flex-wrap">
        <Bell size={13} className={cn(
          hasEscalation ? "text-red-600"
            : hasPending  ? "text-orange-600"
            : "text-muted-foreground",
        )} />
        <span className="font-medium text-foreground">Reminder Rules</span>
        <span className="text-muted-foreground text-[10px]">{statusLabel}</span>

        {hasPending && (
          <Badge className="bg-orange-600 text-white text-[10px] h-4 px-1.5">
            {pendingCount} due
          </Badge>
        )}
        {hasEscalation && (
          <Badge className="bg-red-600 text-white text-[10px] h-4 px-1.5 flex items-center gap-0.5">
            <AlertOctagon size={9} /> {escalationCount} escalate
          </Badge>
        )}
        {!hasPending && !hasEscalation && rules.enabled && (
          <span className="text-green-600 text-[10px]">✓ up to date</span>
        )}

        <div className="flex items-center gap-1.5 ml-auto flex-wrap">
          {/* Escalate button — shown first (highest urgency) */}
          {hasEscalation && (
            <Button size="sm"
              className="h-6 text-[10px] px-2.5 gap-1 bg-red-600 hover:bg-red-700"
              onClick={onEscalate}>
              <AlertOctagon size={10} /> Escalate ({escalationCount})
            </Button>
          )}
          {/* Regular reminder button */}
          {hasPending && (
            <Button size="sm"
              className="h-6 text-[10px] px-2.5 gap-1 bg-orange-600 hover:bg-orange-700"
              onClick={onSendReminders}>
              <Bell size={10} /> Remind ({pendingCount})
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
        <div className="border-t px-3 py-3 space-y-3.5 bg-background/70 rounded-b-lg">

          {/* Enable toggle */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Enable auto-reminders</span>
            <Switch
              checked={rules.enabled}
              onCheckedChange={v => onSetRules({ ...rules, enabled: v })}
            />
          </div>

          {/* Reminder interval */}
          <div className={cn(
            "flex items-center justify-between",
            !rules.enabled && "opacity-40 pointer-events-none",
          )}>
            <div>
              <span className="text-xs font-medium">Reminder interval</span>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Days of silence before sending a reminder
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

          {/* Phase 4C: Escalation threshold */}
          <div className={cn(
            "flex items-center justify-between border-t pt-3",
            !rules.enabled && "opacity-40 pointer-events-none",
          )}>
            <div>
              <span className="text-xs font-medium flex items-center gap-1">
                <AlertOctagon size={11} className="text-red-500" />
                Escalate after
              </span>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Reminders sent with no response before escalation alert
              </p>
            </div>
            <Select
              value={String(rules.escalateAfterReminders)}
              onValueChange={v => onSetRules({ ...rules, escalateAfterReminders: Number(v) })}
              disabled={!rules.enabled}>
              <SelectTrigger className="h-7 w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ESCALATE_OPTIONS.map(n => (
                  <SelectItem key={n} value={String(n)} className="text-xs">
                    {n} reminder{n > 1 ? "s" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Explanation */}
          <p className="text-[10px] text-muted-foreground leading-relaxed pt-1 border-t">
            Queries that remain <em>Open</em> or <em>Client Acknowledged</em> longer than
            the interval appear as "due". After {rules.escalateAfterReminders} reminders with no
            reply they appear as "escalate" — a stronger follow-up email is sent and the
            count resets.
          </p>
        </div>
      )}
    </div>
  );
}
