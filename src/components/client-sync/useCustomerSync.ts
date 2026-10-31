/**
 * useCustomerSync — all sync logic isolated in one hook.
 *
 * SECURITY (enterprise audit, 2026-08): this hook used to embed the eofficeportal
 * access token directly in client-side source (shipped to every visitor's
 * browser) and fall back to fetching eofficeportal.com DIRECTLY from the
 * browser — both removed for good, replaced with two authenticated,
 * server-side-only proxies:
 *
 *   Tier 0 — Vercel serverless function /api/eoffice (Node.js). Tried FIRST
 *            because it's the only environment that can actually reach
 *            eofficeportal.com: the host's TLS certificate is expired, and
 *            Node's https.Agent({rejectUnauthorized:false}) genuinely
 *            bypasses that (scoped to this one request, not process-wide).
 *   Tier 1 — Supabase edge function `customer-sync` (Deno). Kept as a
 *            fallback, but Deno's TLS stack does NOT honour
 *            rejectUnauthorized:false — confirmed via edge function logs,
 *            every fetch strategy there fails with "invalid peer
 *            certificate: Expired" — so this tier only helps once
 *            eofficeportal.com's certificate is actually renewed.
 *
 * Both require a valid CAFlow session (Bearer token) and read the
 * eofficeportal access token from a server-side secret
 * (EOFFICE_CUSTOMER_GROUP_ID — a Vercel env var for Tier 0, a Supabase
 * secret for Tier 1), never from client-bundled source.
 *
 * To deploy the Edge Function:
 *   npx supabase functions deploy customer-sync --project-ref hubyywmodekfdzhwiumb
 *
 * Sync behaviour:
 *   - Only ACTIVE clients are imported (IsActive / Status field on API record).
 *   - NEW clients  → INSERT as draft (source='api_import').
 *   - EXISTING clients → UPDATE all API fields except customer_id.
 *   - Groups from API are auto-created if they don't exist, then client is assigned.
 */

import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { decodeHtmlEntities } from "@/lib/htmlEntities";

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

// Auto-assigned colours for groups created during sync (cycles if >10 groups)
const AUTO_GROUP_COLORS = [
  "#6366f1", "#10b981", "#f59e0b", "#ef4444", "#3b82f6",
  "#8b5cf6", "#06b6d4", "#84cc16", "#f97316", "#ec4899",
];

// ─── Batch size for concurrent inserts / updates ──────────────────────────────

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
  // Active / status fields (vary by API version — all variants checked)
  Active?:         string;                   // "Yes" / "No"
  IsActive?:       boolean | number | string; // true/false, 1/0, "Active"
  Status?:         string;                   // "Active" / other
}

export interface SyncError {
  customer_id: string;
  name:        string;
  error:       string;
}

export interface SyncResults {
  created:      number;
  updated:      number;      // records that already existed and were refreshed
  inactive:     number;      // records filtered out because IsActive=false / Status≠Active
  failed:       number;
  errors:       SyncError[];
  wasCancelled: boolean;     // true when user cancelled mid-import
}

export interface SyncProgress {
  current: number;
  total:   number;
}

export type SyncStatus = "idle" | "fetching" | "previewing" | "importing" | "done" | "error";

// ─── Active-record filter ─────────────────────────────────────────────────────
// Returns true when the record is active.
// Checks all known field variants the API may return (Active / IsActive / Status).
// If NONE of these fields are present, the record is assumed active.

function isActiveRecord(r: ApiRecord): boolean {
  // 1. "Active": "Yes" / "No"  (confirmed field in current API)
  if (r.Active !== undefined && r.Active !== null && r.Active !== "") {
    const v = String(r.Active).toLowerCase().trim();
    // "no" = inactive; anything else that's a truthy string = active
    if (v === "no"  || v === "false" || v === "0" || v === "n") return false;
    if (v === "yes" || v === "true"  || v === "1" || v === "y") return true;
  }

  // 2. "IsActive": true / false / 1 / 0 / "Active"
  if (r.IsActive !== undefined && r.IsActive !== null && r.IsActive !== "") {
    const v = String(r.IsActive).toLowerCase().trim();
    return v === "true" || v === "1" || v === "active" || v === "y" || v === "yes";
  }

  // 3. "Status": "Active" / other
  if (r.Status !== undefined && r.Status !== null && r.Status !== "") {
    return String(r.Status).toLowerCase().trim() === "active";
  }

  // No active/status field present — include (assume active)
  return true;
}

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
      return (
        "Cross-origin request blocked. Server-side proxy required.\n" +
        "Deploy: npx supabase functions deploy customer-sync --project-ref hubyywmodekfdzhwiumb"
      );
    }
    return "Could not reach eofficeportal.com. Check internet connection.";
  }

  // 4. Detailed "All fetch attempts failed" from Edge Function — show as-is
  if (message.startsWith("All fetch attempts failed")) {
    return message;
  }

  // 5. HTTP errors from upstream
  if (message.includes("HTTP ")) {
    return "Could not reach eofficeportal.com. Check internet connection.";
  }

  return message;
}

// ─── Build field-update payload shared by INSERT and UPDATE ───────────────────

// eOffice sends text HTML-escaped ("V J DESAI &amp; CO LLP"); store it plain.
function buildClientPayload(r: ApiRecord) {
  return {
    name:        decodeHtmlEntities(r.ClientName).trim()              || null,
    pan:         r.PanCard?.trim()                                    || null,
    entity_type: ENTITY_MAP[r.companytypename] ?? r.companytypename  ?? null,
    email:       r.email?.trim()                                      || null,
    mobile:      (r.Mobile || "").replace(/\D/g, "").slice(0, 10)    || null,
    address:     decodeHtmlEntities(r.ComAddress).trim()              || null,
    gstin:       r.GST_No?.trim() ? [r.GST_No.trim()]                : null,
    tan_number:  r.TAN_no?.trim()                                     || null,
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCustomerSync() {
  const { user } = useAuth();

  const cancelRef = useRef(false);

  const [status,          setStatus]          = useState<SyncStatus>("idle");
  const [errorMsg,        setErrorMsg]        = useState("");
  const [apiRecords,      setApiRecords]      = useState<ApiRecord[]>([]);
  const [newRecords,      setNewRecords]      = useState<ApiRecord[]>([]);
  const [updatedRecords,  setUpdatedRecords]  = useState<ApiRecord[]>([]);  // exist in DB → will update
  const [inactiveCount,   setInactiveCount]   = useState(0);                // filtered out
  const [invalidCount,    setInvalidCount]    = useState(0);
  const [progress,        setProgress]        = useState<SyncProgress>({ current: 0, total: 0 });
  const [results,         setResults]         = useState<SyncResults | null>(null);

  // ── 1. Fetch from API + categorise ──────────────────────────────────────────

  const fetchAndPreview = useCallback(async () => {
    setStatus("fetching");
    setErrorMsg("");

    let edgeFnAvailable = false;

    try {
      let records: ApiRecord[] | null = null;

      // ── Tier 0: Vercel /api/eoffice (Node.js — can actually bypass the
      // expired cert). Tried first; any failure here (network, 401, 500,
      // 502 from upstream) falls through to Tier 1 rather than surfacing
      // immediately, so a Vercel-side misconfiguration doesn't block sync
      // if the edge function happens to work (e.g. once the cert is
      // eventually renewed and Deno's verified-TLS tier starts succeeding).
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData?.session?.access_token;
        if (accessToken) {
          const res = await fetch("/api/eoffice", {
            method: "GET",
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          const body = await res.json().catch(() => null);
          if (res.ok && body?.records && Array.isArray(body.records)) {
            records = body.records as ApiRecord[];
            console.log("[Sync] Records via Vercel proxy (Tier 0):", records.length);
          } else {
            console.warn("[Sync] Tier 0 (Vercel) failed, falling back to edge function:", body?.error || res.status);
          }
        }
      } catch (tier0Err) {
        console.warn("[Sync] Tier 0 (Vercel) threw, falling back to edge function:", tier0Err);
      }

      // ── Tier 1: Supabase Edge Function proxy. Calls eofficeportal
      // server-side (no CORS/TLS issues in the browser) and holds the
      // access token as a server-side secret; a direct-from-browser
      // fallback used to exist here but shipped the token in the JS
      // bundle and has been removed for good.
      if (!records) {
        const { data: fnData, error: fnError } = await supabase.functions.invoke(
          "customer-sync",
          { method: "GET" },
        );
        if (fnError) {
          edgeFnAvailable = !!(fnError as any).context?.status;
          throw new Error(fnError.message || "Edge Function error — is 'customer-sync' deployed?");
        }
        if (fnData?.error) {
          edgeFnAvailable = true;
          throw new Error(fnData.error);
        }
        if (fnData?.records && Array.isArray(fnData.records)) {
          records         = fnData.records as ApiRecord[];
          edgeFnAvailable = true;
          console.log("[Sync] Records via Edge Function (Tier 1):", records.length);
        }
      }

      if (!records) throw new Error("Could not retrieve customer list from API.");

      console.log("[Sync] Total records from API:", records.length);
      setApiRecords(records);

      // ── Split active vs inactive (ALL records are now imported, is_active stored) ─
      const activeRecords   = records.filter(r => isActiveRecord(r));
      const inactiveRecords = records.filter(r => !isActiveRecord(r));
      console.log(`[Sync] Active: ${activeRecords.length}, Inactive: ${inactiveRecords.length}`);
      setInactiveCount(inactiveRecords.length);

      // ── Deduplicate against DB (check BOTH published + drafts) ──────────────
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

      const toInsert:  ApiRecord[] = [];
      const toUpdate:  ApiRecord[] = [];
      let   invalid = 0;

      // Import ALL records (active + inactive) — is_active stored per-record
      for (const r of records) {
        const custId = r.CustomerId != null ? String(r.CustomerId) : "";
        if (!custId) { invalid++; continue; }
        if (existingIds.has(custId)) { toUpdate.push(r); }
        else                         { toInsert.push(r); }
      }

      console.log("[Sync] New to insert:", toInsert.length, "| To update:", toUpdate.length);

      setNewRecords(toInsert);
      setUpdatedRecords(toUpdate);
      setInvalidCount(invalid);
      setStatus("previewing");

    } catch (err: unknown) {
      const msg = classifyFetchError(err, edgeFnAvailable);
      console.error("[Sync] fetchAndPreview error:", err);
      setErrorMsg(msg);
      setStatus("error");
    }
  }, []);

  // ── 2. Execute sync (insert new + update existing, batched, cancellable) ─────

  const executeImport = useCallback(async (firmId: string | null) => {
    const allRecords = [...newRecords, ...updatedRecords];
    if (allRecords.length === 0) return;

    cancelRef.current = false;
    setStatus("importing");
    setProgress({ current: 0, total: allRecords.length });

    const userId = user?.id ?? null;

    // ── Step A: Ensure all groups from API exist in the DB ───────────────────
    // Collect unique non-empty group names from ALL records being processed
    const apiGroupNames = [
      ...new Set(
        allRecords
          .map(r => (r.groupname || "").trim())
          .filter(Boolean)
      ),
    ];

    // Load existing groups (no firm_id filter — matches wizard behaviour)
    const { data: existingGroups } = await supabase
      .from("client_groups")
      .select("id, name")
      .order("name");

    // Build name→id map (case-insensitive key)
    const groupMap = new Map<string, string>(
      (existingGroups || []).map((g: any) => [
        (g.name as string).toLowerCase().trim(),
        g.id as string,
      ])
    );

    // Create any groups that are missing
    const missingGroupNames = apiGroupNames.filter(
      n => !groupMap.has(n.toLowerCase())
    );

    if (missingGroupNames.length > 0) {
      console.log("[Sync] Auto-creating groups:", missingGroupNames);

      // Assign colours from the palette (cycle if > palette length)
      const colorOffset = (existingGroups || []).length;
      const newGroupRows = missingGroupNames.map((name, i) => ({
        name,
        color:      AUTO_GROUP_COLORS[(colorOffset + i) % AUTO_GROUP_COLORS.length],
        created_by: userId,
        // No firm_id — global group (same as wizard default)
      }));

      const { data: createdGroups, error: groupErr } = await supabase
        .from("client_groups")
        .insert(newGroupRows as any)
        .select("id, name") as any;

      if (groupErr) {
        console.warn("[Sync] Failed to create some groups:", groupErr.message);
      }

      // Add newly created groups to the map
      if (createdGroups) {
        for (const g of createdGroups as any[]) {
          groupMap.set((g.name as string).toLowerCase().trim(), g.id as string);
        }
      }
    }

    // ── Step B: Fetch existing DB ids for the records we need to UPDATE ───────
    // We need the internal `id` (uuid) to upsert group memberships
    let updateIdMap = new Map<string, string>(); // customer_id → internal uuid

    if (updatedRecords.length > 0) {
      const custIds = updatedRecords.map(r => String(r.CustomerId));
      const { data: existingRows } = await supabase
        .from("clients")
        .select("id, customer_id")
        .in("customer_id", custIds)
        .is("deleted_at", null) as any;

      if (existingRows) {
        for (const row of existingRows as any[]) {
          updateIdMap.set(String(row.customer_id), row.id as string);
        }
      }
    }

    // ── Step C: Process in batches ────────────────────────────────────────────
    let created = 0;
    let updated = 0;
    let failed  = 0;
    const errors: SyncError[] = [];

    const chunks: ApiRecord[][] = [];
    for (let i = 0; i < allRecords.length; i += BATCH_SIZE) {
      chunks.push(allRecords.slice(i, i + BATCH_SIZE));
    }

    const isNewSet = new Set(newRecords.map(r => String(r.CustomerId)));

    for (const chunk of chunks) {
      if (cancelRef.current) break;

      type ChunkResult =
        | { ok: true; wasNew: boolean }
        | { ok: false; syncError: SyncError };

      const chunkResults: ChunkResult[] = await Promise.all(
        chunk.map(async (r): Promise<ChunkResult> => {
          const customer_id = String(r.CustomerId);
          const name        = decodeHtmlEntities(r.ClientName).trim() || null;
          const payload     = buildClientPayload(r);

          try {
            const isNew = isNewSet.has(customer_id);

            if (isNew) {
              // ── INSERT new client as draft ──────────────────────────────────
              // 2026-06-25 (V J Desai — auto-archive on De-Active): new
              // records that come in already inactive land straight in the
              // Archived tab tagged as eoffice_inactive so the Clients
              // page's Final/Draft Active chips never surface them.
              const startsInactive = !isActiveRecord(r);
              const baseInsert = {
                customer_id,
                ...payload,
                firm_id:   firmId,
                user_id:   userId,
                is_draft:  true,
                source:    "api_import",
                is_active: !startsInactive,
                ...(startsInactive ? {
                  deleted_at:      new Date().toISOString(),
                  deleted_reason:  "eoffice_inactive",
                } : {}),
              } as any;

              let { error } = await supabase.from("clients").insert(baseInsert);

              if (error) {
                const isPanDupe =
                  error.code === "23505" &&
                  (error.message.toLowerCase().includes("pan") ||
                    ((error as any).details ?? "").toLowerCase().includes("pan"));

                if (isPanDupe) {
                  // PAN duplicate constraint — retry without PAN so the draft is
                  // still imported. The user must resolve the PAN during finalization.
                  const withoutPan = { ...baseInsert, pan: null };
                  const retry = await supabase.from("clients").insert(withoutPan);
                  if (retry.error) {
                    return { ok: false, syncError: { customer_id, name: name ?? "", error: retry.error.message } };
                  }
                  // Draft created without PAN — not an error, just flagged via null pan
                } else {
                  return { ok: false, syncError: { customer_id, name: name ?? "", error: error.message } };
                }
              }
            } else {
              // ── UPDATE existing client (all API fields, never touches customer_id / is_draft / source) ─
              // 2026-06-25 (V J Desai rule — multi-GSTIN clients are locked
              // against sync GSTIN overwrites):
              //   The eOffice/Genius API returns only ONE primary GSTIN. If the
              //   auditor has manually configured a client with MORE THAN ONE
              //   GSTIN (multi-state registrations), overwriting clients.gstin
              //   with the single API value would silently destroy the extras
              //   (SHREEJIKRUPA BUILDCON bug).
              //
              //   Rule per user:
              //     • Multi-GSTIN client (existing gstin array has >= 2 entries,
              //       OR JSONB address/state maps reveal >= 2 keys)
              //         → DO NOT touch gstin / gstin_addresses / gstin_states.
              //           Every OTHER basic detail (name, PAN, email, address,
              //           mobile, tan_number, entity_type, is_active) still
              //           updates from the API as usual.
              //     • Single-GSTIN or zero-GSTIN client
              //         → Update the gstin field as before (payload wins).
              // 2026-06-25 (V J Desai — auto-archive / auto-unarchive):
              // Fetch the archive state too. We need to reach archived rows
              // (deleted_at IS NOT NULL) that were auto-archived by a
              // previous sync, so we can unarchive them when eOffice flips
              // the record back to Active. Manual archives (deleted_reason
              // = "manual") are left alone regardless of the eOffice state
              // — a manual archive is a business decision and must never
              // be overridden by a sync.
              const { data: existing } = await supabase
                .from("clients")
                .select("gstin, gstin_addresses, gstin_states, deleted_at, deleted_reason, tan_number, pan, email, mobile, address")
                .eq("customer_id", customer_id)
                .maybeSingle();

              // If the row was manually archived, skip the entire UPDATE —
              // preserves the intentional archive and prevents accidental
              // resurrection.
              if (existing?.deleted_reason === "manual") {
                return { ok: true, wasNew: false };
              }

              const existingArr: string[] = Array.isArray(existing?.gstin)
                ? (existing!.gstin as string[]).filter(Boolean)
                : [];
              const addrKeys = existing?.gstin_addresses && typeof existing.gstin_addresses === "object" && !Array.isArray(existing.gstin_addresses)
                ? Object.keys(existing.gstin_addresses as Record<string, string>)
                : [];
              const stateKeys = existing?.gstin_states && typeof existing.gstin_states === "object" && !Array.isArray(existing.gstin_states)
                ? Object.keys(existing.gstin_states as Record<string, string>)
                : [];
              const knownGstinCount = new Set(
                [...existingArr, ...addrKeys, ...stateKeys]
                  .filter(g => !!g && !!g.trim())
                  .map(g => g.trim().toUpperCase())
              ).size;

              let updatePayload: any;
              const active = isActiveRecord(r);
              // Archive flip logic — three cases:
              //   1. Active in eOffice AND row is currently auto-archived → UNARCHIVE
              //   2. Inactive in eOffice AND row is currently un-archived → AUTO-ARCHIVE
              //   3. Otherwise → leave deleted_at / deleted_reason alone
              const archiveFlip: any = {};
              const isCurrentlyAutoArchived =
                existing?.deleted_at !== null && existing?.deleted_reason === "eoffice_inactive";
              if (active && isCurrentlyAutoArchived) {
                archiveFlip.deleted_at     = null;
                archiveFlip.deleted_reason = null;
              } else if (!active && (existing?.deleted_at === null || existing?.deleted_at === undefined)) {
                archiveFlip.deleted_at     = new Date().toISOString();
                archiveFlip.deleted_reason = "eoffice_inactive";
              }

              // 2026-08-06 (TAN going blank "on its own" bug — same class as
              // the GSTIN fix above, just never extended to these fields):
              // buildClientPayload() maps an empty eOffice field to `null`
              // unconditionally. eOffice is a billing/practice-management
              // source, not the TDS/compliance system of record — it very
              // commonly has no TAN (or PAN/email/mobile/address) on file
              // for a client CAFlow already has one for. Every time an admin
              // re-runs "Sync from API" to pull in new customers, that same
              // request silently re-processes every ALREADY-matched existing
              // client too, and an empty eOffice value would overwrite a
              // manually-entered one with null — read by the user as "the
              // TAN gets removed automatically" days after they saved it,
              // since running the sync isn't perceived as editing that
              // client at all. Fix: for exactly the fields eOffice is
              // commonly incomplete for, an EMPTY api value never overwrites
              // an EXISTING non-empty one — the sync can still fill a field
              // CAFlow has blank, or correct one where eOffice has a
              // genuinely different non-empty value; it just can never
              // silently erase what's already there.
              const preserveIfEmpty: Array<"tan_number" | "pan" | "email" | "mobile" | "address"> =
                (["tan_number", "pan", "email", "mobile", "address"] as const)
                  .filter(f => payload[f] == null && !!(existing as any)?.[f]);

              if (knownGstinCount >= 2) {
                // Multi-GSTIN client — strip every GSTIN-related field from
                // the payload so the sync leaves them untouched.
                const { gstin: _drop, ...rest } = payload;
                updatePayload = { ...rest, is_active: active, ...archiveFlip };
              } else {
                // Single / zero GSTIN — regular sync path.
                updatePayload = { ...payload, is_active: active, ...archiveFlip };
              }
              for (const f of preserveIfEmpty) delete updatePayload[f];

              // No `.is("deleted_at", null)` filter — we need to reach the
              // auto-archived rows too so they can be unarchived when the
              // eOffice record flips back to Active.
              const { error } = await supabase
                .from("clients")
                .update(updatePayload)
                .eq("customer_id", customer_id);

              if (error) {
                return { ok: false, syncError: { customer_id, name: name ?? "", error: error.message } };
              }
            }

            // ── Group membership (upsert — never removes manually-added groups) ─
            const groupKey = (r.groupname || "").toLowerCase().trim();
            const groupId  = groupKey ? groupMap.get(groupKey) : undefined;

            if (groupId) {
              // Get the internal client uuid
              let clientDbId = isNew ? null : updateIdMap.get(customer_id) ?? null;

              if (isNew || !clientDbId) {
                // For newly inserted records, fetch the generated uuid
                const { data: row } = await (supabase
                  .from("clients")
                  .select("id")
                  .eq("customer_id", customer_id)
                  .single() as any);
                clientDbId = row?.id ?? null;
              }

              if (clientDbId) {
                // upsert — ignoreDuplicates so existing memberships are kept intact
                await (supabase
                  .from("client_group_memberships")
                  .upsert(
                    { client_id: clientDbId, group_id: groupId, added_by: userId },
                    { onConflict: "client_id,group_id", ignoreDuplicates: true },
                  ) as any);
              }
            }

            return { ok: true, wasNew: isNew };
          } catch (e: any) {
            return {
              ok:        false,
              syncError: { customer_id, name: name ?? "", error: e?.message ?? "Unknown" },
            };
          }
        })
      );

      for (const r of chunkResults) {
        if (r.ok) {
          if (r.wasNew) created++;
          else          updated++;
        } else {
          errors.push(r.syncError);
          failed++;
        }
      }

      setProgress((p) => ({
        ...p,
        current: Math.min(p.current + chunk.length, allRecords.length),
      }));
    }

    const finalResults: SyncResults = {
      created,
      updated,
      inactive:     inactiveCount,
      failed,
      errors,
      wasCancelled: cancelRef.current,
    };

    console.log("[Sync] Import results:", finalResults);
    setResults(finalResults);
    setStatus("done");
  }, [newRecords, updatedRecords, inactiveCount, user?.id]);

  // ── 3. Cancel mid-import ─────────────────────────────────────────────────────

  const cancelImport = useCallback(() => {
    cancelRef.current = true;
  }, []);

  // ── 4. Reset ─────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    cancelRef.current = false;
    setStatus("idle");
    setErrorMsg("");
    setApiRecords([]);
    setNewRecords([]);
    setUpdatedRecords([]);
    setInactiveCount(0);
    setInvalidCount(0);
    setProgress({ current: 0, total: 0 });
    setResults(null);
  }, []);

  return {
    status,
    errorMsg,
    apiRecords,
    newRecords,
    updatedRecords,
    inactiveCount,
    invalidCount,
    progress,
    results,
    fetchAndPreview,
    executeImport,
    cancelImport,
    reset,
  };
}
