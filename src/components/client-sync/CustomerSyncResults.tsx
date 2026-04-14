import { CheckCircle2, AlertCircle, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import type { SyncResults } from "./useCustomerSync";

interface Props {
  results: SyncResults;
  onClose: () => void;
}

export function CustomerSyncResults({ results, onClose }: Props) {
  const { created, updated, inactive, failed, errors, wasCancelled } = results;

  return (
    <div className="space-y-4 py-1">

      {/* ── Header ── */}
      {wasCancelled ? (
        <div className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-amber-500 shrink-0" />
          <div>
            <p className="text-base font-semibold">Sync Cancelled</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {created} client{created !== 1 ? "s were" : " was"} created before cancellation.
              Already-created drafts are kept and can be deleted from the Clients page.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
          <p className="text-base font-semibold">Sync Complete!</p>
        </div>
      )}

      {/* ── Results table ── */}
      <div className="rounded-lg border overflow-hidden text-sm">
        <table className="w-full">
          <tbody>
            <tr className="border-b">
              <td className="px-4 py-2.5 text-muted-foreground">Created</td>
              <td className="px-4 py-2.5 font-semibold text-emerald-600">
                {created} new draft client{created !== 1 ? "s" : ""}
              </td>
            </tr>
            <tr className="border-b">
              <td className="px-4 py-2.5 text-muted-foreground">Updated</td>
              <td className="px-4 py-2.5 font-semibold text-blue-600">
                {updated} existing client{updated !== 1 ? "s" : ""} refreshed
              </td>
            </tr>
            {inactive > 0 && (
              <tr className="border-b">
                <td className="px-4 py-2.5 text-muted-foreground">Inactive (skipped)</td>
                <td className="px-4 py-2.5 font-semibold text-muted-foreground">
                  {inactive}
                </td>
              </tr>
            )}
            <tr className={failed > 0 ? "border-b" : ""}>
              <td className="px-4 py-2.5 text-muted-foreground">Failed</td>
              <td className={`px-4 py-2.5 font-semibold ${
                failed > 0 ? "text-destructive" : "text-muted-foreground"
              }`}>
                {failed}{failed > 0 ? " (see errors below)" : ""}
              </td>
            </tr>
            {wasCancelled && (
              <tr>
                <td className="px-4 py-2.5 text-muted-foreground">Not processed</td>
                <td className="px-4 py-2.5 font-semibold text-muted-foreground">
                  Cancelled by user
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Error detail list ── */}
      {failed > 0 && errors.length > 0 && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-xs font-semibold text-destructive mb-2">Errors:</p>
          <ul className="text-xs space-y-1 text-destructive/80">
            {errors.slice(0, 10).map((e, i) => (
              <li key={i}>
                • <span className="font-mono">{e.customer_id}</span>: {e.error}
              </li>
            ))}
            {errors.length > 10 && (
              <li className="text-muted-foreground">
                … and {errors.length - 10} more
              </li>
            )}
          </ul>
        </div>
      )}

      {/* ── Guidance note (only when new records were created) ── */}
      {created > 0 && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 p-3 flex gap-2">
          <Users className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
          <p className="text-xs text-emerald-700 dark:text-emerald-300">
            Draft clients appear in the <strong>Clients via API</strong> tab and in
            the Draft banner. Complete setup via <strong>Continue Setup</strong>.
          </p>
        </div>
      )}

      <DialogFooter>
        <Button onClick={onClose}>Close</Button>
      </DialogFooter>
    </div>
  );
}
