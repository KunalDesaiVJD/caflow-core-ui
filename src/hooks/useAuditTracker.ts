import { useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

// Generate a stable session ID per browser tab
const SESSION_ID = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/**
 * Silent logging hook for tracking human actions during audit work.
 * Logs to audit_human_actions without blocking the UI.
 */
export function useAuditTracker(engagementId?: string | null) {
  const { user } = useAuth();
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const track = useCallback(
    (
      actionType: string,
      actionContext: Record<string, any> = {},
      options?: { aiSuggestion?: string; humanOverride?: boolean }
    ) => {
      if (!user) return;

      // Fire-and-forget, queued to avoid race conditions
      queueRef.current = queueRef.current.then(async () => {
        try {
          await supabase.from("audit_human_actions").insert({
            engagement_id: engagementId || null,
            user_id: user.id,
            firm_id: user.firm_id || null,
            action_type: actionType,
            action_context: actionContext,
            ai_suggestion: options?.aiSuggestion || null,
            human_override: options?.humanOverride ?? false,
            session_id: SESSION_ID,
          } as any);
        } catch {
          // Silent — never block the UI for tracking failures
        }
      });
    },
    [user, engagementId]
  );

  return { track };
}
