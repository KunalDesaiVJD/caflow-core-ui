/**
 * useCustomerSync — all sync logic isolated in one hook.
 *
 * API:  https://eofficeportal.com/Company/SmartService.asmx/FillCustomerlist
 *       ?customerGroupid=null<key>
 * Format: text/xml wrapping a JSON array in <string> element
 *
 * Future: move CUSTOMER_SYNC_API_URL to env var or admin settings.
 */

import { useState, useCallback } from "react";
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
  created: number;
  skipped: number;
  failed:  number;
  errors:  SyncError[];
}

export interface SyncProgress {
  current: number;
  total:   number;
}

export type SyncStatus = "idle" | "fetching" | "previewing" | "importing" | "done" | "error";

// ─── XML → JSON parser ────────────────────────────────────────────────────────

function parseCustomerList(rawText: string): ApiRecord[] {
  // Response is text/xml wrapping a JSON array inside <string> element
  const parser  = new DOMParser();
  const xmlDoc  = parser.parseFromString(rawText, "text/xml");
  const strEl   = xmlDoc.querySelector("string");
  if (!strEl) throw new Error("API response is missing expected <string> element");
  const jsonStr = strEl.textContent || "";
  const records = JSON.parse(jsonStr);
  if (!Array.isArray(records)) throw new Error("Expected a JSON array inside the XML");
  return records as ApiRecord[];
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCustomerSync() {
  const { user } = useAuth();

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

    try {
      // Call the eofficeportal API
      // CORS NOTE: If this fails in browser, implement a Supabase Edge Function proxy:
      //   supabase/functions/customer-sync/index.ts → calls API server-side
      //   Frontend: supabase.functions.invoke('customer-sync')
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      let response: Response;
      try {
        response = await fetch(CUSTOMER_SYNC_API_URL, { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) throw new Error(`API returned HTTP ${response.status}`);
      const rawText = await response.text();

      const records = parseCustomerList(rawText);
      setApiRecords(records);

      // Deduplicate: customer_id is the SOLE key — check BOTH published + drafts
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

      const toImport:   ApiRecord[] = [];
      const alreadyIn:  ApiRecord[] = [];
      let invalid = 0;

      for (const r of records) {
        const custId = r.CustomerId != null ? String(r.CustomerId) : "";
        if (!custId) {
          invalid++;
          continue;
        }
        if (existingIds.has(custId)) {
          alreadyIn.push(r);
        } else {
          toImport.push(r);
        }
      }

      setNewRecords(toImport);
      setSkippedRecords(alreadyIn);
      setInvalidCount(invalid);
      setStatus("previewing");
    } catch (err: any) {
      const msg = err?.name === "AbortError"
        ? "Request timed out (30 s). Check network connectivity."
        : (err?.message || "Unknown error");
      setErrorMsg(msg);
      setStatus("error");
    }
  }, []);

  // ── 2. Execute import ────────────────────────────────────────────────────────

  const executeImport = useCallback(async (firmId: string | null) => {
    if (newRecords.length === 0) return;
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

    for (const r of newRecords) {
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
            is_draft:    true,         // DRAFT — Steps 2-4 still empty (GAP-4)
            source:      "api_import", // Feeds "Clients via API" tab
          } as any);

        if (error) {
          errors.push({ customer_id, name: name ?? "", error: error.message });
          failed++;
        } else {
          // Auto-assign group membership when groupname matches an existing group
          const groupId = groupMap.get((r.groupname || "").toLowerCase().trim());
          if (groupId) {
            const { data: row } = await (supabase.from("clients").select("id")
              .eq("customer_id", customer_id).single() as any);
            if (row?.id) {
              await supabase.from("client_group_memberships").insert({
                client_id: row.id, group_id: groupId, added_by: userId,
              } as any);
            }
          }
          created++;
        }
      } catch (e: any) {
        errors.push({ customer_id, name: name ?? "", error: e?.message ?? "Unknown" });
        failed++;
      }

      setProgress((p) => ({ ...p, current: p.current + 1 }));
    }

    setResults({ created, skipped: skippedRecords.length, failed, errors });
    setStatus("done");
  }, [newRecords, skippedRecords.length, user?.id]);

  // ── Reset ─────────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
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
    reset,
  };
}
