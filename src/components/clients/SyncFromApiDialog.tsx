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

import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
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

interface SyncResult {
  created:     number;
  skipped:     number;
  failed:      number;
  failedNames: string[];
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
  const [step,         setStep]         = useState<SyncStep>("idle");
  const [errorMsg,     setErrorMsg]     = useState("");
  const [newRecords,   setNewRecords]   = useState<ApiRecord[]>([]);
  const [totalFetched, setTotalFetched] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const [progress,     setProgress]     = useState({ current: 0, total: 0 });
  const [result,       setResult]       = useState<SyncResult>({ created: 0, skipped: 0, failed: 0, failedNames: [] });

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

      // 1c. Split: new vs duplicate
      //   - Skip if customer_id is null/empty in API response (spec rule 3)
      //   - Skip if customer_id already exists in DB (spec rule 1)
      //   - Repeated syncs safe — only truly new records pass through (spec rule 5)
      const toImport: ApiRecord[] = [];
      let skip = 0;
      for (const r of records) {
        const custId = r.CustomerId != null ? String(r.CustomerId) : "";
        if (!custId) {
          skip++; // No customer_id in API record — skip
          continue;
        }
        if (existingCustIds.has(custId)) {
          skip++; // Already exists (published or draft)
        } else {
          toImport.push(r);
        }
      }

      setTotalFetched(records.length);
      setNewRecords(toImport);
      setSkippedCount(skip);
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

  const handleImport = useCallback(async () => {
    if (newRecords.length === 0) return;
    setStep("importing");
    setProgress({ current: 0, total: newRecords.length });

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
    const failedNames: string[] = [];

    for (const r of newRecords) {
      try {
        const gstin    = r.GST_No?.trim()  ? [r.GST_No.trim()]                   : null;
        const mobile   = (r.Mobile || "").replace(/\D/g, "").slice(0, 10) || null;
        const tan      = r.TAN_no?.trim()  || null;
        const pan      = r.PanCard?.trim() || null;
        const email    = r.email?.trim()   || null;
        const address  = r.ComAddress?.trim() || null;
        const name     = r.ClientName?.trim() || null;
        const entity   = ENTITY_MAP[r.companytypename] ?? r.companytypename ?? null;

        const payload = {
          customer_id:  String(r.CustomerId),
          name,
          pan,
          email,
          mobile,
          address,
          entity_type:  entity,
          gstin,
          tan_number:   tan,
          source:       "api_import",
          is_draft:     true,
          firm_id:      firmId,
        };

        const { data: inserted, error: insertErr } = await supabase
          .from("clients")
          .insert(payload as any)
          .select("id")
          .single();

        if (insertErr) throw insertErr;

        // Insert group membership if group name matches an existing group
        const groupName = (r.groupname || "").toLowerCase().trim();
        const groupId   = groupMap.get(groupName);
        if (groupId && inserted?.id) {
          await supabase.from("client_group_memberships").insert({
            client_id: inserted.id,
            group_id:  groupId,
            added_by:  null,
          } as any);
        }

        created++;
      } catch {
        failed++;
        failedNames.push(r.ClientName || `ID ${r.CustomerId}`);
      }

      setProgress((p) => ({ ...p, current: p.current + 1 }));
    }

    setResult({ created, skipped: skippedCount, failed, failedNames });
    setStep("done");
    if (created > 0) onComplete();
  }, [newRecords, firmId, skippedCount, onComplete]);

  // ── Reset ─────────────────────────────────────────────────────────────────────

  const handleClose = useCallback(() => {
    setStep("idle");
    setErrorMsg("");
    setNewRecords([]);
    setTotalFetched(0);
    setSkippedCount(0);
    setProgress({ current: 0, total: 0 });
    setResult({ created: 0, skipped: 0, failed: 0, failedNames: [] });
    onOpenChange(false);
  }, [onOpenChange]);

  // ── Render ────────────────────────────────────────────────────────────────────

  const pct = progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-primary" />
            Sync Clients from API
          </DialogTitle>
          <DialogDescription>
            Fetch customers from eofficeportal and import new ones into CaFlow.
          </DialogDescription>
        </DialogHeader>

        {/* ── IDLE ── */}
        {step === "idle" && (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              This will fetch all customers from your eofficeportal account and create
              new draft clients for any that don't already exist (matched by PAN or
              Customer ID).
            </p>
            <ul className="text-sm space-y-1 text-muted-foreground list-disc list-inside">
              <li>Existing clients (same PAN or Customer ID) are skipped</li>
              <li>New clients are created as drafts (<code>is_draft = true</code>)</li>
              <li>Group membership is auto-assigned when group names match</li>
              <li>Entity types are mapped from API to CaFlow values</li>
            </ul>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleFetch} className="gap-2">
                <RefreshCw className="h-4 w-4" /> Fetch from API
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* ── FETCHING ── */}
        {step === "fetching" && (
          <div className="py-8 flex flex-col items-center gap-4">
            <RefreshCw className="h-8 w-8 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">
              Fetching customers from eofficeportal…
            </p>
          </div>
        )}

        {/* ── PREVIEW ── */}
        {step === "preview" && (
          <div className="space-y-4 py-2">
            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border bg-muted/30 p-3 text-center">
                <p className="text-2xl font-bold text-foreground">{totalFetched}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Fetched</p>
              </div>
              <div className="rounded-lg border bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800 p-3 text-center">
                <p className="text-2xl font-bold text-emerald-600">{newRecords.length}</p>
                <p className="text-xs text-emerald-600 mt-0.5">New</p>
              </div>
              <div className="rounded-lg border bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 p-3 text-center">
                <p className="text-2xl font-bold text-amber-600">{skippedCount}</p>
                <p className="text-xs text-amber-600 mt-0.5">Already exist</p>
              </div>
            </div>

            {newRecords.length === 0 ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-4 flex gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  All {totalFetched} clients already exist in CaFlow — nothing to import.
                </p>
              </div>
            ) : (
              <>
                {/* Preview table — first 5 rows */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    Preview (first {Math.min(5, newRecords.length)} of {newRecords.length} new clients)
                  </p>
                  <div className="rounded-md border overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">Name</th>
                          <th className="text-left px-3 py-2 font-medium">PAN</th>
                          <th className="text-left px-3 py-2 font-medium">Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {newRecords.slice(0, 5).map((r) => (
                          <tr key={r.CustomerId} className="border-t">
                            <td className="px-3 py-1.5 truncate max-w-[140px]">{r.ClientName || "—"}</td>
                            <td className="px-3 py-1.5 font-mono">{r.PanCard || "—"}</td>
                            <td className="px-3 py-1.5">
                              <Badge variant="outline" className="text-[10px] px-1 py-0">
                                {ENTITY_MAP[r.companytypename] ?? r.companytypename ?? "—"}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {newRecords.length > 5 && (
                      <p className="text-xs text-muted-foreground px-3 py-2 border-t bg-muted/20">
                        … and {newRecords.length - 5} more
                      </p>
                    )}
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  All {newRecords.length} new clients will be created as <strong>drafts</strong> with
                  source = <code>api_import</code>. Complete their setup via the Clients page.
                </p>
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
            </DialogFooter>
          </div>
        )}

        {/* ── IMPORTING ── */}
        {step === "importing" && (
          <div className="py-6 space-y-4">
            <div className="flex items-center gap-3">
              <RefreshCw className="h-5 w-5 text-primary animate-spin shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium">
                  Importing {progress.current} / {progress.total} clients…
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">Do not close this window.</p>
              </div>
            </div>
            <Progress value={pct} className="h-2" />
            <p className="text-xs text-right text-muted-foreground">{pct}%</p>
          </div>
        )}

        {/* ── DONE ── */}
        {step === "done" && (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800 p-3 text-center">
                <CheckCircle2 className="h-5 w-5 text-emerald-500 mx-auto mb-1" />
                <p className="text-2xl font-bold text-emerald-600">{result.created}</p>
                <p className="text-xs text-emerald-600 mt-0.5">Created</p>
              </div>
              <div className="rounded-lg border bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 p-3 text-center">
                <SkipForward className="h-5 w-5 text-amber-500 mx-auto mb-1" />
                <p className="text-2xl font-bold text-amber-600">{result.skipped}</p>
                <p className="text-xs text-amber-600 mt-0.5">Skipped</p>
              </div>
              <div className={`rounded-lg border p-3 text-center ${
                result.failed > 0
                  ? "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800"
                  : "bg-muted/30"
              }`}>
                {result.failed > 0
                  ? <XCircle className="h-5 w-5 text-destructive mx-auto mb-1" />
                  : <CheckCircle2 className="h-5 w-5 text-muted-foreground mx-auto mb-1" />
                }
                <p className={`text-2xl font-bold ${result.failed > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                  {result.failed}
                </p>
                <p className={`text-xs mt-0.5 ${result.failed > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                  Failed
                </p>
              </div>
            </div>

            {result.created > 0 && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 p-3 flex gap-2">
                <Users className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                <p className="text-sm text-emerald-700 dark:text-emerald-300">
                  {result.created} client{result.created !== 1 ? "s" : ""} created as drafts.
                  Visit the <strong>Clients via API</strong> tab to complete their setup.
                </p>
              </div>
            )}

            {result.failed > 0 && result.failedNames.length > 0 && (
              <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/20 p-3">
                <p className="text-xs font-medium text-destructive mb-1.5">
                  {result.failed} failed import{result.failed !== 1 ? "s" : ""}:
                </p>
                <ul className="text-xs text-destructive/80 space-y-0.5 list-disc list-inside">
                  {result.failedNames.slice(0, 10).map((n, i) => <li key={i}>{n}</li>)}
                  {result.failedNames.length > 10 && (
                    <li>… and {result.failedNames.length - 10} more</li>
                  )}
                </ul>
              </div>
            )}

            <DialogFooter>
              <Button onClick={handleClose} className="gap-2">
                <CheckCircle2 className="h-4 w-4" /> Done
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* ── ERROR ── */}
        {step === "error" && (
          <div className="space-y-4 py-2">
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 flex gap-3">
              <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-destructive">Sync failed</p>
                <p className="text-xs text-muted-foreground break-all">{errorMsg}</p>
                {(errorMsg.includes("SSL") || errorMsg.includes("cert") || errorMsg.includes("Failed to fetch") || errorMsg.includes("ERR_CERT")) && (
                  <p className="text-xs text-amber-600 mt-2">
                    ⚠️ The API server's SSL certificate may be expired. Ask your IT team
                    to renew the certificate at eofficeportal.com, then retry.
                  </p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Close</Button>
              <Button onClick={() => { setStep("idle"); setErrorMsg(""); }} className="gap-2">
                <RotateCcw className="h-4 w-4" /> Try Again
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
