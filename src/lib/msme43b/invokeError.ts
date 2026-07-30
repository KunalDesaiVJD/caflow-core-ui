// Turning a supabase-js function error into something a CA firm can act on.
//
// supabase-js reports every HTTP failure from an edge function with the same
// nine words — "Edge Function returned a non-2xx status code" — and hides the
// actual reason on error.context, which is the unread Response. So the same
// message appears whether the API key is spent, a model was withdrawn, the
// account is rate-limited, or the reply was truncated. Every one of those has a
// different remedy.
//
// This was first fixed only in the ledger reader, and the review panel and the
// calibration reviewer kept throwing the raw message for another two rounds. It
// lives here so there is one place to fix and no path left behind.

export interface DescribedError {
  message: string;
  /**
   * The request was too large for one reply — worth retrying smaller. Callers
   * that can split their input act on this; others just report it.
   */
  tooLarge: boolean;
  status?: number;
}

/**
 * Read the JSON body supabase-js left unread on the Response.
 *
 * Best-effort: the body may be consumed already, may not be JSON, or may be
 * empty. `code` is preferred over the prose so a reworded message cannot quietly
 * change behaviour.
 */
async function readBody(
  context: unknown,
): Promise<{ detail: string | null; tooLarge: boolean } | null> {
  const res = context as Response | undefined;
  if (!res || typeof res.text !== 'function') return null;
  try {
    const text = (await res.text()).trim();
    if (!text) return null;
    try {
      const parsed = JSON.parse(text) as {
        error?: string; message?: string; code?: string; truncated?: boolean;
      };
      const picked = parsed.error || parsed.message;
      return {
        detail: picked ? String(picked).slice(0, 500) : text.slice(0, 500),
        tooLarge: parsed.code === 'truncated' || parsed.truncated === true,
      };
    } catch {
      return { detail: text.slice(0, 500), tooLarge: false };
    }
  } catch {
    return null;
  }
}

/**
 * @param fnName   the edge function invoked, so "not deployed" names the thing to deploy
 * @param whatFor  a human phrase for what was being attempted, e.g. "the review panel"
 */
export async function describeFunctionError(
  error: { name?: string; message?: string; context?: unknown },
  fnName: string,
  whatFor: string,
): Promise<DescribedError> {
  const msg = error.message || '';

  if (/Failed to send a request|Failed to fetch|NetworkError|FunctionsFetchError/i.test(msg) || error.name === 'FunctionsFetchError') {
    return {
      message:
        `Could not reach ${whatFor} (${fnName}). It is most likely not deployed yet — run ` +
        `"npx supabase functions deploy ${fnName}". If it is deployed, check your network connection.`,
      tooLarge: false,
    };
  }
  if (/timeout|timed out/i.test(msg)) {
    return { message: `${whatFor} timed out. The request was too large to finish in time.`, tooLarge: true };
  }

  const body = await readBody(error.context);
  const status = (error.context as Response | undefined)?.status;
  // With no signal at all, a 502/504 still means the reply did not come back
  // whole — the safe reading is "too large", not "unknown failure".
  const tooLarge = body ? body.tooLarge : status === 502 || status === 504;

  return {
    message: body?.detail
      ? `${whatFor} failed${status ? ` (HTTP ${status})` : ''}: ${body.detail}`
      : msg || `${whatFor} failed${status ? ` (HTTP ${status})` : ''}.`,
    tooLarge,
    status,
  };
}
