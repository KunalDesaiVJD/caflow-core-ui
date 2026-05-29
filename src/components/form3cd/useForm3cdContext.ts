import { useCallback, useEffect, useState } from "react";
import { loadForm3cdContext, type Form3cdContext } from "@/lib/form3cd/context";

interface State {
  context: Form3cdContext | null;
  loading: boolean;
  error: string | null;
}

/**
 * Loads the engagement's financial data context (TB + COA mapping + PY) for the
 * Form 3CD auto-fill engine. Loads once on mount; `reload()` re-fetches after a
 * COA-mapping change so figures stay current.
 */
export function useForm3cdContext(engagementId: string | null | undefined) {
  const [state, setState] = useState<State>({ context: null, loading: false, error: null });

  const load = useCallback(async () => {
    if (!engagementId) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const ctx = await loadForm3cdContext(engagementId);
      setState({ context: ctx, loading: false, error: null });
    } catch (e: any) {
      setState({ context: null, loading: false, error: e?.message || "Failed to load financial data" });
    }
  }, [engagementId]);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, reload: load };
}
