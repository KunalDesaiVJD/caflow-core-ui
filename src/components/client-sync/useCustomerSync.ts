/**
 * useCustomerSync — all sync logic isolated in one hook.
 *
 * API:  https://eofficeportal.com/Company/SmartService.asmx/FillCustomerlist
 *       ?customerGroupid=null<key>
 * Format: text/xml wrapping a JSON array in <string> element
 *
 * CORS / SSL strategy (two-tier):
 *   1. Try Supabase Edge Function proxy first (`customer-sync`).
 *      The Edge Function calls the API server-side — no CORS, no SSL issues.
 *   2. If the Edge Function call fails (e.g. not yet deployed), fall back to
 *      a direct browser fetch of CUSTOMER_SYNC_API_URL.
 *      Direct fetch WILL fail in production if the SSL cert is expired.
 *
 * To deploy the Edge Function:
 *   npx supabase functions deploy customer-sync --project-ref hubyywmodekfdzhwiumb
 *
 * Future: move CUSTOMER_SYNC_API_URL to env var or admin settings.
 */

import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

// ─── API config (single source of truth) ──────────────────────────────────────

export const CUSTOMER_SYNC_API_URL =
  "https://eofficeportal.com/Company/SmartService.asmx/FillCustomerlist" +
  "?customerGroupid=nullksd9ow34e9w0sdmoaskjof8w0eur0wejfomasdojo9auwerwjrowejmfojaspf";

// ─── Entity type mapping (8 values confirmed from live API) ───────────────────

export const ENTITY_MAP: Record<string, string> = {
  "INDIVIDUAL":  "Individual",
  "FIRM":        "Partnership",
  "LLP":         "LLP",
  "HUF":         "HUF",
  "PVT. LTD.":  "Private Ltd",
  "PUBLIC LTD":  "Public Ltd",
  "AOP":         "AOP",
  "Trust":       "Trust",
};

// ─── Batch size for concurrent inserts ────────────────────────────────────────

const BATCH_SIZE = 25;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ApiRecord {
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

export interface SyncError {
  customer_id: string;
  name:        string;
  error:       string;
}

export interface SyncResults {
  created:      number;
  skipped:      number;
  failed:       number;
  errors:       SyncError[];
  wasCancelled: boolean;   // true when user cancelled mid-import
}

export interface SyncProgress {
  current: number;
  total:   number;
}

export type SyncStatus = "idle" | "fetching" | "previewing" | "importing" | "done" | "error";

// ─── Error classifier — converts raw exceptions into user-friendly messages ───

function classifyFetchError(err: unknown, edgeFnAvailable: boolean): string {
  if (!(err instanceof Error)) return String(err);

  const { name, message } = err;

  // 1. Timeout (AbortError from our 30-second timer)
  if (name === "AbortError") {
    return "Could not reach eofficeportal.com. Check internet connection.";
  }

  // 2. Parse / empty data errors
  if (
    message.includes("missing expected <string>") ||
    message.includes("Expected a JSON array") ||
    message.includes("Empty <string>") ||
    message.includes("Could not retrieve customer list") ||
    message.includes("empty or invalid data")
  ) {
    return "API returned empty or invalid data. Contact administrator.";
  }

  // 3. Network / CORS errors ("Failed to fetch" is browser's generic message
  //    for both CORS rejections and genuine network failures)
  if (
    message.includes("Failed to fetch") ||
    message.includes("NetworkError") ||
    message.includes("ERR_NETWORK") ||
    message.toLowerCase().includes("cors")
  ) {
    if (!edgeFnAvailable) {
      // Edge Function was never reached — browser is blocking the cross-origin call
      return (
        "Cross-origin request blocked. Server-side proxy required.\n" +
        "Deploy: npx supabase functions deploy customer-sync --project-ref hubyywmodekfdzhwiumb"
      );
    }
    // Edge Function IS available but the upstream API is unreachable
    return "Could not reach eofficeportal.com. Check internet connection.";
  }

  // 4. HTTP errors from upstream
  if (message.includes("HTTP ")) {
    return "Could not reach eofficeportal.com. Check internet connection.";
  }

  return message;
}

// ─── XML → JSON parser ────────────────────────────────────────────────────────

function parseCustomerList(rawText: string): ApiRecord[] {
  if (!rawText?.trim()) {
    throw new Error("API returned empty or invalid data. Contact administrator.");
  }
  // Response is text/xml wrapping a JSON array inside <string> element
  const parser  = new DOMParser();
  const xmlDoc  = parser.parseFromString(rawText, "text/xml");
  const strEl   = xmlDoc.querySelector("string");
  if (!strEl) throw new Error("API response is missing expected <string> element");
  const jsonStr = strEl.textContent || "";
  if (!jsonStr.trim()) throw new Error("Empty <string> element in API response");
  const records = JSON.parse(jsonStr);
  if (!Array.isArray(records)) throw new Error("Expected a JSON array inside the XML");
  return records as ApiRecord[];
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCustomerSync() {
  const { user } = useAuth();

  // Mutable cancel flag — useRef so async loops see latest value immediately
  const cancelRef = useRef(false);

  const [status,         setStatus]         = useState<SyncStatus>("idle");
  const [errorMsg,       setErrorMsg]       = useState("");
  const [apiRecords,     setApiRecords]     = useState<ApiRecord[]>([]);
  const [newRecords,     setNewRecords]     = useState<ApiRecord[]>([]);
  const [skippedRecords, setSkippedRecords] = useState<ApiRecord[]>([]);
  const [invalidCount,   setInvalidCount]   = useState(0);
  const [progress,       setProgress]       = useState<SyncProgress>({ current: 0, total: 0 });
  const [results,        setResults]        = useState<SyncResults | null>(null);

  // ── 1. Fetch from API + deduplicate ─────────────────────────────────────────

  const fetchAndPreview = useCallback(async () => {
    setStatus("fetching");
    setErrorMsg("");

    // Track whether Edge Function was reachable (used by classifyFetchError)
    let edgeFnAvailable = false;

    try {
      let records: ApiRecord[] | null = null;
      let edgeFnError = "";

      // ── Tier 1: Supabase Edge Function proxy (server-side, no CORS/SSL issues)
      try {
        const { data: fnData, error: fnError } = await supabase.functions.invoke(
          "customer-sync",
          { method: "GET" },
        );
        if (fnError) {
          edgeFnError = fnError.message || "Edge Function error";
          // FunctionsHttpError has .context.status — a real HTTP response means
          // the function exists even if it returned a non-2xx code.
          if ((fnError as any).context?.status) {
            edgeFnAvailable = true;
          }
        } else if (fnData?.records && Array.isArray(fnData.records)) {
          records        = fnData.records as ApiRecord[];
          edgeFnAvailable = true;
          console.log("[Sync] Records via Edge Function:", records.length);
        } else if (fnData?.error) {
          // Edge Function ran but upstream failed (e.g. SSL cert expired)
          edgeFnError    = fnData.error;
          edgeFnAvailable = true; // function IS deployed, upstream API is the problem
          console.warn("[Sync] Edge Function upstream error:", edgeFnError);
        }
      } catch (e: any) {
        edgeFnError = e?.message ?? "Edge Function unavailable";
        console.warn("[Sync] Edge Function threw:", edgeFnError);
      }

      // ── Tier 2: Direct browser fetch (fallback — works if no CORS/SSL issue)
      if (!records) {
        console.warn("[Sync] Falling back to direct fetch. Edge Function error:", edgeFnError);

        const controller = new AbortController();
        const timer      = setTimeout(() => controller.abort(), 30_000);
        let response: Response;
        try {
          response = await fetch(CUSTOMER_SYNC_API_URL, { signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }

        const contentType = response.headers.get("content-type") ?? "unknown";
        console.log("[Sync] API response format:", contentType);

        if (!response.ok) throw new Error(`API returned HTTP ${response.status}`);

        const rawText = await response.text();
        if (!rawText.trim()) {
          // Log full (empty) response for debugging
          console.error("[Sync] Empty response body from API. Content-Type:", contentType);
          throw new Error("API returned empty or invalid data. Contact administrator.");
        }
        console.log("[Sync] Raw response length (chars):", rawText.length);

        records = parseCustomerList(rawText);
      }

      // Should never reach here, but guard for TypeScript
      if (!records) throw new Error("Could not retrieve customer list from API.");

      console.log("[Sync] Total records from API:", records.length);
      setApiRecords(records);

      // ── Deduplicate: customer_id is the SOLE key — check BOTH published + drafts
      setStatus("previewing");
      const [publishedRes, draftRes] = await Promise.all([
        (supabase.from("clients").select("customer_id")
          .not("customer_id", "is", null)
          .eq("is_draft", false)) as any,
        (supabase.from("clients").select("customer_id")
          .not("customer_id", "is", null)
          .eq("is_draft", true)) as any,
      ]);

      const existingIds = new Set<string>([
        ...((publishedRes.data || []) as any[]).map((c: any) => String(c.customer_id)),
        ...((draftRes.data    || []) as any[]).map((c: any) => String(c.customer_id)),
      ]);

      console.log("[Sync] Existing customer_ids in DB:", existingIds.size);

      const toImport:  ApiRecord[] = [];
      const alreadyIn: ApiRecord[] = [];
      let invalid = 0;

      for (const r of records) {
        const custId = r.CustomerId != null ? String(r.CustomerId) : "";
        if (!custId) { invalid++; continue; }
        if (existingIds.has(custId)) { alreadyIn.push(r); }
        else                         { toImport.push(r);  }
      }

      console.log("[Sync] New records to import:", toImport.length);
      console.log("[Sync] Skipped records:", alreadyIn.length);

      setNewRecords(toImport);
      setSkippedRecords(alreadyIn);
      setInvalidCount(invalid);
      setStatus("previewing");

    } catch (err: unknown) {
      const msg = classifyFetchError(err, edgeFnAvailable);
      console.error("[Sync] fetchAndPreview error:", err);
      setErrorMsg(msg);
      setStatus("error");
    }
  }, []);

  // ── 2. Execute import (batched, cancellable) ─────────────────────────────────

  const executeImport = useCallback(async (firmId: string | null) => {
    if (newRecords.length === 0) return;

    cancelRef.current = false;
    setStatus("importing");
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

    // ── Split into chunks of BATCH_SIZE and process each chunk concurrently ──
    const chunks: ApiRecord[][] = [];
    for (let i = 0; i < newRecords.length; i += BATCH_SIZE) {
      chunks.push(newRecords.slice(i, i + BATCH_SIZE));
    }

    for (const chunk of chunks) {
      // Check cancel flag before each batch
      if (cancelRef.current) break;

      // Each record in the chunk is inserted in parallel (Promise.all).
      // We use a discriminated union so individual failures never reject the batch.
      type InsertResult =
        | { ok: true }
        | { ok: false; syncError: SyncError };

      const chunkResults: InsertResult[] = await Promise.all(
        chunk.map(async (r): Promise<InsertResult> => {
          const customer_id = String(r.CustomerId);
          const name        = r.ClientName?.trim() || null;

          try {
            const { error } = await supabase
              .from("clients")
              .insert({
                customer_id,
                name,
                pan:         r.PanCard?.trim()                                    || null,
                entity_type: ENTITY_MAP[r.companytypename] ?? r.companytypename  ?? null,
                email:       r.email?.trim()                                      || null,
                mobile:      (r.Mobile || "").replace(/\D/g, "").slice(0, 10)    || null,
                address:     r.ComAddress?.trim()                                 || null,
                gstin:       r.GST_No?.trim() ? [r.GST_No.trim()]                 : null,
                tan_number:  r.TAN_no?.trim()                                     || null,
                firm_id:     firmId,
                user_id:     userId,
                is_draft:    true,          // DRAFT — Steps 2-4 still empty
                source:      "api_import",  // Feeds "Clients via API" tab
              } as any);

            if (error) {
              // Detect duplicate PAN constraint violation (Postgres code 23505)
              let errorMsg = error.message;
              const isPanDupe =
                error.code === "23505" &&
                (error.message.toLowerCase().includes("pan") ||
                  ((error as any).details ?? "").toLowerCase().includes("pan"));
              if (isPanDupe) {
                errorMsg = `Duplicate PAN: ${r.PanCard?.trim() || "unknown"}`;
              }
              return { ok: false, syncError: { customer_id, name: name ?? "", error: errorMsg } };
            }

            // Auto-assign group membership (best effort — never fails the import)
            const groupId = groupMap.get((r.groupname || "").toLowerCase().trim());
            if (groupId) {
              try {
                const { data: row } = await (supabase
                  .from("clients")
                  .select("id")
                  .eq("customer_id", customer_id)
                  .single() as any);
                if (row?.id) {
                  await supabase.from("client_group_memberships").insert({
                    client_id: row.id, group_id: groupId, added_by: userId,
                  } as any);
                }
              } catch { /* best effort — do not fail import */ }
            }

            return { ok: true };
          } catch (e: any) {
            return {
              ok: false,
              syncError: { customer_id, name: name ?? "", error: e?.message ?? "Unknown" },
            };
          }
        })
      );

      // Tally results from this batch
      for (const r of chunkResults) {
        if (r.ok) { created++; }
        else       { errors.push(r.syncError); failed++; }
      }

      setProgress((p) => ({
        ...p,
        current: Math.min(p.current + chunk.length, newRecords.length),
      }));
    }

    const finalResults: SyncResults = {
      created,
      skipped:      skippedRecords.length,
      failed,
      errors,
      wasCancelled: cancelRef.current,
    };

    console.log("[Sync] Import results:", finalResults);
    setResults(finalResults);
    setStatus("done");
  }, [newRecords, skippedRecords.length, user?.id]);

  // ── 3. Cancel mid-import ─────────────────────────────────────────────────────

  const cancelImport = useCallback(() => {
    cancelRef.current = true;
    // The import loop checks cancelRef before each batch and stops gracefully.
    // Already-created drafts are kept — user can delete them from the Clients page.
  }, []);

  // ── 4. Reset ─────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    cancelRef.current = false;
    setStatus("idle");
    setErrorMsg("");
    setApiRecords([]);
    setNewRecords([]);
    setSkippedRecords([]);
    setInvalidCount(0);
    setProgress({ current: 0, total: 0 });
    setResults(null);
  }, []);

  return {
    status,
    errorMsg,
    apiRecords,
    newRecords,
    skippedRecords,
    invalidCount,
    progress,
    results,
    fetchAndPreview,
    executeImport,
    cancelImport,
    reset,
  };
}
