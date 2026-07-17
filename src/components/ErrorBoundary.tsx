import React from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";

// ── Chunk-error detection ────────────────────────────────────────────────────
// Vite bundles lazy-loaded chunks with content-hash filenames.  When a new
// Vercel deployment is pushed the old hash URLs are gone. Any React.lazy()
// call that was loaded before the deployment will try to fetch a 404 chunk →
// throws a "Failed to fetch dynamically imported module" error.
// We auto-reload so the browser picks up the fresh HTML with updated chunk
// URLs.  A timestamped cooldown bounds this: if the reload doesn't cure the
// error we fall through to the normal UI instead of looping forever.
const CHUNK_RELOAD_KEY = "caflow_chunk_error_reloaded_at";
const CHUNK_RELOAD_COOLDOWN_MS = 30_000;

function isChunkLoadError(err: Error | null | undefined): boolean {
  if (!err) return false;
  const msg = err.message ?? "";
  return (
    msg.includes("Failed to fetch dynamically imported module") ||
    msg.includes("Importing a module script failed") ||
    msg.includes("Loading chunk") ||
    msg.includes("Unable to preload CSS") ||
    (err as any).name === "ChunkLoadError"
  );
}

/**
 * True when no stale-chunk reload has been attempted within the cooldown.
 *
 * Stored as a timestamp rather than a boolean flag on purpose: a successful
 * mount must NOT be able to clear it. The outer boundary always mounts fine
 * (its lazy children live behind Suspense), so a mount-time `removeItem` wiped
 * the flag before every chunk error and turned "reload once" into an infinite
 * reload loop. A timestamp still self-heals — a genuinely new deploy later in
 * the session is outside the cooldown and reloads normally.
 */
function canReloadForChunkError(): boolean {
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY)) || 0;
    return Date.now() - last > CHUNK_RELOAD_COOLDOWN_MS;
  } catch {
    return false; // sessionStorage blocked — never risk an unbounded reload loop
  }
}

// ── Props / State ────────────────────────────────────────────────────────────

interface Props {
  children: React.ReactNode;
  /**
   * When `resetKey` changes (e.g. the route pathname), the boundary
   * automatically clears any captured error and re-renders its children.
   * Pass `location.pathname` from a wrapper component inside <BrowserRouter>.
   */
  resetKey?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  /** Snapshot of the resetKey at the time the error was captured */
  capturedResetKey: string;
  /** A stale-chunk reload is in flight — suppress the error UI until it lands */
  reloading: boolean;
}

// ── ErrorBoundary (class component — required by React) ──────────────────────

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      capturedResetKey: props.resetKey ?? "",
      reloading: false,
    };
  }

  /**
   * If the resetKey has changed since we captured the error (i.e. the user
   * navigated to a different route), auto-clear the error state so the new
   * page can render normally without requiring a full reload.
   */
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (
      state.hasError &&
      props.resetKey !== undefined &&
      props.resetKey !== state.capturedResetKey
    ) {
      return { hasError: false, error: null, reloading: false, capturedResetKey: props.resetKey };
    }
    return null;
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    // Classify the error HERE, in the render phase, rather than in
    // componentDidCatch. A stale-chunk 404 ends in window.location.reload(),
    // but componentDidCatch runs a full lifecycle phase later — by then
    // render() has already committed and painted the "Something went wrong"
    // panel, so the user sees it flash for a frame before the reload wipes it.
    // Setting `reloading` up front lets render() stay silent instead.
    return {
      hasError: true,
      error,
      reloading: isChunkLoadError(error) && canReloadForChunkError(),
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Auto-reload for chunk load failures (Vite + Vercel stale-deployment)
    if (isChunkLoadError(error)) {
      if (canReloadForChunkError()) {
        try {
          sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
        } catch {
          /* sessionStorage blocked — reload anyway, cooldown just won't persist */
        }
        window.location.reload();
      } else {
        // Already reloaded once and the chunk is still missing: show the real
        // error UI rather than looping.
        console.error("[ErrorBoundary] chunk still failing after reload:", error, info);
      }
      return;
    }

    console.error("[ErrorBoundary] caught:", error, info);

    // Store which resetKey was active when the error fired
    this.setState({ capturedResetKey: this.props.resetKey ?? "" });
  }

  private reset = () => this.setState({ hasError: false, error: null, reloading: false });

  render() {
    // A reload is already in flight — render nothing so the error panel never
    // flashes on screen for the frame before the fresh HTML lands.
    if (this.state.reloading) return null;

    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <div className="text-center space-y-4 max-w-md">
            <AlertTriangle className="w-12 h-12 text-destructive mx-auto" />
            <h1 className="text-xl font-bold text-foreground">Something went wrong</h1>
            <p className="text-sm text-muted-foreground">
              An unexpected error occurred. Please try again.
            </p>
            <div className="flex gap-3 justify-center">
              <Button onClick={this.reset}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Try Again
              </Button>
              <Button variant="outline" onClick={() => window.location.reload()}>
                Reload Page
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
