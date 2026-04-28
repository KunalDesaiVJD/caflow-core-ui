/**
 * useQueryStatusSync — Phase 3D
 *
 * Subscribes to real-time changes on `audit_client_queries` for the current
 * engagement.  When the client portal updates a query's status, this hook
 * automatically advances the matching QuerySheet row via syncStatusFromClient.
 *
 * Mappings:
 *   "Reply Received"       → response_received  (only if currently dispatched)
 *   "Clarified" | "Closed" → resolved            (only if not already terminal)
 *
 * A toast notification is shown each time an auto-sync occurs so the auditor
 * is aware without needing to manually refresh the Query Sheet.
 */
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { QueryRow } from "./useQuerySheetStorage";
import { STATUS_META } from "./useQuerySheetStorage";

// Mapping: client portal status → worksheet status label for the toast
const CLIENT_TO_WS_LABEL: Record<string, string> = {
  "Reply Received": STATUS_META.response_received.label,
  "Clarified":      STATUS_META.resolved.label,
  "Closed":         STATUS_META.resolved.label,
};

interface Props {
  engagementId:        string;
  queries:             QueryRow[];
  syncStatusFromClient:(clientQueryId: string, clientStatus: string) => void;
}

export function useQueryStatusSync({
  engagementId,
  queries,
  syncStatusFromClient,
}: Props): void {
  // Keep a stable ref to queries so the realtime callback always sees latest
  const queriesRef = useRef<QueryRow[]>(queries);
  useEffect(() => { queriesRef.current = queries; }, [queries]);

  // Keep a stable ref to the callback (changes identity each render)
  const syncRef = useRef(syncStatusFromClient);
  useEffect(() => { syncRef.current = syncStatusFromClient; }, [syncStatusFromClient]);

  useEffect(() => {
    if (!engagementId) return;

    const channel = supabase
      .channel(`qs-sync-${engagementId}`)
      .on(
        "postgres_changes",
        {
          event:  "UPDATE",
          schema: "public",
          table:  "audit_client_queries",
          filter: `engagement_id=eq.${engagementId}`,
        },
        (payload) => {
          const { id: clientQueryId, status: newClientStatus } = payload.new as {
            id: string;
            status: string;
          };

          // Check if any QuerySheet row is linked to this client query
          const linked = queriesRef.current.find(
            q => q.dispatched_query_id === clientQueryId,
          );
          if (!linked) return;

          // Only auto-advance for meaningful status changes
          if (!CLIENT_TO_WS_LABEL[newClientStatus]) return;

          // Delegate to storage hook (handles guard logic)
          syncRef.current(clientQueryId, newClientStatus);

          const wsLabel = CLIENT_TO_WS_LABEL[newClientStatus];
          const rowLabel = linked.particulars || linked.head || "Query";
          toast.info(
            `Auto-synced: "${rowLabel}" → ${wsLabel}`,
            { description: `Client portal status changed to "${newClientStatus}"` },
          );
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [engagementId]); // stable — refs handle the rest
}
