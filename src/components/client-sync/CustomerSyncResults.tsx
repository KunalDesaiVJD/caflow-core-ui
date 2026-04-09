import { CheckCircle2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import type { SyncResults } from "./useCustomerSync";

interface Props {
  results: SyncResults;
  onClose: () => void;
}

export function CustomerSyncResults({ results, onClose }: Props) {
  return (
    <div className="space-y-4 py-1">

      {/* ✅ Header */}
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
        <p className="text-base font-semibold">Sync Complete!</p>
      </div>

      {/* Results table */}
      <div className="rounded-lg border overflow-hidden text-sm">
        <table className="w-full">
          <tbody>
            <tr className="border-b">
              <td className="px-4 py-2.5 text-muted-foreground">Created</td>
              <td className="px-4 py-2.5 font-semibold text-emerald-600">
                {results.created} new draft client{results.created !== 1 ? "s" : ""}
              </td>
            </tr>
            <tr className="border-b">
              <td className="px-4 py-2.5 text-muted-foreground">Skipped</td>
              <td className="px-4 py-2.5 font-semibold text-amber-600">
                {results.skipped} (already exist)
              </td>
            </tr>
            <tr className={results.failed > 0 ? "border-b" : ""}>
              <td className="px-4 py-2.5 text-muted-foreground">Failed</td>
              <td className={`px-4 py-2.5 font-semibold ${
                results.failed > 0 ? "text-destructive" : "text-muted-foreground"
              }`}>
                {results.failed}{results.failed > 0 ? " (see errors below)" : ""}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Error detail list */}
      {results.failed > 0 && results.errors.length > 0 && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-xs font-semibold text-destructive mb-2">Errors:</p>
          <ul className="text-xs space-y-1 text-destructive/80">
            {results.errors.slice(0, 10).map((e, i) => (
              <li key={i}>
                • <span className="font-mono">{e.customer_id}</span>: {e.error}
              </li>
            ))}
            {results.errors.length > 10 && (
              <li className="text-muted-foreground">
                … and {results.errors.length - 10} more
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Guidance note */}
      {results.created > 0 && (
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
