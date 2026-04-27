/**
 * usePlanningStaff
 *
 * Manages the list of employees shown as columns in the Planning Calendar.
 * Persisted in public.planning_staff table.
 * Falls back to localStorage if table doesn't exist yet.
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface PlanningStaffMember {
  id:      string;   // planning_staff.id
  user_id: string;
  name:    string;
}

const LS_KEY       = (firmId: string) => `planning_staff_${firmId}`;
const LS_ORDER_KEY = (firmId: string) => `planning_staff_order_${firmId}`;

/** Load saved column order (array of user_ids) from localStorage. */
function loadSavedOrder(firmId: string): string[] {
  try {
    const raw = localStorage.getItem(LS_ORDER_KEY(firmId));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

/** Apply a saved order (array of user_ids) to a staff array.
 *  Members not in the order are appended at the end alphabetically. */
function applyOrder(members: PlanningStaffMember[], order: string[]): PlanningStaffMember[] {
  if (!order.length) return members;
  const orderMap = new Map(order.map((uid, i) => [uid, i]));
  return [...members].sort((a, b) => {
    const ia = orderMap.has(a.user_id) ? orderMap.get(a.user_id)! : 9999;
    const ib = orderMap.has(b.user_id) ? orderMap.get(b.user_id)! : 9999;
    if (ia !== ib) return ia - ib;
    return a.name.localeCompare(b.name);
  });
}

export function usePlanningStaff(firmId: string, isSuperadmin?: boolean) {
  const [staff,   setStaff]   = useState<PlanningStaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [useLs,   setUseLs]   = useState(false);

  const load = useCallback(async () => {
    if (!firmId && !isSuperadmin) { setLoading(false); return; }
    setLoading(true);

    const { data, error } = await (supabase as any)
      .from("planning_staff")
      .select("id, user_id, users(name)")
      .eq("firm_id", firmId)
      .order("users(name)");

    if (error) {
      // Table doesn't exist yet — fall back to localStorage
      setUseLs(true);
      try {
        const raw = localStorage.getItem(LS_KEY(firmId));
        const members: PlanningStaffMember[] = raw ? JSON.parse(raw) : [];
        setStaff(applyOrder(members, loadSavedOrder(firmId)));
      } catch { setStaff([]); }
      setLoading(false);
      return;
    }

    setUseLs(false);
    const members = (data || []).map((r: any) => ({
      id:      r.id,
      user_id: r.user_id,
      name:    r.users?.name || "Unknown",
    }));
    setStaff(applyOrder(members, loadSavedOrder(firmId)));
    setLoading(false);
  }, [firmId]);

  useEffect(() => { load(); }, [load]);

  async function addStaff(userId: string, userName: string) {
    if (staff.some(s => s.user_id === userId)) return; // already present

    if (useLs) {
      const entry: PlanningStaffMember = { id: crypto.randomUUID(), user_id: userId, name: userName };
      const next = applyOrder([...staff, entry], loadSavedOrder(firmId));
      setStaff(next);
      localStorage.setItem(LS_KEY(firmId), JSON.stringify(next));
      return;
    }

    const { error } = await (supabase as any)
      .from("planning_staff")
      .insert({ firm_id: firmId, user_id: userId });
    if (error) { toast.error("Failed to add employee: " + error.message); return; }
    await load();
  }

  async function removeStaff(staffId: string) {
    if (useLs) {
      const next = staff.filter(s => s.id !== staffId);
      setStaff(next);
      localStorage.setItem(LS_KEY(firmId), JSON.stringify(next));
      return;
    }

    const { error } = await (supabase as any)
      .from("planning_staff")
      .delete()
      .eq("id", staffId);
    if (error) { toast.error("Failed to remove employee: " + error.message); return; }
    await load();
  }

  /** Persist a new column order (drag-and-drop result). */
  function reorderStaff(newOrder: PlanningStaffMember[]) {
    setStaff(newOrder);
    const orderIds = newOrder.map(s => s.user_id);
    localStorage.setItem(LS_ORDER_KEY(firmId), JSON.stringify(orderIds));
  }

  return { staff, loading, addStaff, removeStaff, reorderStaff };
}
