// ─────────────────────────────────────────────────────────────────────────────
// CAFlow — TB AI Review Panel (N.8 UI)
//
// Shown after import when there are pending AI suggestions or validation warnings.
// Lists each suggestion with:
//   - Ledger name + current classification
//   - AI proposed classification + rationale
//   - Confidence indicator
//   - Accept / Reject buttons
//
// Accepted suggestions write to tb_manual_overrides (via tb-ai-suggester.ts).
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { CheckCircle, XCircle, AlertTriangle, Sparkles, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { acceptAiSuggestion, rejectAiSuggestion } from "@/lib/tb-ai-suggester";
import type { TbAiSuggestion, TbSectionType } from "@/lib/tb-types";

// ── Props ─────────────────────────────────────────────────────────────────────
interface TbReviewPanelProps {
  suggestions: TbAiSuggestion[];
  nodeDisplayNames: Map<string, string>; // normalizedName → display name
  userId: string;
  onAllResolved?: () => void;  // called when all suggestions are accepted/rejected
  onRefresh?: () => void;      // called after any Accept/Reject to re-run validation
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const SECTION_LABELS: Record<TbSectionType, string> = {
  bs_asset:     "BS — Asset",
  bs_liability: "BS — Liability",
  pl_income:    "P&L — Income",
  pl_expense:   "P&L — Expense",
  unknown:      "Unclassified",
};

const SECTION_COLOURS: Record<TbSectionType, string> = {
  bs_asset:     "bg-blue-100 text-blue-800",
  bs_liability: "bg-purple-100 text-purple-800",
  pl_income:    "bg-green-100 text-green-800",
  pl_expense:   "bg-orange-100 text-orange-800",
  unknown:      "bg-gray-100 text-gray-600",
};

function ConfidencePill({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const colour =
    pct >= 90 ? "bg-green-100 text-green-800" :
    pct >= 70 ? "bg-yellow-100 text-yellow-800" :
                "bg-red-100 text-red-800";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colour}`}>
      {pct}% confident
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export function TbReviewPanel({
  suggestions,
  nodeDisplayNames,
  userId,
  onAllResolved,
  onRefresh,
}: TbReviewPanelProps) {
  const { toast } = useToast();
  const [localSuggestions, setLocalSuggestions] = useState<TbAiSuggestion[]>(
    suggestions.filter(s => s.status === "pending")
  );
  const [processing, setProcessing] = useState<Set<string>>(new Set());

  const pending = localSuggestions.filter(s => s.status === "pending");
  const resolved = localSuggestions.filter(s => s.status !== "pending");

  async function handleAccept(suggestion: TbAiSuggestion) {
    setProcessing(prev => new Set(prev).add(suggestion.suggestionId));
    try {
      const displayName = nodeDisplayNames.get(suggestion.normalizedName) ?? suggestion.normalizedName;
      await acceptAiSuggestion(suggestion, userId, displayName);
      setLocalSuggestions(prev =>
        prev.map(s => s.suggestionId === suggestion.suggestionId
          ? { ...s, status: "accepted" } : s)
      );
      toast({ title: "Accepted", description: `"${displayName}" reclassified to ${SECTION_LABELS[suggestion.suggestedSection ?? "unknown"]}` });
      onRefresh?.();
      if (pending.length === 1) onAllResolved?.();
    } catch (err) {
      toast({ title: "Error", description: String(err), variant: "destructive" });
    } finally {
      setProcessing(prev => { const n = new Set(prev); n.delete(suggestion.suggestionId); return n; });
    }
  }

  async function handleReject(suggestion: TbAiSuggestion) {
    setProcessing(prev => new Set(prev).add(suggestion.suggestionId));
    try {
      await rejectAiSuggestion(suggestion.suggestionId, userId);
      setLocalSuggestions(prev =>
        prev.map(s => s.suggestionId === suggestion.suggestionId
          ? { ...s, status: "rejected" } : s)
      );
      toast({ title: "Rejected", description: `Suggestion for "${nodeDisplayNames.get(suggestion.normalizedName) ?? suggestion.normalizedName}" was rejected.` });
      if (pending.length === 1) onAllResolved?.();
    } catch (err) {
      toast({ title: "Error", description: String(err), variant: "destructive" });
    } finally {
      setProcessing(prev => { const n = new Set(prev); n.delete(suggestion.suggestionId); return n; });
    }
  }

  async function handleAcceptAll() {
    for (const s of pending) {
      await handleAccept(s);
    }
  }

  if (localSuggestions.length === 0) return null;

  return (
    <Card className="border-amber-200 bg-amber-50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-amber-900 text-base">
          <Sparkles className="h-4 w-4 text-amber-600" />
          AI Classification Review
          {pending.length > 0 && (
            <Badge variant="secondary" className="ml-auto bg-amber-200 text-amber-900">
              {pending.length} pending
            </Badge>
          )}
        </CardTitle>
        <p className="text-xs text-amber-700 mt-1">
          The following ledgers could not be automatically classified. Review each AI suggestion and Accept or Reject.
        </p>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Accept All shortcut */}
        {pending.length > 1 && (
          <Button
            size="sm"
            variant="outline"
            className="w-full border-amber-300 text-amber-800 hover:bg-amber-100"
            onClick={handleAcceptAll}
          >
            Accept All Suggestions
          </Button>
        )}

        {/* Pending suggestions */}
        {pending.map(suggestion => {
          const displayName = nodeDisplayNames.get(suggestion.normalizedName) ?? suggestion.normalizedName;
          const isProcessing = processing.has(suggestion.suggestionId);

          return (
            <div
              key={suggestion.suggestionId}
              className="rounded-lg border border-amber-200 bg-white p-3 space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1 flex-1">
                  <p className="font-medium text-sm text-gray-900">{displayName}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-500">Currently:</span>
                    <span className={`text-xs rounded px-1.5 py-0.5 ${SECTION_COLOURS["unknown"]}`}>
                      Unclassified
                    </span>
                    <span className="text-gray-300 text-xs">→</span>
                    <span className="text-xs text-gray-500">AI suggests:</span>
                    <span className={`text-xs rounded px-1.5 py-0.5 ${SECTION_COLOURS[suggestion.suggestedSection ?? "unknown"]}`}>
                      {SECTION_LABELS[suggestion.suggestedSection ?? "unknown"]}
                    </span>
                    {suggestion.suggestedNormalBal && (
                      <span className="text-xs text-gray-500">
                        ({suggestion.suggestedNormalBal} normal)
                      </span>
                    )}
                  </div>
                </div>
                <ConfidencePill confidence={suggestion.confidence} />
              </div>

              {/* Rationale */}
              <p className="text-xs text-gray-600 bg-gray-50 rounded p-2 italic">
                {suggestion.rationale}
              </p>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  variant="default"
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white h-7 text-xs"
                  disabled={isProcessing}
                  onClick={() => handleAccept(suggestion)}
                >
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 border-red-200 text-red-700 hover:bg-red-50 h-7 text-xs"
                  disabled={isProcessing}
                  onClick={() => handleReject(suggestion)}
                >
                  <XCircle className="h-3 w-3 mr-1" />
                  Reject
                </Button>
              </div>
            </div>
          );
        })}

        {/* Resolved suggestions (collapsed) */}
        {resolved.length > 0 && (
          <>
            <Separator className="my-2" />
            <p className="text-xs text-gray-500 font-medium">
              Resolved ({resolved.length})
            </p>
            {resolved.map(s => {
              const displayName = nodeDisplayNames.get(s.normalizedName) ?? s.normalizedName;
              return (
                <div key={s.suggestionId} className="flex items-center gap-2 text-xs text-gray-500">
                  {s.status === "accepted"
                    ? <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />
                    : <XCircle className="h-3 w-3 text-red-400 shrink-0" />
                  }
                  <span className="truncate">{displayName}</span>
                  <span className="shrink-0">{s.status}</span>
                </div>
              );
            })}
          </>
        )}
      </CardContent>
    </Card>
  );
}
