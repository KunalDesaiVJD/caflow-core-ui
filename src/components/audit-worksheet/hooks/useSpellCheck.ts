/**
 * useSpellCheck
 *
 * Auto-corrects spelling and sentence construction in audit query fields
 * using the claude-gateway "spell_grammar_fix" action.
 *
 * Designed for silent, zero-confirmation auto-correction — fires on field blur,
 * silently updates the field if corrections are found.
 *
 * Usage:
 *   const { checkAndFix } = useSpellCheck(updateQuery);
 *   <Textarea onBlur={e => checkAndFix(row.id, "query_description", e.target.value)} />
 */

import { useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

// Minimum characters before we bother calling the AI (avoids waste on tiny inputs)
const MIN_CHARS = 8;

// Global in-flight guard: prevents duplicate calls while one is already running
// for the same (rowId + field) key
const inFlight = new Set<string>();

type UpdateFn = (id: string, field: string, value: string) => void;

export function useSpellCheck(updateQuery: UpdateFn) {
  // Track pending debounce timers per cell key so rapid re-blurs don't fire twice
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const checkAndFix = useCallback(
    (rowId: string, field: string, text: string) => {
      if (!text || text.trim().length < MIN_CHARS) return;

      const key = `${rowId}:${field}`;

      // Debounce: reset timer if called again quickly
      const existing = timers.current.get(key);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(async () => {
        timers.current.delete(key);

        // Skip if a request is already running for this cell
        if (inFlight.has(key)) return;
        inFlight.add(key);

        try {
          const { data, error } = await supabase.functions.invoke("claude-gateway", {
            body: {
              request_type: "spell_grammar_fix",
              user_message: text,
            },
          });

          if (error || !data?.corrected) return;

          const corrected = String(data.corrected).trim();

          // Only update if something actually changed
          if (corrected && corrected !== text.trim()) {
            updateQuery(rowId, field, corrected);
          }
        } catch {
          // Silent — spell check is non-critical; never interrupt the user
        } finally {
          inFlight.delete(key);
        }
      }, 400); // short delay after blur before firing

      timers.current.set(key, timer);
    },
    [updateQuery],
  );

  return { checkAndFix };
}
