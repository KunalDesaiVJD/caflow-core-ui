/**
 * CustomerSyncDialog — main sync dialog orchestrator.
 * Delegates logic to useCustomerSync, rendering to sub-components.
 *
 * CORS NOTE: If the API call fails due to CORS, create a Supabase Edge Function:
 *   supabase/functions/customer-sync/index.ts
 *   → calls eofficeportal server-side (no CORS restriction)
 *   → returns parsed JSON to frontend
 *   Frontend: replace fetch(CUSTOMER_SYNC_API_URL) with
 *             supabase.functions.invoke('customer-sync')
 */

import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw, AlertCircle, Upload, XCircle, RotateCcw, Users,
} from "lucide-react";
import { useCustomerSync, ENTITY_MAP } from "./useCustomerSync";
import { CustomerSyncProgress } from "./CustomerSyncProgress";
import { CustomerSyncResults } from "./CustomerSyncResults";
import { decodeHtmlEntities } from "@/lib/htmlEntities";

interface Props {
  open:         boolean;
  onOpenChange: (open: boolean) => void;
  firmId:       string | null;
  onComplete:   () => void;   // called after successful import → refreshes client list
}

export function CustomerSyncDialog({ open, onOpenChange, firmId, onComplete }: Props) {
  const sync = useCustomerSync();
  const [showPreview, setShowPreview] = useState(false);

  // Auto-start fetch as soon as dialog opens
  useEffect(() => {
    if (open && sync.status === "idle") sync.fetchAndPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleClose = () => {
    sync.reset();
    setShowPreview(false);
    onOpenChange(false);
  };

  const handleImport = async () => {
    await sync.executeImport(firmId);
    onComplete();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-primary" />
            Sync Customers from API
          </DialogTitle>
          <DialogDescription>
            Fetching and importing customers from eofficeportal into CaFlow.
          </DialogDescription>
        </DialogHeader>

        {/* ── FETCHING (auto-starts) ── */}
        {(sync.status === "idle" || sync.status === "fetching") && (
          <div className="py-10 flex flex-col items-center gap-5">
            <RefreshCw className="h-9 w-9 text-primary animate-spin" />
            <div className="text-center space-y-1">
              <p className="text-sm font-medium">
                Fetching customer list from eofficeportal…
              </p>
              <p className="text-xs text-muted-foreground">This may take a few seconds</p>
            </div>
            <div className="w-full rounded-full h-2 bg-muted overflow-hidden">
              <div className="h-full bg-primary rounded-full animate-pulse w-2/3" />
            </div>
          </div>
        )}

        {/* ── PREVIEW ── */}
        {sync.status === "previewing" && (
          <div className="space-y-4 py-1">

            {/* 📊 Sync Summary */}
            <div className="rounded-lg border overflow-hidden">
              <div className="bg-muted/40 px-4 py-2.5 flex items-center gap-2 border-b">
                <Users className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">Sync Summary</span>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-b">
                    <td className="px-4 py-2.5 text-muted-foreground">Total from API</td>
                    <td className="px-4 py-2.5 font-semibold text-right">
                      {sync.apiRecords.length}
                    </td>
                  </tr>
                  {sync.inactiveCount > 0 && (
                    <tr className="border-b">
                      <td className="px-4 py-2.5 text-muted-foreground">Inactive (will draft as inactive)</td>
                      <td className="px-4 py-2.5 font-semibold text-right text-amber-600">
                        {sync.inactiveCount}
                      </td>
                    </tr>
                  )}
                  <tr className="border-b">
                    <td className="px-4 py-2.5 text-muted-foreground">New to add</td>
                    <td className="px-4 py-2.5 font-semibold text-right text-emerald-600">
                      {sync.newRecords.length}
                    </td>
                  </tr>
                  <tr className={sync.invalidCount > 0 ? "border-b" : ""}>
                    <td className="px-4 py-2.5 text-muted-foreground">Existing (will update)</td>
                    <td className="px-4 py-2.5 font-semibold text-right text-blue-600">
                      {sync.updatedRecords.length}
                    </td>
                  </tr>
                  {sync.invalidCount > 0 && (
                    <tr>
                      <td className="px-4 py-2.5 text-muted-foreground">Invalid (no ID)</td>
                      <td className="px-4 py-2.5 font-semibold text-right text-destructive">
                        {sync.invalidCount}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Nothing to do */}
            {sync.newRecords.length === 0 && sync.updatedRecords.length === 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3 flex gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  All active customers are already up-to-date in CaFlow — nothing to sync.
                </p>
              </div>
            )}

            {/* Info banner when there's work to do */}
            {(sync.newRecords.length > 0 || sync.updatedRecords.length > 0) && (
              <>
                <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3 flex gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    {sync.newRecords.length > 0 && (
                      <>New customers will be created as <strong>DRAFTS</strong>. </>
                    )}
                    {sync.updatedRecords.length > 0 && (
                      <>Existing records will be refreshed with the latest API data.</>
                    )}
                  </p>
                </div>

                {sync.newRecords.length > 0 && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowPreview((p) => !p)}
                      className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                    >
                      Preview New Customers{" "}
                      <span className="text-xs">{showPreview ? "▲" : "▾"}</span>
                    </button>

                    {showPreview && (
                      <div className="mt-2 rounded-md border overflow-hidden max-h-52 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-muted/50 sticky top-0">
                            <tr>
                              <th className="text-left px-3 py-2 font-medium w-20">ID</th>
                              <th className="text-left px-3 py-2 font-medium">Name</th>
                              <th className="text-left px-3 py-2 font-medium w-28">PAN</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sync.newRecords.map((r) => (
                              <tr key={r.CustomerId} className="border-t hover:bg-muted/20">
                                <td className="px-3 py-1.5 font-mono text-muted-foreground">
                                  {r.CustomerCode || String(r.CustomerId)}
                                </td>
                                <td className="px-3 py-1.5 max-w-[180px] truncate">
                                  {decodeHtmlEntities(r.ClientName) || "—"}
                                </td>
                                <td className="px-3 py-1.5 font-mono">
                                  {r.PanCard || "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              {(sync.newRecords.length > 0 || sync.updatedRecords.length > 0) ? (
                <Button onClick={handleImport} className="gap-2">
                  <Upload className="h-4 w-4" />
                  {sync.newRecords.length > 0 && sync.updatedRecords.length > 0
                    ? `Sync (${sync.newRecords.length} new · ${sync.updatedRecords.length} update)`
                    : sync.newRecords.length > 0
                      ? `Import ${sync.newRecords.length} Clients`
                      : `Update ${sync.updatedRecords.length} Clients`}
                </Button>
              ) : (
                <Button onClick={handleClose}>Close</Button>
              )}
            </DialogFooter>
          </div>
        )}

        {/* ── IMPORTING ── */}
        {sync.status === "importing" && (
          <CustomerSyncProgress progress={sync.progress} onCancel={sync.cancelImport} />
        )}

        {/* ── DONE ── */}
        {sync.status === "done" && sync.results && (
          <CustomerSyncResults results={sync.results} onClose={handleClose} />
        )}

        {/* ── ERROR ── */}
        {sync.status === "error" && (
          <div className="space-y-4 py-2">
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 flex gap-3">
              <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-1.5 min-w-0">
                <p className="text-sm font-semibold text-destructive">Sync failed</p>
                {/* Render multi-line messages (e.g. CORS message with deploy command) */}
                {sync.errorMsg.split("\n").map((line, i) => (
                  <p key={i} className={
                    i === 0
                      ? "text-xs text-muted-foreground break-all"
                      : "text-xs font-mono text-muted-foreground break-all mt-0.5"
                  }>
                    {line}
                  </p>
                ))}
                {/* SSL hint */}
                {(sync.errorMsg.includes("SSL") ||
                  sync.errorMsg.includes("cert") ||
                  sync.errorMsg.includes("ERR_CERT")) && (
                  <p className="text-xs text-amber-600 mt-1">
                    ⚠️ The API server's SSL certificate may be expired. Ask your IT
                    team to renew the certificate at eofficeportal.com, then retry.
                  </p>
                )}
                {/* Admin hint for invalid data */}
                {sync.errorMsg.includes("Contact administrator") && (
                  <p className="text-xs text-amber-600 mt-1">
                    ⚠️ The API response format may have changed. Check the browser
                    console for the full response.
                  </p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Close</Button>
              <Button
                onClick={() => { sync.reset(); sync.fetchAndPreview(); }}
                className="gap-2"
              >
                <RotateCcw className="h-4 w-4" /> Retry
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
