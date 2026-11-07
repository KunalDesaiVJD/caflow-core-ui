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
import { ChevronLeft, ChevronRight, Monitor, RefreshCw, Trash2 } from "lucide-react";

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
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const active = activeIndex != null ? rows[activeIndex] ?? null : null;

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

  // Permanently delete one screenshot: the image file first, then its row.
  const deleteShot = useCallback(async (index: number) => {
    const row = rows[index];
    if (!row) return;
    if (!window.confirm("Delete this screenshot permanently? This removes the image and its record.")) return;
    setDeleting(true);
    try {
      const { error: storageErr } = await supabase.storage.from(BUCKET).remove([row.storage_path]);
      if (storageErr) throw storageErr;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: rowErr } = await (supabase as any)
        .from("employee_screenshots").delete().eq("id", row.id);
      if (rowErr) throw rowErr;

      setRows((prev) => prev.filter((_, i) => i !== index));
      setTotal((t) => Math.max(0, t - 1));
      setActiveIndex((cur) => {
        if (cur == null) return cur;
        const nextLen = rows.length - 1;
        if (nextLen <= 0) return null;          // nothing left — close viewer
        if (index < cur) return cur - 1;        // list shifted up
        if (cur >= nextLen) return nextLen - 1; // deleted the last one
        return cur;                             // stay on same slot (now the next shot)
      });
      toast({ title: "Screenshot deleted" });
    } catch (e) {
      toast({
        title: "Could not delete",
        description: (e as Error)?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  }, [rows, toast]);

  // Keyboard navigation while the viewer is open.
  useEffect(() => {
    if (activeIndex == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setActiveIndex((i) => (i != null && i > 0 ? i - 1 : i));
      else if (e.key === "ArrowRight") setActiveIndex((i) => (i != null && i < rows.length - 1 ? i + 1 : i));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIndex, rows.length]);

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
                {rows.map((r, i) => (
                  <div
                    key={r.id}
                    className="group relative rounded-md overflow-hidden border border-border hover:ring-2 hover:ring-primary transition-all"
                  >
                    <button onClick={() => setActiveIndex(i)} className="block w-full text-left">
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
                    <button
                      aria-label="Delete screenshot"
                      title="Delete permanently"
                      onClick={(e) => { e.stopPropagation(); deleteShot(i); }}
                      className="absolute top-1 right-1 p-1 rounded bg-background/80 text-destructive opacity-0 group-hover:opacity-100 hover:bg-destructive hover:text-destructive-foreground transition"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
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

      <Dialog open={active != null} onOpenChange={(o) => !o && setActiveIndex(null)}>
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
            <div className="relative">
              <img src={urls[active.storage_path]} alt="screenshot" className="w-full rounded-md border border-border" />
              {/* Left / right arrows for one-by-one viewing */}
              <button
                aria-label="Newer (←)"
                onClick={() => setActiveIndex((i) => (i != null && i > 0 ? i - 1 : i))}
                disabled={activeIndex === 0}
                className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-background/80 hover:bg-background shadow disabled:opacity-30"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                aria-label="Older (→)"
                onClick={() => setActiveIndex((i) => (i != null && i < rows.length - 1 ? i + 1 : i))}
                disabled={activeIndex != null && activeIndex >= rows.length - 1}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-background/80 hover:bg-background shadow disabled:opacity-30"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground min-w-0">
              {activeIndex != null && <span className="mr-2">{activeIndex + 1} / {rows.length} on this page</span>}
              {active?.title && <span className="break-all">{active.title}</span>}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                size="sm" variant="outline"
                disabled={activeIndex === 0}
                onClick={() => setActiveIndex((i) => (i != null && i > 0 ? i - 1 : i))}
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Newer
              </Button>
              <Button
                size="sm" variant="outline"
                disabled={activeIndex != null && activeIndex >= rows.length - 1}
                onClick={() => setActiveIndex((i) => (i != null && i < rows.length - 1 ? i + 1 : i))}
              >
                Older <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
              <Button
                size="sm" variant="destructive"
                disabled={deleting || activeIndex == null}
                onClick={() => activeIndex != null && deleteShot(activeIndex)}
              >
                <Trash2 className="h-4 w-4 mr-1" /> Delete
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminScreenshots;
