/**
 * SyncFromApiDialog — fetches customers from eofficeportal API, deduplicates
 * against existing clients in Supabase, and bulk-imports new ones.
 *
 * API endpoint (ASMX web service):
 *   https://eofficeportal.com/Company/SmartService.asmx/FillCustomerlist?customerGroupid=null...
 * Response format: text/xml wrapping a JSON array string inside <string> element
 * Confirmed fields (1 075 records, 8 entity types — verified 2026-04-09):
 *   CustomerId, CustomerCode, groupname, ClientName, ComAddress, Mobile,
 *   email, Company_Name, companytypename, PanCard, TAN_no, GST_No,
 *   Adhar_No, AuditorName
 *
 * TODO: Supabase migration required before customer_id dedup works fully:
 *   ALTER TABLE clients ADD COLUMN customer_id TEXT;
 *   CREATE UNIQUE INDEX idx_clients_customer_id ON clients(customer_id)
 *     WHERE customer_id IS NOT NULL;
 *   ALTER TABLE clients ALTER COLUMN source SET DEFAULT 'manual';
 */

import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw, CheckCircle2, XCircle, AlertCircle, Users,
  SkipForward, Upload, RotateCcw,
} from "lucide-react";

// ─── API config ───────────────────────────────────────────────────────────────

const API_URL =
  "https://eofficeportal.com/Company/SmartService.asmx/FillCustomerlist" +
  "?customerGroupid=nullksd9ow34e9w0sdmoaskjof8w0eur0wejfomasdojo9auwerwjrowejmfojaspf";

// ─── Entity type mapping (all 8 values confirmed from live API) ───────────────

const ENTITY_MAP: Record<string, string> = {
  "INDIVIDUAL":  "Individual",
  "FIRM":        "Partnership",
  "LLP":         "LLP",
  "HUF":         "HUF",
  "PVT. LTD.":  "Private Ltd",
  "PUBLIC LTD":  "Public Ltd",
  "AOP":         "AOP",
  "Trust":       "Trust",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApiRecord {
  CustomerId:      number;
  CustomerCode:    string;
  groupname:       string;
  ClientName:      string;
  ComAddress:      string;
  Mobile:          string;
  email:           string;
  Company_Name:    string;
  companytypename: string;
  PanCard:         string;
  TAN_no:          string;
  GST_No:          string;
  Adhar_No:        string;
  AuditorName:     string;
}

type SyncStep = "idle" | "fetching" | "preview" | "importing" | "done" | "error";

interface SyncError {
  customer_id: string;
  name:        string;
  error:       string;
}

interface SyncResult {
  created: number;
  skipped: number;
  failed:  number;
  errors:  SyncError[];  // structured: { customer_id, name, error }
}

interface Props {
  open:          boolean;
  onOpenChange:  (open: boolean) => void;
  firmId:        string | null;
  onComplete:    () => void;
}

// ─── Parse XML → JSON array ───────────────────────────────────────────────────

function parseApiXml(xmlText: string): ApiRecord[] {
  const parser  = new DOMParser();
  const xmlDoc  = parser.parseFromString(xmlText, "text/xml");
  const strEl   = xmlDoc.querySelector("string");
  if (!strEl) throw new Error("API response is missing the expected <string> element");
  const jsonStr = strEl.textContent || "";
  const records = JSON.parse(jsonStr);
  if (!Array.isArray(records)) throw new Error("Expected a JSON array inside the XML response");
  return records as ApiRecord[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SyncFromApiDialog({ open, onOpenChange, firmId, onComplete }: Props) {
  const { user } = useAuth();
  const [step,         setStep]         = useState<SyncStep>("idle");
  const [errorMsg,     setErrorMsg]     = useState("");
  const [newRecords,   setNewRecords]   = useState<ApiRecord[]>([]);
  const [totalFetched, setTotalFetched] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const [invalidCount, setInvalidCount] = useState(0);   // records with no customer_id
  const [showPreview,  setShowPreview]  = useState(false); // collapsible preview table
  const [progress,     setProgress]     = useState({ current: 0, total: 0 });
  const [result,       setResult]       = useState<SyncResult>({ created: 0, skipped: 0, failed: 0, errors: [] });

  // Auto-start fetch as soon as the dialog opens — no extra click needed
  useEffect(() => {
    if (open && step === "idle") handleFetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ── Step 1: Fetch + deduplicate ──────────────────────────────────────────────

  const handleFetch = useCallback(async () => {
    setStep("fetching");
    setErrorMsg("");

    try {
      // 1a. Call eofficeportal API
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      let response: Response;
      try {
        response = await fetch(API_URL, { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) throw new Error(`API returned HTTP ${response.status}`);
      const xmlText = await response.text();
      const records = parseApiXml(xmlText);

      // 1b. Fetch ALL existing customer_ids — both published AND drafts
      //     (customer_id is the SOLE dedup key; PAN / name are NOT used)
      const [publishedRes, draftRes] = await Promise.all([
        supabase
          .from("clients")
          .select("customer_id")
          .not("customer_id", "is", null)
          .eq("is_draft", false) as any,
        supabase
          .from("clients")
          .select("customer_id")
          .not("customer_id", "is", null)
          .eq("is_draft", true) as any,
      ]);

      // Build Set — case-sensitive exact match (spec rule 4)
      const existingCustIds = new Set<string>([
        ...((publishedRes.data || []) as any[]).map((c: any) => String(c.customer_id)),
        ...((draftRes.data    || []) as any[]).map((c: any) => String(c.customer_id)),
      ]);

      // 1c. Split: new vs duplicate vs invalid
      //   - invalid  = customer_id null/empty in API (spec rule 3)
      //   - skipped  = customer_id already in DB     (spec rule 1)
      //   - toImport = net-new records only           (spec rule 5)
      const toImport: ApiRecord[] = [];
      let skip    = 0;
      let invalid = 0;
      for (const r of records) {
        const custId = r.CustomerId != null ? String(r.CustomerId) : "";
        if (!custId) {
          invalid++;   // No customer_id — skip silently
          continue;
        }
        if (existingCustIds.has(custId)) {
          skip++;      // Already exists (published or draft)
        } else {
          toImport.push(r);
        }
      }

      setTotalFetched(records.length);
      setNewRecords(toImport);
      setSkippedCount(skip);
      setInvalidCount(invalid);
      setShowPreview(false);
      setStep("preview");
    } catch (err: any) {
      const msg = err?.name === "AbortError"
        ? "Request timed out (30 s). Check network connectivity."
        : (err?.message || "Unknown error");
      setErrorMsg(msg);
      setStep("error");
    }
  }, [firmId]);

  // ── Step 2: Import ────────────────────────────────────────────────────────────
  //
  // Implements createClientsFromApi spec exactly:
  //   customer_id, name, pan, entity_type, email, mobile, address, gstin,
  //   firm_id, user_id, is_draft=true, source='api_import'
  //
  // WHY is_draft=true  — Step 1 data auto-filled; Steps 2-4 still empty.
  //                      User must "Continue Setup" to complete the wizard.
  // WHY source='api_import' — feeds the "Clients via API" bifurcation tab.

  const handleImport = useCallback(async () => {
    if (newRecords.length === 0) return;
    setStep("importing");
    setProgress({ current: 0, total: newRecords.length });

    const userId = user?.id ?? null;

    // Fetch client groups (global — no firm_id filter, matches wizard behaviour)
    const { data: groups } = await supabase
      .from("client_groups")
      .select("id, name")
      .order("name");
    const groupMap = new Map<string, string>(
      (groups || []).map((g: any) => [(g.name as string).toLowerCase().trim(), g.id as string])
    );

    let created = 0;
    let failed  = 0;
    const errors: SyncError[] = [];

    for (const r of newRecords) {
      const customer_id = String(r.CustomerId);
      const name        = r.ClientName?.trim() || null;

      try {
        // Map API fields → client insert payload (spec-exact field list)
        const { error } = await supabase
          .from("clients")
          .insert({
            customer_id,
            name,
            pan:         r.PanCard?.trim()                          || null,
            entity_type: ENTITY_MAP[r.companytypename] ?? r.companytypename ?? null,
            email:       r.email?.trim()                            || null,
            mobile:      (r.Mobile || "").replace(/\D/g, "").slice(0, 10) || null,
            address:     r.ComAddress?.trim()                       || null,
            gstin:       r.GST_No?.trim() ? [r.GST_No.trim()]       : null,
            tan_number:  r.TAN_no?.trim()                           || null,
            firm_id:     firmId,
            user_id:     userId,
            is_draft:    true,         // DRAFT — needs wizard completion (GAP-4)
            source:      "api_import", // Feeds "Clients via API" tab bifurcation
          } as any);

        if (error) {
          errors.push({ customer_id, name: name ?? "", error: error.message });
          failed++;
        } else {
          // Bonus: auto-assign group membership when groupname matches exactly
          const groupId = groupMap.get((r.groupname || "").toLowerCase().trim());
          if (groupId) {
            // Best-effort — fetch the just-inserted client id
            const { data: row } = await supabase
              .from("clients")
              .select("id")
              .eq("customer_id", customer_id)
              .single() as any;
            if (row?.id) {
              await supabase.from("client_group_memberships").insert({
                client_id: row.id,
                group_id:  groupId,
                added_by:  userId,
              } as any);
            }
          }
          created++;
        }
      } catch (e: any) {
        errors.push({ customer_id, name: name ?? "", error: e?.message ?? "Unknown error" });
        failed++;
      }

      setProgress((p) => ({ ...p, current: p.current + 1 }));
    }

    setResult({ created, skipped: skippedCount, failed, errors });
    setStep("done");
    if (created > 0) onComplete();
  }, [newRecords, firmId, skippedCount, onComplete, user?.id]);

  // ── Reset ─────────────────────────────────────────────────────────────────────

  const handleClose = useCallback(() => {
    setStep("idle");
    setErrorMsg("");
    setNewRecords([]);
    setTotalFetched(0);
    setSkippedCount(0);
    setProgress({ current: 0, total: 0 });
    setInvalidCount(0);
    setShowPreview(false);
    setResult({ created: 0, skipped: 0, failed: 0, errors: [] });
    onOpenChange(false);
  }, [onOpenChange]);

  // ── Render ────────────────────────────────────────────────────────────────────

  const pct = progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

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

        {/* ── FETCHING — auto-starts when dialog opens ── */}
        {(step === "idle" || step === "fetching") && (
          <div className="py-10 flex flex-col items-center gap-5">
            <RefreshCw className="h-9 w-9 text-primary animate-spin" />
            <div className="text-center space-y-1">
              <p className="text-sm font-medium">Fetching customer list from eofficeportal…</p>
              <p className="text-xs text-muted-foreground">This may take a few seconds</p>
            </div>
            {/* Indeterminate shimmer bar */}
            <div className="w-full rounded-full h-2 bg-muted overflow-hidden">
              <div className="h-full bg-primary rounded-full animate-pulse w-2/3" />
            </div>
          </div>
        )}

        {/* ── PREVIEW ── */}
        {step === "preview" && (
          <div className="space-y-4 py-1">

            {/* 📊 Sync Summary table */}
            <div className="rounded-lg border overflow-hidden">
              <div className="bg-muted/40 px-4 py-2.5 flex items-center gap-2 border-b">
                <Users className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">Sync Summary</span>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-b">
                    <td className="px-4 py-2.5 text-muted-foreground">Total from API</td>
                    <td className="px-4 py-2.5 font-semibold text-right">{totalFetched}</td>
                  </tr>
                  <tr className="border-b">
                    <td className="px-4 py-2.5 text-muted-foreground">Already in CaFlow</td>
                    <td className="px-4 py-2.5 font-semibold text-right text-amber-600">
                      {skippedCount} <span className="text-xs font-normal">(skipped)</span>
                    </td>
                  </tr>
                  <tr className={invalidCount > 0 ? "border-b" : ""}>
                    <td className="px-4 py-2.5 text-muted-foreground">New to import</td>
                    <td className="px-4 py-2.5 font-semibold text-right text-emerald-600">
                      {newRecords.length}
                    </td>
                  </tr>
                  {invalidCount > 0 && (
                    <tr>
                      <td className="px-4 py-2.5 text-muted-foreground">Invalid (no ID)</td>
                      <td className="px-4 py-2.5 font-semibold text-right text-destructive">
                        {invalidCount}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Nothing to import */}
            {newRecords.length === 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3 flex gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  All customers already exist in CaFlow — nothing to import.
                </p>
              </div>
            )}

            {/* Warning + preview when there are new records */}
            {newRecords.length > 0 && (
              <>
                <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3 flex gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    New customers will be created as <strong>DRAFTS</strong>.
                    Complete setup via <strong>Continue Setup</strong> in the draft banner.
                  </p>
                </div>

                {/* Collapsible preview table */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowPreview((p) => !p)}
                    className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                  >
                    <span>Preview New Customers</span>
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
                          {newRecords.map((r) => (
                            <tr key={r.CustomerId} className="border-t hover:bg-muted/20">
                              <td className="px-3 py-1.5 font-mono text-muted-foreground">
                                {r.CustomerCode || String(r.CustomerId)}
                              </td>
                              <td className="px-3 py-1.5 truncate max-w-[180px]">
                                {r.ClientName || "—"}
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
              </>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              {newRecords.length > 0 && (
                <Button onClick={handleImport} className="gap-2">
                  <Upload className="h-4 w-4" />
                  Import {newRecords.length} Clients
                </Button>
              )}
              {newRecords.length === 0 && (
                <Button onClick={handleClose}>Close</Button>
              )}
            </DialogFooter>
          </div>
        )}

        {/* ── IMPORTING ── */}
        {step === "importing" && (
          <div className="py-8 space-y-5">
            <div className="flex items-center gap-3">
              <RefreshCw className="h-5 w-5 text-primary animate-spin shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold">
                  Importing… {progress.current} / {progress.total}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Do not close this window.
                </p>
              </div>
            </div>
            <Progress value={pct} className="h-2.5" />
            <p className="text-xs text-right text-muted-foreground tabular-nums">{pct}%</p>
          </div>
        )}

        {/* ── DONE ── */}
        {step === "done" && (
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
                      {result.created} new draft client{result.created !== 1 ? "s" : ""}
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="px-4 py-2.5 text-muted-foreground">Skipped</td>
                    <td className="px-4 py-2.5 font-semibold text-amber-600">
                      {result.skipped} (already exist)
                    </td>
                  </tr>
                  <tr className={result.failed > 0 ? "border-b" : ""}>
                    <td className="px-4 py-2.5 text-muted-foreground">Failed</td>
                    <td className={`px-4 py-2.5 font-semibold ${result.failed > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                      {result.failed}{result.failed > 0 ? " (see errors below)" : ""}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Error detail list */}
            {result.failed > 0 && result.errors.length > 0 && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-xs font-semibold text-destructive mb-2">Errors:</p>
                <ul className="text-xs space-y-1 text-destructive/80">
                  {result.errors.slice(0, 10).map((e, i) => (
                    <li key={i}>
                      • <span className="font-mono">{e.customer_id}</span>: {e.error}
                    </li>
                  ))}
                  {result.errors.length > 10 && (
                    <li className="text-muted-foreground">
                      … and {result.errors.length - 10} more
                    </li>
                  )}
                </ul>
              </div>
            )}

            {/* Guidance note */}
            {result.created > 0 && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 p-3 flex gap-2">
                <Users className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                <p className="text-xs text-emerald-700 dark:text-emerald-300">
                  Draft clients appear in the <strong>Clients via API</strong> tab and
                  in the Draft banner. Complete setup via <strong>Continue Setup</strong>.
                </p>
              </div>
            )}

            <DialogFooter>
              <Button onClick={handleClose}>Close</Button>
            </DialogFooter>
          </div>
        )}

        {/* ── ERROR ── */}
        {step === "error" && (
          <div className="space-y-4 py-2">
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 flex gap-3">
              <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-destructive">Sync failed</p>
                <p className="text-xs text-muted-foreground break-all">{errorMsg}</p>
                {(errorMsg.includes("SSL") ||
                  errorMsg.includes("cert") ||
                  errorMsg.includes("Failed to fetch") ||
                  errorMsg.includes("ERR_CERT") ||
                  errorMsg.includes("NetworkError")) && (
                  <p className="text-xs text-amber-600 mt-1">
                    ⚠️ The API server's SSL certificate may be expired. Ask your IT
                    team to renew the certificate at eofficeportal.com, then retry.
                  </p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Close</Button>
              <Button
                onClick={() => { setStep("idle"); setErrorMsg(""); handleFetch(); }}
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
