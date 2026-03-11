import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Calculator, Lock, Plus, Trash2, Download, Upload, FileText, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

const FY_OPTIONS = ["2025-26", "2024-25", "2023-24", "2022-23"];

const fmt = (v: number | null | undefined) => {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
};

export default function Depreciation() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState("");
  const [fy, setFy] = useState(FY_OPTIONS[0]);
  const [showAddAsset, setShowAddAsset] = useState(false);
  const [showDisposal, setShowDisposal] = useState<string | null>(null);
  const [showCalcConfirm, setShowCalcConfirm] = useState(false);
  const [calculating, setCalculating] = useState(false);

  // New asset form state
  const [newAsset, setNewAsset] = useState({
    asset_name: "", category_id: "", location: "", date_of_purchase: "",
    gross_block_opening: "0", accumulated_dep_opening: "0",
    additions_during_year: "0", addition_date: "",
  });

  // Disposal form state
  const [disposalForm, setDisposalForm] = useState({ disposal_date: "", disposal_proceeds: "0", narration: "" });

  // Clients
  const { data: clients } = useQuery({
    queryKey: ["clients-for-dep", user?.firm_id],
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("id, name").eq("firm_id", user!.firm_id!).order("name");
      return data || [];
    },
    enabled: !!user?.firm_id,
  });

  // Categories
  const { data: categories } = useQuery({
    queryKey: ["fa-categories"],
    queryFn: async () => {
      const { data } = await supabase.from("fa_categories").select("*").order("name");
      return data || [];
    },
  });

  // Assets
  const { data: assets, isLoading: loadingAssets } = useQuery({
    queryKey: ["fa-assets", clientId, fy],
    queryFn: async () => {
      const { data } = await supabase
        .from("fa_assets")
        .select("*, fa_categories(name, useful_life_years, residual_value_pct)")
        .eq("client_id", clientId)
        .eq("fy", fy)
        .order("asset_code");
      return data || [];
    },
    enabled: !!clientId,
  });

  // Depreciation schedule
  const { data: schedule } = useQuery({
    queryKey: ["fa-schedule", clientId, fy],
    queryFn: async () => {
      const { data } = await supabase
        .from("fa_depreciation_schedule")
        .select("*, fa_assets(asset_name, asset_code, fa_categories(name))")
        .eq("fy", fy)
        .in("asset_id", (assets || []).map(a => a.id));
      return data || [];
    },
    enabled: !!clientId && !!assets && assets.length > 0,
  });

  // Disposals
  const { data: disposals } = useQuery({
    queryKey: ["fa-disposals", clientId, fy],
    queryFn: async () => {
      const assetIds = (assets || []).map(a => a.id);
      if (assetIds.length === 0) return [];
      const { data } = await supabase
        .from("fa_asset_disposals")
        .select("*, fa_assets(asset_name, asset_code)")
        .in("asset_id", assetIds)
        .order("disposal_date", { ascending: false });
      return data || [];
    },
    enabled: !!assets && assets.length > 0,
  });

  // Summary view
  const { data: summary } = useQuery({
    queryKey: ["fa-summary", clientId, fy],
    queryFn: async () => {
      const { data } = await supabase
        .from("fa_summary_by_fy")
        .select("*")
        .eq("client_id", clientId)
        .eq("fy", fy);
      return data || [];
    },
    enabled: !!clientId,
  });

  const isLocked = useMemo(() => assets?.some(a => a.is_locked) ?? false, [assets]);

  // Add asset
  const addAssetMutation = useMutation({
    mutationFn: async () => {
      const count = (assets?.length || 0) + 1;
      const code = `FA-${fy.replace("-", "")}-${String(count).padStart(4, "0")}`;
      const { error } = await supabase.from("fa_assets").insert({
        client_id: clientId,
        fy,
        asset_name: newAsset.asset_name,
        asset_code: code,
        category_id: newAsset.category_id,
        location: newAsset.location,
        date_of_purchase: newAsset.date_of_purchase,
        gross_block_opening: parseFloat(newAsset.gross_block_opening) || 0,
        accumulated_dep_opening: parseFloat(newAsset.accumulated_dep_opening) || 0,
        additions_during_year: parseFloat(newAsset.additions_during_year) || 0,
        addition_date: newAsset.addition_date || null,
        created_by: user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Asset added");
      queryClient.invalidateQueries({ queryKey: ["fa-assets", clientId, fy] });
      setShowAddAsset(false);
      setNewAsset({ asset_name: "", category_id: "", location: "", date_of_purchase: "", gross_block_opening: "0", accumulated_dep_opening: "0", additions_during_year: "0", addition_date: "" });
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Calculate depreciation
  const handleCalculate = async () => {
    setCalculating(true);
    setShowCalcConfirm(false);
    try {
      const { data, error } = await supabase.functions.invoke("calculate-depreciation", {
        body: { client_id: clientId, fy },
      });
      if (error) throw error;
      toast.success(`Depreciation calculated for ${data.count} assets`);
      queryClient.invalidateQueries({ queryKey: ["fa-assets", clientId, fy] });
      queryClient.invalidateQueries({ queryKey: ["fa-schedule", clientId, fy] });
      queryClient.invalidateQueries({ queryKey: ["fa-summary", clientId, fy] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCalculating(false);
    }
  };

  // Add disposal
  const addDisposalMutation = useMutation({
    mutationFn: async () => {
      const asset = assets?.find(a => a.id === showDisposal);
      if (!asset) throw new Error("Asset not found");
      const grossBlock = parseFloat(asset.gross_block_opening as any);
      const accDep = parseFloat(asset.accumulated_dep_opening as any);
      const nbv = grossBlock - accDep;
      const proceeds = parseFloat(disposalForm.disposal_proceeds) || 0;
      const pl = proceeds - nbv;

      const { error: e1 } = await supabase.from("fa_asset_disposals").insert({
        asset_id: asset.id,
        disposal_date: disposalForm.disposal_date,
        disposal_proceeds: proceeds,
        gross_block_reversed: grossBlock,
        accumulated_dep_reversed: accDep,
        net_book_value_at_disposal: nbv,
        profit_loss_on_disposal: pl,
        entry_narration: disposalForm.narration,
        created_by: user?.id,
      });
      if (e1) throw e1;

      const { error: e2 } = await supabase.from("fa_assets").update({
        disposals_during_year: grossBlock,
        disposal_date: disposalForm.disposal_date,
        disposal_proceeds: proceeds,
      }).eq("id", asset.id);
      if (e2) throw e2;
    },
    onSuccess: () => {
      toast.success("Disposal recorded");
      queryClient.invalidateQueries({ queryKey: ["fa-assets", clientId, fy] });
      queryClient.invalidateQueries({ queryKey: ["fa-disposals", clientId, fy] });
      setShowDisposal(null);
      setDisposalForm({ disposal_date: "", disposal_proceeds: "0", narration: "" });
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Delete asset
  const deleteAsset = async (id: string) => {
    const { error } = await supabase.from("fa_assets").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Asset deleted");
    queryClient.invalidateQueries({ queryKey: ["fa-assets", clientId, fy] });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Depreciation Module</h1>
          <p className="text-sm text-muted-foreground">Companies Act WDV Depreciation — Schedule II</p>
        </div>
      </div>

      {/* Client + FY Selector */}
      <Card>
        <CardContent className="pt-4 flex flex-wrap items-end gap-4">
          <div className="w-64">
            <Label>Client</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
              <SelectContent>
                {(clients || []).map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-40">
            <Label>Financial Year</Label>
            <Select value={fy} onValueChange={setFy}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {FY_OPTIONS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {clientId && !isLocked && (
            <Button onClick={() => setShowCalcConfirm(true)} disabled={calculating} className="gap-2">
              <Calculator size={16} />
              {calculating ? "Calculating..." : "Calculate Depreciation"}
            </Button>
          )}
          {isLocked && (
            <Badge variant="outline" className="gap-1 text-warning border-warning/30 bg-warning/10">
              <Lock size={14} /> Locked — Audit Completed
            </Badge>
          )}
        </CardContent>
      </Card>

      {!clientId ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Select a client and FY to begin</CardContent></Card>
      ) : (
        <Tabs defaultValue="register">
          <TabsList>
            <TabsTrigger value="register">Asset Register</TabsTrigger>
            <TabsTrigger value="schedule">Depreciation Schedule</TabsTrigger>
            <TabsTrigger value="disposals">Disposal Log</TabsTrigger>
            <TabsTrigger value="summary">Summary</TabsTrigger>
          </TabsList>

          {/* ASSET REGISTER */}
          <TabsContent value="register">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-lg">Asset Register — {fy}</CardTitle>
                <div className="flex gap-2">
                  {!isLocked && (
                    <Button size="sm" onClick={() => setShowAddAsset(true)} className="gap-1">
                      <Plus size={14} /> Add Asset
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-24">Code</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead className="w-28">Purchase Date</TableHead>
                        <TableHead className="text-right">Gross Block</TableHead>
                        <TableHead className="text-right">Additions</TableHead>
                        <TableHead className="text-right">Disposals</TableHead>
                        <TableHead className="text-right">WDV Opening</TableHead>
                        <TableHead className="text-right">Depreciation</TableHead>
                        <TableHead className="text-right">WDV Closing</TableHead>
                        <TableHead className="w-20"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loadingAssets ? (
                        <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
                      ) : !assets?.length ? (
                        <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">No assets found. Add your first asset.</TableCell></TableRow>
                      ) : assets.map((a) => {
                        const gb = parseFloat(a.gross_block_opening as any) + parseFloat(a.additions_during_year as any) - parseFloat(a.disposals_during_year as any);
                        const wdvO = parseFloat(a.gross_block_opening as any) + parseFloat(a.additions_during_year as any) - parseFloat(a.disposals_during_year as any) - parseFloat(a.accumulated_dep_opening as any);
                        const dep = a.depreciation_for_year != null ? parseFloat(a.depreciation_for_year as any) : null;
                        const wdvC = dep != null ? wdvO - dep : null;
                        const catName = (a as any).fa_categories?.name || "—";
                        return (
                          <TableRow key={a.id} className={cn(a.is_carried_forward && "bg-muted/30")}>
                            <TableCell className="font-mono text-xs">
                              {a.is_carried_forward && <Lock size={12} className="inline mr-1 text-muted-foreground" />}
                              {a.asset_code}
                            </TableCell>
                            <TableCell className="font-medium">{a.asset_name}</TableCell>
                            <TableCell>{catName}</TableCell>
                            <TableCell>{a.date_of_purchase}</TableCell>
                            <TableCell className="text-right tabular-nums">{fmt(gb)}</TableCell>
                            <TableCell className="text-right tabular-nums">{fmt(parseFloat(a.additions_during_year as any))}</TableCell>
                            <TableCell className="text-right tabular-nums">{fmt(parseFloat(a.disposals_during_year as any))}</TableCell>
                            <TableCell className="text-right tabular-nums font-medium">{fmt(wdvO)}</TableCell>
                            <TableCell className="text-right tabular-nums">{dep != null ? fmt(dep) : <span className="text-muted-foreground italic">pending</span>}</TableCell>
                            <TableCell className="text-right tabular-nums font-medium">{wdvC != null ? fmt(wdvC) : "—"}</TableCell>
                            <TableCell>
                              {!a.is_locked && !a.is_carried_forward && (
                                <div className="flex gap-1">
                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowDisposal(a.id)} title="Record Disposal">
                                    <ArrowRight size={14} />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteAsset(a.id)} title="Delete">
                                    <Trash2 size={14} />
                                  </Button>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* DEPRECIATION SCHEDULE */}
          <TabsContent value="schedule">
            <Card>
              <CardHeader><CardTitle className="text-lg">Depreciation Schedule — {fy}</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Asset Code</TableHead>
                      <TableHead>Asset Name</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Rate %</TableHead>
                      <TableHead className="text-right">WDV Opening</TableHead>
                      <TableHead className="text-right">Depreciation</TableHead>
                      <TableHead className="text-right">WDV Closing</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!schedule?.length ? (
                      <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Run "Calculate Depreciation" to generate schedule</TableCell></TableRow>
                    ) : schedule.map((s) => {
                      const asset = (s as any).fa_assets;
                      return (
                        <TableRow key={s.id}>
                          <TableCell className="font-mono text-xs">{asset?.asset_code}</TableCell>
                          <TableCell>{asset?.asset_name}</TableCell>
                          <TableCell>{asset?.fa_categories?.name}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmt(parseFloat(s.depreciation_rate as any))}%</TableCell>
                          <TableCell className="text-right tabular-nums">{fmt(parseFloat(s.wdv_opening as any))}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{fmt(parseFloat(s.depreciation_amount as any))}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmt(parseFloat(s.wdv_closing as any))}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* DISPOSAL LOG */}
          <TabsContent value="disposals">
            <Card>
              <CardHeader><CardTitle className="text-lg">Disposal Log — {fy}</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Asset</TableHead>
                      <TableHead>Disposal Date</TableHead>
                      <TableHead className="text-right">Gross Reversed</TableHead>
                      <TableHead className="text-right">Acc Dep Reversed</TableHead>
                      <TableHead className="text-right">NBV</TableHead>
                      <TableHead className="text-right">Proceeds</TableHead>
                      <TableHead className="text-right">P&L</TableHead>
                      <TableHead>Narration</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!disposals?.length ? (
                      <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No disposals recorded</TableCell></TableRow>
                    ) : disposals.map((d) => {
                      const pl = parseFloat(d.profit_loss_on_disposal as any);
                      return (
                        <TableRow key={d.id}>
                          <TableCell className="font-medium">{(d as any).fa_assets?.asset_name} ({(d as any).fa_assets?.asset_code})</TableCell>
                          <TableCell>{d.disposal_date}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmt(parseFloat(d.gross_block_reversed as any))}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmt(parseFloat(d.accumulated_dep_reversed as any))}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmt(parseFloat(d.net_book_value_at_disposal as any))}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmt(parseFloat(d.disposal_proceeds as any))}</TableCell>
                          <TableCell className={cn("text-right tabular-nums font-medium", pl >= 0 ? "text-green-600" : "text-destructive")}>
                            {pl >= 0 ? "+" : ""}{fmt(pl)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{d.entry_narration}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* SUMMARY */}
          <TabsContent value="summary">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg">Category-wise Summary — {fy}</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead>Useful Life</TableHead>
                      <TableHead className="text-right">Gross Opening</TableHead>
                      <TableHead className="text-right">Additions</TableHead>
                      <TableHead className="text-right">Disposals</TableHead>
                      <TableHead className="text-right">Gross Closing</TableHead>
                      <TableHead className="text-right">Acc Dep Opening</TableHead>
                      <TableHead className="text-right">Depreciation</TableHead>
                      <TableHead className="text-right">Acc Dep Closing</TableHead>
                      <TableHead className="text-right">Net Block</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!summary?.length ? (
                      <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No data available</TableCell></TableRow>
                    ) : summary.map((s, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{s.category_name}</TableCell>
                        <TableCell>{s.useful_life_years} yr</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(parseFloat(s.gross_block_opening as any))}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(parseFloat(s.additions as any))}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(parseFloat(s.disposals as any))}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(parseFloat(s.gross_block_closing as any))}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(parseFloat(s.acc_dep_opening as any))}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{fmt(parseFloat(s.depreciation as any))}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(parseFloat(s.acc_dep_closing as any))}</TableCell>
                        <TableCell className="text-right tabular-nums font-bold">{fmt(parseFloat(s.net_block as any))}</TableCell>
                      </TableRow>
                    ))}
                    {summary && summary.length > 0 && (
                      <TableRow className="bg-muted/50 font-bold">
                        <TableCell colSpan={2}>Total</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(summary.reduce((s, r) => s + parseFloat(r.gross_block_opening as any), 0))}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(summary.reduce((s, r) => s + parseFloat(r.additions as any), 0))}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(summary.reduce((s, r) => s + parseFloat(r.disposals as any), 0))}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(summary.reduce((s, r) => s + parseFloat(r.gross_block_closing as any), 0))}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(summary.reduce((s, r) => s + parseFloat(r.acc_dep_opening as any), 0))}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(summary.reduce((s, r) => s + parseFloat(r.depreciation as any), 0))}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(summary.reduce((s, r) => s + parseFloat(r.acc_dep_closing as any), 0))}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(summary.reduce((s, r) => s + parseFloat(r.net_block as any), 0))}</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* Add Asset Dialog */}
      <Dialog open={showAddAsset} onOpenChange={setShowAddAsset}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add New Asset</DialogTitle>
            <DialogDescription>Enter the fixed asset details for {fy}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div>
              <Label>Asset Name *</Label>
              <Input value={newAsset.asset_name} onChange={e => setNewAsset(p => ({ ...p, asset_name: e.target.value }))} />
            </div>
            <div>
              <Label>Category *</Label>
              <Select value={newAsset.category_id} onValueChange={v => setNewAsset(p => ({ ...p, category_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {(categories || []).map(c => <SelectItem key={c.id} value={c.id}>{c.name} ({c.useful_life_years} yr)</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Date of Purchase *</Label>
                <Input type="date" value={newAsset.date_of_purchase} onChange={e => setNewAsset(p => ({ ...p, date_of_purchase: e.target.value }))} />
              </div>
              <div>
                <Label>Location</Label>
                <Input value={newAsset.location} onChange={e => setNewAsset(p => ({ ...p, location: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Gross Block Opening (₹)</Label>
                <Input type="number" value={newAsset.gross_block_opening} onChange={e => setNewAsset(p => ({ ...p, gross_block_opening: e.target.value }))} />
              </div>
              <div>
                <Label>Accumulated Dep Opening (₹)</Label>
                <Input type="number" value={newAsset.accumulated_dep_opening} onChange={e => setNewAsset(p => ({ ...p, accumulated_dep_opening: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Additions During Year (₹)</Label>
                <Input type="number" value={newAsset.additions_during_year} onChange={e => setNewAsset(p => ({ ...p, additions_during_year: e.target.value }))} />
              </div>
              <div>
                <Label>Addition Date</Label>
                <Input type="date" value={newAsset.addition_date} onChange={e => setNewAsset(p => ({ ...p, addition_date: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddAsset(false)}>Cancel</Button>
            <Button onClick={() => addAssetMutation.mutate()} disabled={!newAsset.asset_name || !newAsset.category_id || !newAsset.date_of_purchase}>
              Add Asset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Calculate Confirmation Dialog */}
      <Dialog open={showCalcConfirm} onOpenChange={setShowCalcConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Calculate Depreciation</DialogTitle>
            <DialogDescription>
              This will compute WDV depreciation for all unlocked assets for {fy}. Existing calculations will be overwritten. Continue?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCalcConfirm(false)}>Cancel</Button>
            <Button onClick={handleCalculate}>Yes, Calculate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disposal Dialog */}
      <Dialog open={!!showDisposal} onOpenChange={() => setShowDisposal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Asset Disposal</DialogTitle>
            <DialogDescription>Enter disposal details for this asset</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div>
              <Label>Disposal Date *</Label>
              <Input type="date" value={disposalForm.disposal_date} onChange={e => setDisposalForm(p => ({ ...p, disposal_date: e.target.value }))} />
            </div>
            <div>
              <Label>Disposal Proceeds (₹)</Label>
              <Input type="number" value={disposalForm.disposal_proceeds} onChange={e => setDisposalForm(p => ({ ...p, disposal_proceeds: e.target.value }))} />
            </div>
            <div>
              <Label>Narration</Label>
              <Input value={disposalForm.narration} onChange={e => setDisposalForm(p => ({ ...p, narration: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDisposal(null)}>Cancel</Button>
            <Button onClick={() => addDisposalMutation.mutate()} disabled={!disposalForm.disposal_date}>Record Disposal</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
