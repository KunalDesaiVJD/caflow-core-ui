import React from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";

// ── Chunk-error detection ────────────────────────────────────────────────────
// Vite bundles lazy-loaded chunks with content-hash filenames.  When a new
// Vercel deployment is pushed the old hash URLs are gone. Any React.lazy()
// call that was loaded before the deployment will try to fetch a 404 chunk →
// throws a "Failed to fetch dynamically imported module" error.
// We auto-reload ONCE (guarded by sessionStorage) so the browser picks up the
// fresh HTML with updated chunk URLs.  Subsequent errors fall through to the
// normal UI so we don't get stuck in an infinite reload loop.
const CHUNK_RELOAD_KEY = "caflow_chunk_error_reloaded";

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
}

// ── ErrorBoundary (class component — required by React) ──────────────────────

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      capturedResetKey: props.resetKey ?? "",
    };
  }

  /** Clear the chunk-reload guard once the tree renders successfully. */
  componentDidMount() {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
  }

  componentDidUpdate() {
    if (!this.state.hasError) sessionStorage.removeItem(CHUNK_RELOAD_KEY);
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
      return { hasError: false, error: null, capturedResetKey: props.resetKey };
    }
    return null;
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary] caught:", error, info);

    // Auto-reload once for chunk load failures (Vite + Vercel stale-deployment)
    if (isChunkLoadError(error)) {
      if (!sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
        window.location.reload();
      }
      return;
    }

    // Store which resetKey was active when the error fired
    this.setState({ capturedResetKey: this.props.resetKey ?? "" });
  }

  private reset = () => this.setState({ hasError: false, error: null });

  render() {
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
