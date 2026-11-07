import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, Monitor, RefreshCw } from "lucide-react";

const BUCKET = "employee-screenshots";
const PAGE_SIZE = 60;

interface ShotRow {
  id: string;
  employee_id: string;
  device_id: string;
  captured_at: string;
  display_no: number;
  storage_path: string;
  app: string | null;
  title: string | null;
  idle: boolean;
  bytes: number | null;
}

const todayStr = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local

const AdminScreenshots = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();

  const [filters, setFilters] = useState({ employee_id: "", device_id: "", date: todayStr() });
  const [rows, setRows] = useState<ShotRow[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<ShotRow | null>(null);

  useEffect(() => {
    if (!authLoading && user?.role && user.role !== "superadmin") {
      toast({ title: "Access Denied", variant: "destructive" });
      navigate("/", { replace: true });
    }
  }, [authLoading, user, navigate, toast]);

  const fetchShots = useCallback(async () => {
    setLoading(true);
    try {
      const start = new Date(`${filters.date}T00:00:00`);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q = (supabase as any)
        .from("employee_screenshots")
        .select(
          "id,employee_id,device_id,captured_at,display_no,storage_path,app,title,idle,bytes",
          { count: "exact" },
        )
        .gte("captured_at", start.toISOString())
        .lt("captured_at", end.toISOString())
        .order("captured_at", { ascending: false });

      if (filters.employee_id) q = q.ilike("employee_id", `%${filters.employee_id}%`);
      if (filters.device_id) q = q.ilike("device_id", `%${filters.device_id}%`);

      const from = (page - 1) * PAGE_SIZE;
      const { data, count, error } = await q.range(from, from + PAGE_SIZE - 1);
      if (error) throw error;

      const list = (data ?? []) as ShotRow[];
      setRows(list);
      setTotal(count ?? 0);

      // Mint short-lived signed URLs for just this page of images.
      const paths = list.map((r) => r.storage_path);
      const map: Record<string, string> = {};
      if (paths.length) {
        const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
        (signed ?? []).forEach((s) => {
          if (s.signedUrl && s.path) map[s.path] = s.signedUrl;
        });
      }
      setUrls(map);
    } catch (e) {
      toast({
        title: "Could not load screenshots",
        description: (e as Error)?.message ?? "Unknown error",
        variant: "destructive",
      });
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [filters, page, toast]);

  useEffect(() => {
    if (user?.role === "superadmin") fetchShots();
  }, [user, fetchShots]);

  if (authLoading) {
    return <div className="p-6 space-y-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>;
  }
  if (!user || user.role !== "superadmin") return null;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Employee Screenshots</h1>
          <p className="text-sm text-muted-foreground">
            Captures from monitored company devices. Access is restricted to superadmin.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => fetchShots()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
            <Input
              placeholder="Employee…"
              value={filters.employee_id}
              onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, employee_id: e.target.value })); }}
            />
            <Input
              placeholder="Device…"
              value={filters.device_id}
              onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, device_id: e.target.value })); }}
            />
            <Input
              type="date"
              value={filters.date}
              onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, date: e.target.value })); }}
            />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="aspect-video w-full" />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Monitor className="h-8 w-8 mb-2 opacity-50" />
              <p>No screenshots for this day.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {rows.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setActive(r)}
                    className="group text-left rounded-md overflow-hidden border border-border hover:ring-2 hover:ring-primary transition-all"
                  >
                    <div className="aspect-video bg-muted overflow-hidden">
                      {urls[r.storage_path] ? (
                        <img
                          src={urls[r.storage_path]}
                          alt={`${fmtTime(r.captured_at)} ${r.app ?? ""}`}
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">no preview</div>
                      )}
                    </div>
                    <div className="p-2 space-y-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-medium">{fmtTime(r.captured_at)}</span>
                        {r.idle && <Badge variant="outline" className="text-[9px]">idle</Badge>}
                        {r.display_no > 1 && <Badge variant="outline" className="text-[9px]">mon {r.display_no}</Badge>}
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">{r.app || "—"}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{r.title || ""}</p>
                    </div>
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between pt-4 mt-4 border-t">
                <p className="text-sm text-muted-foreground">
                  Page {page} of {totalPages} · {total} captures
                </p>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle className="text-sm font-normal">
              {active && (
                <>
                  {new Date(active.captured_at).toLocaleString()} · {active.employee_id} · {active.device_id}
                  {active.app ? ` · ${active.app}` : ""}
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          {active && urls[active.storage_path] && (
            <img src={urls[active.storage_path]} alt="screenshot" className="w-full rounded-md border border-border" />
          )}
          {active?.title && <p className="text-xs text-muted-foreground mt-1 break-all">{active.title}</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminScreenshots;
