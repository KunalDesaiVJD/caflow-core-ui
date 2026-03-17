import { useState, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Calculator, Lock, Plus, Trash2, ArrowRight, AlertTriangle,
CheckCircle2, Settings, Info, Loader2 } from 'lucide-react';

const FY_OPTIONS = ['2025-26','2024-25','2023-24','2022-23','2021-22','2020-21'];

const fmt = (v: number | null | undefined) =>
v == null || isNaN(v as number) ? '—'
: new Intl.NumberFormat('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2}).format(v);
const fmtPct = (v: number | null | undefined) => v == null ? '—' : `${Number(v).toFixed(2)}%`;

function validateAsset(a: any, fy: string): string[] {
const errs: string[] = [];
const gb  = parseFloat(a.gross_block_opening)     || 0;
const ad  = parseFloat(a.accumulated_dep_opening)  || 0;
const add = parseFloat(a.additions_during_year)   || 0;
const dis = parseFloat(a.disposals_during_year)   || 0;
if (gb  < 0)      errs.push('Gross block opening cannot be negative.');
if (ad  < 0)      errs.push('Accumulated depreciation cannot be negative.');
if (ad  > gb)     errs.push('Accumulated depreciation exceeds gross block.');
if (add < 0)      errs.push('Additions cannot be negative.');
if (dis < 0)      errs.push('Disposals cannot be negative.');
if (dis > gb+add) errs.push('Disposals cannot exceed total gross block.');
if (add > 0 && !a.addition_date)  errs.push('Addition date required when additions > 0.');
if (dis > 0 && !a.disposal_date)  errs.push('Disposal date required when disposals > 0.');
if (fy && a.addition_date) {
const fyY = parseInt(fy.split('-')[0]);
const d = new Date(a.addition_date);
if (d < new Date(fyY,3,1) || d > new Date(fyY+1,2,31))
errs.push(`Addition date ${a.addition_date} is outside FY ${fy}.`);
}
return errs;
}

const MethodBadge = ({ method }: { method: string }) => (
<Badge variant='outline' className={cn('text-[9px] px-1.5 py-0 font-semibold',
method === 'SLM'
? 'border-blue-400 text-blue-700 bg-blue-50 dark:bg-blue-950/30 dark:text-blue-300'
: 'border-amber-400 text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-300'
)}>{method || 'WDV'}</Badge>
);

export default function Depreciation() {
const { user } = useAuth();
const qc = useQueryClient();
const [clientId,  setClientId]  = useState('');
const [fy,        setFy]        = useState(FY_OPTIONS[0]);
const [activeTab, setActiveTab] = useState('register');
const [showAdd,     setShowAdd]     = useState(false);
const [showDispose, setShowDispose] = useState<string | null>(null);
const [showConfirm, setShowConfirm] = useState(false);
const [showCats, setShowCats] = useState(false);
const [showAddCat, setShowAddCat] = useState(false);
const [calcResult, setCalcResult] = useState<any>(null);
const [calculating, setCalculating] = useState(false);
const [assetErrs, setAssetErrs] = useState<string[]>([]);
const [na, setNa] = useState({
asset_name:'', category_id:'', location:'', date_of_purchase:'',
gross_block_opening:'0', accumulated_dep_opening:'0',
additions_during_year:'0', addition_date:'',
disposals_during_year:'0', disposal_date:'', narration:'',
});
const [nc, setNc] = useState({
name:'', asset_class:'', useful_life_years:'', wdv_rate:'',
slm_rate:'', residual_value_pct:'5', schedule_ii_part:'A',
depreciation_method:'WDV',
});
const [df, setDf] = useState({ disposal_date:'', disposal_proceeds:'0', narration:'' });

const { data: clients } = useQuery({
queryKey: ['dep-clients', user?.firm_id, user?.role],
queryFn: async () => {
let q = supabase.from('clients').select('id,name').order('name');
if (user?.role !== 'superadmin' && user?.firm_id) q = q.eq('firm_id', user.firm_id);
const { data } = await q;
return data || [];
},
enabled: !!user,
});

const { data: cats, refetch: refetchCats } = useQuery({
queryKey: ['dep-cats', user?.firm_id],
queryFn: async () => {
const { data } = await supabase.from('fa_categories')
.select('id,name,asset_class,schedule_ii_part,useful_life_years,wdv_rate,slm_rate,residual_value_pct,depreciation_method,firm_id')
.order('asset_class').order('name');
return (data || []) as any[];
},
enabled: !!user,
});

const { data: assets, isLoading: loadingAssets } = useQuery({
queryKey: ['dep-assets', clientId, fy],
queryFn: async () => {
const { data } = await supabase.from('fa_assets')
.select('*,fa_categories(id,name,asset_class,useful_life_years,wdv_rate,slm_rate,residual_value_pct,depreciation_method)')
.eq('client_id', clientId).eq('fy', fy).order('asset_name');
return (data || []) as any[];
},
enabled: !!clientId,
});

const { data: schedule } = useQuery({
queryKey: ['dep-sched', clientId, fy],
queryFn: async () => {
const ids = (assets || []).map((a: any) => a.id);
if (!ids.length) return [];
const { data } = await supabase.from('fa_depreciation_schedule')
.select('*,fa_assets(asset_name,asset_code,dep_on_opening_block,dep_on_additions,additions_during_year,fa_categories(name,depreciation_method,wdv_rate,slm_rate))')
.in('asset_id', ids).eq('fy', fy).order('created_at');
return (data || []) as any[];
},
enabled: !!assets?.length,
});

const summary = useMemo(() => {
if (!assets?.length) return [];
const catMap = new Map<string, any>();
for (const a of assets) {
const cat = a.fa_categories;
if (!cat) continue;
const key = cat.id;
if (!catMap.has(key)) {
catMap.set(key, {
category_name: cat.name,
depreciation_method: cat.depreciation_method || 'WDV',
useful_life_years: cat.useful_life_years,
wdv_rate: cat.wdv_rate,
slm_rate: cat.slm_rate,
gross_block_opening: 0, additions: 0, disposals: 0,
gross_block_closing: 0, acc_dep_opening: 0,
depreciation: 0, acc_dep_closing: 0, net_block: 0,
});
}
const s = catMap.get(key)!;
const gb = parseFloat(a.gross_block_opening) || 0;
const add = parseFloat(a.additions_during_year) || 0;
const dis = parseFloat(a.disposals_during_year) || 0;
const ad = parseFloat(a.accumulated_dep_opening) || 0;
const dep = parseFloat(a.depreciation_for_year) || 0;
s.gross_block_opening += gb;
s.additions += add;
s.disposals += dis;
s.gross_block_closing += (gb + add - dis);
s.acc_dep_opening += ad;
s.depreciation += dep;
s.acc_dep_closing += (ad + dep);
s.net_block += (gb + add - dis - ad - dep);
}
return Array.from(catMap.values());
}, [assets]);

const { data: disposals } = useQuery({
queryKey: ['dep-disp', clientId, fy],
queryFn: async () => {
const ids = (assets||[]).map((a:any) => a.id);
if (!ids.length) return [];
const { data } = await supabase.from('fa_asset_disposals')
.select('*,fa_assets(asset_name,asset_code)')
.in('asset_id',ids).order('disposal_date',{ascending:false});
return (data||[]) as any[];
},
enabled: !!assets?.length,
});

const isLocked = useMemo(() => assets?.some((a:any) => a.is_locked) ?? false, [assets]);

const totals = useMemo(() => {
if (!assets?.length) return null;
const n = (a:any,f:string) => parseFloat(a[f]) || 0;
return {
gbOpen:   assets.reduce((s:number,a:any) => s+n(a,'gross_block_opening'), 0),
add:      assets.reduce((s:number,a:any) => s+n(a,'additions_during_year'), 0),
disp:     assets.reduce((s:number,a:any) => s+n(a,'disposals_during_year'), 0),
acDep:    assets.reduce((s:number,a:any) => s+n(a,'accumulated_dep_opening'), 0),
wdvOpen:  assets.reduce((s:number,a:any) => s+(n(a,'gross_block_opening')-n(a,'accumulated_dep_opening')), 0),
dep:      assets.reduce((s:number,a:any) => s+(parseFloat(a.depreciation_for_year)||0), 0),
wdvClose: assets.reduce((s:number,a:any) => s+(parseFloat(a.wdv_closing)||0), 0),
};
}, [assets]);

const selCat = useMemo(() => (cats||[]).find((c:any) => c.id===na.category_id), [cats, na.category_id]);

const addMut = useMutation({
mutationFn: async () => {
const errs = validateAsset(na, fy);
if (errs.length) { setAssetErrs(errs); throw new Error('validation'); }
setAssetErrs([]);
const code = `FA-${fy.replace('-','')}-${String((assets?.length||0)+1).padStart(4,'0')}`;
const { error } = await supabase.from('fa_assets').insert({
client_id:clientId, fy, asset_code:code,
asset_name:na.asset_name, category_id:na.category_id,
location:na.location||null, date_of_purchase:na.date_of_purchase,
gross_block_opening:     parseFloat(na.gross_block_opening)||0,
accumulated_dep_opening: parseFloat(na.accumulated_dep_opening)||0,
additions_during_year:   parseFloat(na.additions_during_year)||0,
addition_date:           na.addition_date||null,
disposals_during_year:   parseFloat(na.disposals_during_year)||0,
disposal_date:           na.disposal_date||null,
narration:               na.narration||null,
created_by: user?.id,
} as any);
if (error) throw error;
},
onSuccess: () => {
toast.success('Asset added');
qc.invalidateQueries({queryKey:['dep-assets',clientId,fy]});
setShowAdd(false);
setNa({asset_name:'',category_id:'',location:'',date_of_purchase:'',
       gross_block_opening:'0',accumulated_dep_opening:'0',
       additions_during_year:'0',addition_date:'',
       disposals_during_year:'0',disposal_date:'',narration:''});
},
onError: (e:any) => { if(e.message!=='validation') toast.error(e.message); },
});

const handleCalc = async () => {
setCalculating(true); setShowConfirm(false);
try {
const { data, error } = await supabase.functions.invoke('calculate-depreciation',
  { body:{ client_id:clientId, fy } });
if (error) throw error;
if (data.errors?.length) toast.error(`${data.errors.length} errors`);
else toast.success(`Depreciation calculated for ${data.count} assets`);
setCalcResult(data);
['dep-assets','dep-sched','dep-summ'].forEach(k =>
  qc.invalidateQueries({queryKey:[k,clientId,fy]}));
} catch(e:any) { toast.error(e.message||'Failed'); }
finally { setCalculating(false); }
};

const dispMut = useMutation({
mutationFn: async () => {
const asset = assets?.find((a:any) => a.id===showDispose);
if (!asset) throw new Error('Asset not found');
const gb  = parseFloat(asset.gross_block_opening)||0;
const ad  = parseFloat(asset.accumulated_dep_opening)||0;
const add = parseFloat(asset.additions_during_year)||0;
const nbv = gb - ad + add;
const proceeds = parseFloat(df.disposal_proceeds)||0;
const pl = proceeds - nbv;
const {error:e1} = await supabase.from('fa_asset_disposals').insert({
  asset_id:asset.id, disposal_date:df.disposal_date,
  disposal_proceeds:proceeds, gross_block_reversed:gb+add,
  accumulated_dep_reversed:ad, net_book_value_at_disposal:nbv,
  profit_loss_on_disposal:pl, entry_narration:df.narration,
  created_by:user?.id,
} as any);
if (e1) throw e1;
const {error:e2} = await supabase.from('fa_assets').update({
  disposals_during_year:gb+add, disposal_date:df.disposal_date,
  disposal_proceeds:proceeds,
} as any).eq('id',asset.id);
if (e2) throw e2;
},
onSuccess: () => {
toast.success('Disposal recorded');
qc.invalidateQueries({queryKey:['dep-assets',clientId,fy]});
qc.invalidateQueries({queryKey:['dep-disp',clientId,fy]});
setShowDispose(null);
setDf({disposal_date:'',disposal_proceeds:'0',narration:''});
},
onError: (e:any) => toast.error(e.message),
});

const addCatMut = useMutation({
mutationFn: async () => {
const {error} = await supabase.from('fa_categories').insert({
  firm_id:user?.firm_id||null, name:nc.name,
  asset_class:nc.asset_class,
  useful_life_years:parseInt(nc.useful_life_years)||10,
  wdv_rate:parseFloat(nc.wdv_rate)||null,
  slm_rate:parseFloat(nc.slm_rate)||null,
  residual_value_pct:parseFloat(nc.residual_value_pct)||5,
  schedule_ii_part:nc.schedule_ii_part,
  depreciation_method:nc.depreciation_method,
} as any);
if (error) throw error;
},
onSuccess: () => { toast.success('Category added'); refetchCats(); setShowAddCat(false); },
onError: (e:any) => toast.error(e.message),
});

const deleteAsset = async (id:string) => {
const {error} = await supabase.from('fa_assets').delete().eq('id',id);
if (error) { toast.error(error.message); return; }
toast.success('Asset deleted');
qc.invalidateQueries({queryKey:['dep-assets',clientId,fy]});
};

return (
<div className='space-y-6'>
<div className='flex items-center justify-between'>
  <div>
    <h1 className='text-2xl font-bold text-foreground'>Depreciation Register</h1>
    <p className='text-sm text-muted-foreground'>Companies Act 2013 — Schedule II — WDV &amp; SLM Methods</p>
  </div>
  <Button variant='outline' size='sm' onClick={() => setShowCats(true)} className='gap-2'>
    <Settings size={14} /> Asset Category Master
  </Button>
</div>

<Card>
  <CardContent className='pt-4 flex flex-wrap items-end gap-4'>
    <div className='w-72'>
      <Label>Client *</Label>
      <Select value={clientId} onValueChange={setClientId}>
        <SelectTrigger><SelectValue placeholder='Select client' /></SelectTrigger>
        <SelectContent>
          {(clients||[]).map((c:any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          {!clients?.length && <div className='px-3 py-2 text-sm text-muted-foreground'>No clients found</div>}
        </SelectContent>
      </Select>
    </div>
    <div className='w-36'>
      <Label>Financial Year</Label>
      <Select value={fy} onValueChange={setFy}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>{FY_OPTIONS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    {clientId && !isLocked && (
      <Button onClick={() => setShowConfirm(true)} disabled={calculating} className='gap-2'>
        {calculating ? <Loader2 size={16} className='animate-spin' /> : <Calculator size={16} />}
        {calculating ? 'Calculating...' : 'Calculate Depreciation'}
      </Button>
    )}
    {isLocked && <Badge variant='outline' className='gap-1 border-amber-400 text-amber-600'><Lock size={14} />Locked</Badge>}
  </CardContent>
</Card>

{!clientId ? (
  <Card><CardContent className='py-16 text-center text-muted-foreground'>
    <Calculator size={40} className='mx-auto mb-4 opacity-25' />
    <p className='font-medium text-foreground'>Select a client and financial year</p>
    <p className='text-sm mt-1'>WDV and SLM as per Companies Act 2013 Schedule II</p>
  </CardContent></Card>
) : (
<Tabs value={activeTab} onValueChange={setActiveTab}>
  <TabsList>
    <TabsTrigger value='register'>Asset Register{assets?.length ? <Badge variant='secondary' className='ml-1 text-[10px]'>{assets.length}</Badge> : null}</TabsTrigger>
    <TabsTrigger value='schedule'>Depreciation Schedule</TabsTrigger>
    <TabsTrigger value='summary'>Block-wise Summary</TabsTrigger>
    <TabsTrigger value='disposals'>Disposal Log</TabsTrigger>
  </TabsList>

  <TabsContent value='register'>
    <Card>
      <CardHeader className='flex flex-row items-center justify-between pb-2'>
        <div>
          <CardTitle className='text-base'>Asset Register — {fy}</CardTitle>
          <CardDescription className='text-xs'>WDV Opening = Gross Block Opening minus Accumulated Dep Opening</CardDescription>
        </div>
        {!isLocked && <Button size='sm' onClick={() => setShowAdd(true)} className='gap-1'><Plus size={14} />Add Asset</Button>}
      </CardHeader>
      <CardContent className='p-0'><div className='overflow-auto'>
        <Table>
          <TableHeader><TableRow className='bg-muted/50 text-xs'>
            <TableHead className='w-8'>#</TableHead>
            <TableHead className='w-24'>Code</TableHead>
            <TableHead className='min-w-[140px]'>Asset Name</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className='text-center w-14'>Method</TableHead>
            <TableHead className='w-24'>Purch Date</TableHead>
            <TableHead className='text-right'>Gross Blk Open</TableHead>
            <TableHead className='text-right'>Additions</TableHead>
            <TableHead className='text-right'>Disposals</TableHead>
            <TableHead className='text-right'>Acc Dep Open</TableHead>
            <TableHead className='text-right font-semibold'>WDV Opening</TableHead>
            <TableHead className='text-right w-16'>Rate %</TableHead>
            <TableHead className='text-right font-semibold'>Dep for Year</TableHead>
            <TableHead className='text-right font-bold'>WDV Closing</TableHead>
            <TableHead className='w-20'></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {loadingAssets ? (
              <TableRow><TableCell colSpan={15} className='text-center py-8'><Loader2 className='mx-auto animate-spin' /></TableCell></TableRow>
            ) : !assets?.length ? (
              <TableRow><TableCell colSpan={15} className='text-center py-8 text-muted-foreground'>No assets for {fy}. Click Add Asset.</TableCell></TableRow>
            ) : assets.map((a:any, i:number) => {
              const gb   = parseFloat(a.gross_block_opening)||0;
              const ad   = parseFloat(a.accumulated_dep_opening)||0;
              const add  = parseFloat(a.additions_during_year)||0;
              const dis  = parseFloat(a.disposals_during_year)||0;
              const wdvO = gb - ad;
              const dep  = a.depreciation_for_year != null ? parseFloat(a.depreciation_for_year) : null;
              const wdvC = a.wdv_closing != null ? parseFloat(a.wdv_closing) : null;
              const method = a.fa_categories?.depreciation_method || 'WDV';
              const rate   = method==='SLM' ? a.fa_categories?.slm_rate : a.fa_categories?.wdv_rate;
              const warn   = wdvO < 0 || ad > gb;
              return (
                <TableRow key={a.id} className={cn(a.is_fully_depreciated&&'bg-muted/20', warn&&'bg-red-50 dark:bg-red-950/20')}>
                  <TableCell className='text-xs text-muted-foreground'>{i+1}</TableCell>
                  <TableCell className='font-mono text-xs'>{a.asset_code}</TableCell>
                  <TableCell className='font-medium text-sm'>
                    {a.asset_name}
                    {a.is_fully_depreciated&&<Badge variant='outline' className='ml-1 text-[9px]'>Fully Dep.</Badge>}
                    {warn&&<AlertTriangle size={12} className='inline ml-1 text-red-500' />}
                  </TableCell>
                  <TableCell className='text-xs'>{a.fa_categories?.name||'—'}</TableCell>
                  <TableCell className='text-center'><MethodBadge method={method} /></TableCell>
                  <TableCell className='text-xs'>{a.date_of_purchase}</TableCell>
                  <TableCell className='text-right tabular-nums text-sm'>{fmt(gb)}</TableCell>
                  <TableCell className='text-right tabular-nums text-sm'>{add>0?fmt(add):'—'}</TableCell>
                  <TableCell className='text-right tabular-nums text-sm'>{dis>0?fmt(dis):'—'}</TableCell>
                  <TableCell className='text-right tabular-nums text-sm'>{fmt(ad)}</TableCell>
                  <TableCell className='text-right tabular-nums text-sm font-semibold'>{fmt(wdvO)}</TableCell>
                  <TableCell className='text-right tabular-nums text-xs'>{fmtPct(rate)}</TableCell>
                  <TableCell className='text-right tabular-nums text-sm font-semibold'>
                    {dep!=null?fmt(dep):<span className='text-muted-foreground text-xs italic'>pending</span>}
                  </TableCell>
                  <TableCell className={cn('text-right tabular-nums text-sm font-bold',wdvC!=null&&wdvC<0?'text-red-600':'')}>
                    {wdvC!=null?fmt(wdvC):'—'}
                  </TableCell>
                  <TableCell>
                    {!a.is_locked&&(<div className='flex gap-1'>
                      <Button variant='ghost' size='icon' className='h-7 w-7' title='Dispose' onClick={()=>setShowDispose(a.id)}><ArrowRight size={13}/></Button>
                      <Button variant='ghost' size='icon' className='h-7 w-7 text-destructive' title='Delete' onClick={()=>deleteAsset(a.id)}><Trash2 size={13}/></Button>
                    </div>)}
                  </TableCell>
                </TableRow>
              );
            })}
            {totals&&(
              <TableRow className='bg-muted/60 font-bold border-t-2 border-border text-sm'>
                <TableCell colSpan={6}>TOTAL</TableCell>
                <TableCell className='text-right tabular-nums'>{fmt(totals.gbOpen)}</TableCell>
                <TableCell className='text-right tabular-nums'>{fmt(totals.add)}</TableCell>
                <TableCell className='text-right tabular-nums'>{fmt(totals.disp)}</TableCell>
                <TableCell className='text-right tabular-nums'>{fmt(totals.acDep)}</TableCell>
                <TableCell className='text-right tabular-nums'>{fmt(totals.wdvOpen)}</TableCell>
                <TableCell/>
                <TableCell className='text-right tabular-nums'>{fmt(totals.dep)}</TableCell>
                <TableCell className='text-right tabular-nums'>{fmt(totals.wdvClose)}</TableCell>
                <TableCell/>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div></CardContent>
    </Card>
  </TabsContent>

  <TabsContent value='schedule'>
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>Depreciation Schedule — {fy}</CardTitle>
        <CardDescription className='text-xs'>Dep on Opening Block + Dep on Additions shown separately</CardDescription>
      </CardHeader>
      <CardContent className='p-0'>
        <Table>
          <TableHeader><TableRow className='bg-muted/50 text-xs'>
            <TableHead>Code</TableHead><TableHead>Asset Name</TableHead><TableHead>Category</TableHead>
            <TableHead className='text-center'>Method</TableHead>
            <TableHead className='text-right'>Rate %</TableHead>
            <TableHead className='text-right'>Dep Base</TableHead>
            <TableHead className='text-right'>Dep on Opening</TableHead>
            <TableHead className='text-right'>Additions</TableHead>
            <TableHead className='text-right'>Dep on Additions</TableHead>
            <TableHead className='text-right font-semibold'>Total Dep</TableHead>
            <TableHead className='text-right font-bold'>WDV Closing</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {!schedule?.length ? (
              <TableRow><TableCell colSpan={11} className='text-center py-8 text-muted-foreground'>Run Calculate Depreciation first</TableCell></TableRow>
            ) : schedule.map((s:any) => {
              const ast = s.fa_assets;
              const method = ast?.fa_categories?.depreciation_method||'WDV';
              const addAst = assets?.find((a:any) => a.id===s.asset_id);
              return (
                <TableRow key={s.id}>
                  <TableCell className='font-mono text-xs'>{ast?.asset_code}</TableCell>
                  <TableCell className='text-sm font-medium'>{ast?.asset_name}</TableCell>
                  <TableCell className='text-xs'>{ast?.fa_categories?.name}</TableCell>
                  <TableCell className='text-center'><MethodBadge method={method}/></TableCell>
                  <TableCell className='text-right text-xs'>{fmtPct(parseFloat(s.depreciation_rate))}</TableCell>
                  <TableCell className='text-right text-xs text-muted-foreground'>{method==='SLM'?'Gross Block':'WDV Opening'}</TableCell>
                  <TableCell className='text-right tabular-nums text-sm'>{fmt(parseFloat(ast?.dep_on_opening_block??s.depreciation_amount))}</TableCell>
                  <TableCell className='text-right tabular-nums text-sm text-muted-foreground'>{addAst&&parseFloat(addAst.additions_during_year)>0?fmt(parseFloat(addAst.additions_during_year)):'—'}</TableCell>
                  <TableCell className='text-right tabular-nums text-sm'>{fmt(parseFloat(ast?.dep_on_additions??0))}</TableCell>
                  <TableCell className='text-right tabular-nums text-sm font-semibold'>{fmt(parseFloat(s.depreciation_amount))}</TableCell>
                  <TableCell className='text-right tabular-nums text-sm font-bold'>{fmt(parseFloat(s.wdv_closing))}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </TabsContent>

  <TabsContent value='summary'>
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>Block-wise Summary — {fy}</CardTitle>
        <CardDescription className='text-xs'>Category-wise | Schedule II format | Method per category</CardDescription>
      </CardHeader>
      <CardContent className='p-0'>
        <Table>
          <TableHeader><TableRow className='bg-muted/50 text-xs'>
            <TableHead>Category</TableHead><TableHead className='text-center'>Method</TableHead>
            <TableHead className='text-right w-10'>Life</TableHead><TableHead className='text-right w-16'>Rate%</TableHead>
            <TableHead className='text-right'>Gross Blk Open</TableHead><TableHead className='text-right'>Additions</TableHead>
            <TableHead className='text-right'>Disposals</TableHead><TableHead className='text-right'>Gross Blk Close</TableHead>
            <TableHead className='text-right'>Acc Dep Open</TableHead>
            <TableHead className='text-right font-semibold'>Dep for Year</TableHead>
            <TableHead className='text-right'>Acc Dep Close</TableHead>
            <TableHead className='text-right font-bold'>Net Block</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {!summary?.length ? (
              <TableRow><TableCell colSpan={12} className='text-center py-8 text-muted-foreground'>No data</TableCell></TableRow>
            ) : summary.map((s:any,i:number) => (
              <TableRow key={i} className={i%2===0?'bg-muted/20':''}>
                <TableCell className='font-medium text-sm'>{s.category_name}</TableCell>
                <TableCell className='text-center'><MethodBadge method={s.depreciation_method}/></TableCell>
                <TableCell className='text-right text-xs'>{s.useful_life_years}yr</TableCell>
                <TableCell className='text-right text-xs'>{fmtPct(parseFloat(s.depreciation_method==='SLM'?s.slm_rate:s.wdv_rate))}</TableCell>
                <TableCell className='text-right tabular-nums text-sm'>{fmt(parseFloat(s.gross_block_opening))}</TableCell>
                <TableCell className='text-right tabular-nums text-sm'>{fmt(parseFloat(s.additions))}</TableCell>
                <TableCell className='text-right tabular-nums text-sm'>{fmt(parseFloat(s.disposals))}</TableCell>
                <TableCell className='text-right tabular-nums text-sm'>{fmt(parseFloat(s.gross_block_closing))}</TableCell>
                <TableCell className='text-right tabular-nums text-sm'>{fmt(parseFloat(s.acc_dep_opening))}</TableCell>
                <TableCell className='text-right tabular-nums text-sm font-semibold'>{fmt(parseFloat(s.depreciation))}</TableCell>
                <TableCell className='text-right tabular-nums text-sm'>{fmt(parseFloat(s.acc_dep_closing))}</TableCell>
                <TableCell className='text-right tabular-nums text-sm font-bold'>{fmt(parseFloat(s.net_block))}</TableCell>
              </TableRow>
            ))}
            {summary&&summary.length>0&&(()=>{
              const tot=(f:string)=>summary.reduce((s:number,r:any)=>s+(parseFloat(r[f])||0),0);
              return (
                <TableRow className='bg-muted font-bold border-t-2 border-border'>
                  <TableCell colSpan={4} className='text-sm'>GRAND TOTAL</TableCell>
                  <TableCell className='text-right tabular-nums'>{fmt(tot('gross_block_opening'))}</TableCell>
                  <TableCell className='text-right tabular-nums'>{fmt(tot('additions'))}</TableCell>
                  <TableCell className='text-right tabular-nums'>{fmt(tot('disposals'))}</TableCell>
                  <TableCell className='text-right tabular-nums'>{fmt(tot('gross_block_closing'))}</TableCell>
                  <TableCell className='text-right tabular-nums'>{fmt(tot('acc_dep_opening'))}</TableCell>
                  <TableCell className='text-right tabular-nums'>{fmt(tot('depreciation'))}</TableCell>
                  <TableCell className='text-right tabular-nums'>{fmt(tot('acc_dep_closing'))}</TableCell>
                  <TableCell className='text-right tabular-nums'>{fmt(tot('net_block'))}</TableCell>
                </TableRow>
              );
            })()}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </TabsContent>

  <TabsContent value='disposals'>
    <Card>
      <CardHeader><CardTitle className='text-base'>Disposal Log — {fy}</CardTitle></CardHeader>
      <CardContent className='p-0'>
        <Table>
          <TableHeader><TableRow className='text-xs'>
            <TableHead>Asset</TableHead><TableHead>Date</TableHead>
            <TableHead className='text-right'>Gross Reversed</TableHead>
            <TableHead className='text-right'>Acc Dep Reversed</TableHead>
            <TableHead className='text-right'>Net Book Value</TableHead>
            <TableHead className='text-right'>Proceeds</TableHead>
            <TableHead className='text-right'>Profit / (Loss)</TableHead>
            <TableHead>Narration</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {!disposals?.length ? (
              <TableRow><TableCell colSpan={8} className='text-center py-8 text-muted-foreground'>No disposals in {fy}</TableCell></TableRow>
            ) : disposals.map((d:any) => {
              const pl = parseFloat(d.profit_loss_on_disposal);
              return (
                <TableRow key={d.id}>
                  <TableCell className='font-medium text-sm'>{d.fa_assets?.asset_name}</TableCell>
                  <TableCell className='text-sm'>{d.disposal_date}</TableCell>
                  <TableCell className='text-right tabular-nums text-sm'>{fmt(parseFloat(d.gross_block_reversed))}</TableCell>
                  <TableCell className='text-right tabular-nums text-sm'>{fmt(parseFloat(d.accumulated_dep_reversed))}</TableCell>
                  <TableCell className='text-right tabular-nums text-sm'>{fmt(parseFloat(d.net_book_value_at_disposal))}</TableCell>
                  <TableCell className='text-right tabular-nums text-sm'>{fmt(parseFloat(d.disposal_proceeds))}</TableCell>
                  <TableCell className={cn('text-right tabular-nums text-sm font-semibold',pl>=0?'text-emerald-600':'text-red-600')}>
                    {pl>=0?'+':''}{fmt(pl)}
                  </TableCell>
                  <TableCell className='text-xs text-muted-foreground'>{d.entry_narration}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </TabsContent>
</Tabs>
)}

{/* CATEGORY MASTER DIALOG */}
<Dialog open={showCats} onOpenChange={setShowCats}>
  <DialogContent className='max-w-5xl max-h-[80vh] overflow-y-auto'>
    <DialogHeader>
      <DialogTitle>Asset Category Master — Schedule II Companies Act 2013</DialogTitle>
      <DialogDescription>Global categories are Schedule II defaults. Firm-specific categories can have their method changed.</DialogDescription>
    </DialogHeader>
    <Table>
      <TableHeader><TableRow className='text-xs bg-muted'>
        <TableHead>Name</TableHead><TableHead>Asset Class</TableHead><TableHead>Part</TableHead>
        <TableHead className='text-right'>Life</TableHead><TableHead className='text-right'>WDV%</TableHead>
        <TableHead className='text-right'>SLM%</TableHead><TableHead className='text-right'>Residual%</TableHead>
        <TableHead>Method</TableHead><TableHead>Scope</TableHead>
      </TableRow></TableHeader>
      <TableBody>
        {(cats||[]).map((c:any) => (
          <TableRow key={c.id} className='text-sm'>
            <TableCell className='font-medium'>{c.name}</TableCell>
            <TableCell className='text-xs'>{c.asset_class}</TableCell>
            <TableCell className='text-xs'>{c.schedule_ii_part}</TableCell>
            <TableCell className='text-right text-xs'>{c.useful_life_years}yr</TableCell>
            <TableCell className='text-right font-mono text-xs'>{fmtPct(c.wdv_rate)}</TableCell>
            <TableCell className='text-right font-mono text-xs'>{fmtPct(c.slm_rate)}</TableCell>
            <TableCell className='text-right text-xs'>{c.residual_value_pct}%</TableCell>
            <TableCell>
              {c.firm_id ? (
                <Select value={c.depreciation_method||'WDV'} onValueChange={async(val)=>{
                  await supabase.from('fa_categories').update({depreciation_method:val} as any).eq('id',c.id);
                  refetchCats(); toast.success(`${c.name} → ${val}`);
                }}>
                  <SelectTrigger className='h-7 text-xs w-20'><SelectValue/></SelectTrigger>
                  <SelectContent><SelectItem value='WDV'>WDV</SelectItem><SelectItem value='SLM'>SLM</SelectItem></SelectContent>
                </Select>
              ) : <MethodBadge method={c.depreciation_method||'WDV'}/>}
            </TableCell>
            <TableCell><Badge variant='outline' className='text-[10px]'>{c.firm_id?'Firm':'Global'}</Badge></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
    <Separator className='my-2'/>
    <Button size='sm' onClick={()=>setShowAddCat(true)} className='gap-1'><Plus size={14}/>Add Custom Category</Button>
  </DialogContent>
</Dialog>

{/* ADD CUSTOM CATEGORY DIALOG */}
<Dialog open={showAddCat} onOpenChange={setShowAddCat}>
  <DialogContent className='max-w-md'>
    <DialogHeader><DialogTitle>Add Custom Asset Category</DialogTitle></DialogHeader>
    <div className='grid gap-3'>
      <div><Label>Category Name *</Label><Input value={nc.name} onChange={e=>setNc(p=>({...p,name:e.target.value}))}/></div>
      <div className='grid grid-cols-2 gap-3'>
        <div><Label>Asset Class *</Label><Input value={nc.asset_class} onChange={e=>setNc(p=>({...p,asset_class:e.target.value}))}/></div>
        <div><Label>Schedule II Part</Label>
          <Select value={nc.schedule_ii_part} onValueChange={v=>setNc(p=>({...p,schedule_ii_part:v}))}>
            <SelectTrigger><SelectValue/></SelectTrigger>
            <SelectContent><SelectItem value='A'>Part A</SelectItem><SelectItem value='B'>Part B</SelectItem><SelectItem value='C'>Part C</SelectItem></SelectContent>
          </Select>
        </div>
      </div>
      <div className='grid grid-cols-2 gap-3'>
        <div><Label>Method *</Label>
          <Select value={nc.depreciation_method} onValueChange={v=>setNc(p=>({...p,depreciation_method:v}))}>
            <SelectTrigger><SelectValue/></SelectTrigger>
            <SelectContent><SelectItem value='WDV'>WDV</SelectItem><SelectItem value='SLM'>SLM</SelectItem></SelectContent>
          </Select>
        </div>
        <div><Label>Useful Life (yrs) *</Label><Input type='number' value={nc.useful_life_years} onChange={e=>setNc(p=>({...p,useful_life_years:e.target.value}))}/></div>
      </div>
      <div className='grid grid-cols-3 gap-3'>
        <div><Label>WDV Rate % *</Label><Input type='number' step='0.01' value={nc.wdv_rate} onChange={e=>setNc(p=>({...p,wdv_rate:e.target.value}))}/></div>
        <div><Label>SLM Rate %</Label><Input type='number' step='0.01' value={nc.slm_rate} onChange={e=>setNc(p=>({...p,slm_rate:e.target.value}))}/></div>
        <div><Label>Residual %</Label><Input type='number' value={nc.residual_value_pct} onChange={e=>setNc(p=>({...p,residual_value_pct:e.target.value}))}/></div>
      </div>
    </div>
    <DialogFooter>
      <Button variant='outline' onClick={()=>setShowAddCat(false)}>Cancel</Button>
      <Button onClick={()=>addCatMut.mutate()} disabled={!nc.name||!nc.wdv_rate||addCatMut.isPending}>Add Category</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>

{/* ADD ASSET DIALOG */}
<Dialog open={showAdd} onOpenChange={setShowAdd}>
  <DialogContent className='max-w-xl'>
    <DialogHeader><DialogTitle>Add Fixed Asset — {fy}</DialogTitle></DialogHeader>
    {assetErrs.length>0&&(<Alert variant='destructive'>
      <AlertTriangle size={14} className='mr-2'/>
      <AlertDescription><ul className='list-disc list-inside text-xs space-y-1'>{assetErrs.map((e,i)=><li key={i}>{e}</li>)}</ul></AlertDescription>
    </Alert>)}
    <div className='grid gap-3'>
      <div><Label>Asset Name *</Label><Input value={na.asset_name} onChange={e=>setNa(p=>({...p,asset_name:e.target.value}))}/></div>
      <div>
        <Label>Category *</Label>
        <Select value={na.category_id} onValueChange={v=>setNa(p=>({...p,category_id:v}))}>
          <SelectTrigger><SelectValue placeholder='Select category'/></SelectTrigger>
          <SelectContent>
            {(cats||[]).map((c:any)=>(
              <SelectItem key={c.id} value={c.id}>{c.name} — {c.depreciation_method||'WDV'} {fmtPct(c.depreciation_method==='SLM'?c.slm_rate:c.wdv_rate)} ({c.useful_life_years}yr)</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selCat&&(
          <div className={cn('mt-2 px-3 py-2 rounded text-xs flex items-center gap-3',
            selCat.depreciation_method==='SLM'
              ?'bg-blue-50 dark:bg-blue-950/30 border border-blue-200'
              :'bg-amber-50 dark:bg-amber-950/30 border border-amber-200'
          )}>
            <MethodBadge method={selCat.depreciation_method||'WDV'}/>
            <span className='text-muted-foreground'>Rate:</span>
            <span className='font-semibold font-mono'>{fmtPct(selCat.depreciation_method==='SLM'?selCat.slm_rate:selCat.wdv_rate)}</span>
            <span className='ml-auto text-muted-foreground'>Applied on: {selCat.depreciation_method==='SLM'?'Original Gross Block':'Written Down Value'}</span>
          </div>
        )}
      </div>
      <div className='grid grid-cols-2 gap-3'>
        <div><Label>Date of Purchase *</Label><Input type='date' value={na.date_of_purchase} onChange={e=>setNa(p=>({...p,date_of_purchase:e.target.value}))}/></div>
        <div><Label>Location</Label><Input value={na.location} onChange={e=>setNa(p=>({...p,location:e.target.value}))}/></div>
      </div>
      <Separator/>
      <p className='text-xs font-semibold text-muted-foreground uppercase tracking-wider'>Opening Balances (start of {fy})</p>
      <div className='grid grid-cols-2 gap-3'>
        <div><Label>Gross Block Opening (₹)</Label><Input type='number' value={na.gross_block_opening} onChange={e=>setNa(p=>({...p,gross_block_opening:e.target.value}))}/></div>
        <div><Label>Accumulated Dep Opening (₹)</Label><Input type='number' value={na.accumulated_dep_opening} onChange={e=>setNa(p=>({...p,accumulated_dep_opening:e.target.value}))}/></div>
      </div>
      <p className='text-xs font-semibold text-muted-foreground uppercase tracking-wider'>Movements During {fy}</p>
      <div className='grid grid-cols-2 gap-3'>
        <div><Label>Additions During Year (₹)</Label><Input type='number' value={na.additions_during_year} onChange={e=>setNa(p=>({...p,additions_during_year:e.target.value}))}/></div>
        <div><Label>Addition Date {parseFloat(na.additions_during_year)>0&&'*'}</Label><Input type='date' value={na.addition_date} onChange={e=>setNa(p=>({...p,addition_date:e.target.value}))}/></div>
        <div><Label>Disposals During Year (₹)</Label><Input type='number' value={na.disposals_during_year} onChange={e=>setNa(p=>({...p,disposals_during_year:e.target.value}))}/></div>
        <div><Label>Disposal Date {parseFloat(na.disposals_during_year)>0&&'*'}</Label><Input type='date' value={na.disposal_date} onChange={e=>setNa(p=>({...p,disposal_date:e.target.value}))}/></div>
      </div>
      <div><Label>Narration</Label><Input value={na.narration} onChange={e=>setNa(p=>({...p,narration:e.target.value}))}/></div>
    </div>
    <DialogFooter>
      <Button variant='outline' onClick={()=>setShowAdd(false)}>Cancel</Button>
      <Button onClick={()=>addMut.mutate()} disabled={!na.asset_name||!na.category_id||!na.date_of_purchase||addMut.isPending}>
        {addMut.isPending&&<Loader2 size={14} className='mr-1 animate-spin'/>}Add Asset
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>

{/* CALCULATE CONFIRM DIALOG */}
<Dialog open={showConfirm} onOpenChange={setShowConfirm}>
  <DialogContent>
    <DialogHeader><DialogTitle>Calculate Depreciation — {fy}</DialogTitle></DialogHeader>
    <Alert><Info size={14} className='mr-2'/>
      <AlertDescription className='text-xs'>
        WDV: rate on Written Down Value. SLM: rate on original Gross Block.
        Additions proportionate from addition date. Disposal: to end of disposal month.
      </AlertDescription>
    </Alert>
    <DialogFooter>
      <Button variant='outline' onClick={()=>setShowConfirm(false)}>Cancel</Button>
      <Button onClick={handleCalc}>Yes, Calculate</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>

{/* CALCULATION RESULTS DIALOG */}
{calcResult&&(
  <Dialog open={!!calcResult} onOpenChange={()=>setCalcResult(null)}>
    <DialogContent className='max-w-3xl max-h-[70vh] overflow-y-auto'>
      <DialogHeader>
        <DialogTitle className='flex items-center gap-2'>
          <CheckCircle2 size={18} className='text-emerald-500'/>
          Depreciation Calculated — {(calcResult as any).count} Assets
        </DialogTitle>
      </DialogHeader>
      {(calcResult as any).errors?.length>0&&(<Alert variant='destructive'><AlertDescription>
        <ul className='list-disc list-inside text-xs space-y-1'>{(calcResult as any).errors.map((e:string,i:number)=><li key={i}>{e}</li>)}</ul>
      </AlertDescription></Alert>)}
      {(calcResult as any).warnings?.length>0&&(<Alert><AlertTriangle size={14} className='mr-1'/><AlertDescription className='text-xs'>{(calcResult as any).warnings.length} asset(s) have warnings — check below.</AlertDescription></Alert>)}
      <Table>
        <TableHeader><TableRow className='text-xs'>
          <TableHead>Asset</TableHead><TableHead>Category</TableHead>
          <TableHead className='text-center'>Method</TableHead>
          <TableHead className='text-right'>Rate%</TableHead>
          <TableHead className='text-right'>WDV Open</TableHead>
          <TableHead className='text-right'>Dep on Open</TableHead>
          <TableHead className='text-right'>Dep on Add</TableHead>
          <TableHead className='text-right'>Total Dep</TableHead>
          <TableHead className='text-right'>WDV Close</TableHead>
          <TableHead>Status</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {((calcResult as any).results||[]).map((r:any)=>(
            <TableRow key={r.asset_id} className={r.status==='warning'?'bg-amber-50 dark:bg-amber-950/20':''}>
              <TableCell className='text-xs font-medium'>{r.asset_name}</TableCell>
              <TableCell className='text-xs'>{r.category}</TableCell>
              <TableCell className='text-center'><MethodBadge method={r.method}/></TableCell>
              <TableCell className='text-right text-xs'>{fmtPct(r.rate_used)}</TableCell>
              <TableCell className='text-right text-xs tabular-nums'>{fmt(r.wdv_opening)}</TableCell>
              <TableCell className='text-right text-xs tabular-nums'>{fmt(r.dep_on_opening)}</TableCell>
              <TableCell className='text-right text-xs tabular-nums'>{fmt(r.dep_on_additions)}</TableCell>
              <TableCell className='text-right text-xs tabular-nums font-semibold'>{fmt(r.total_depreciation)}</TableCell>
              <TableCell className='text-right text-xs tabular-nums'>{fmt(r.wdv_closing)}</TableCell>
              <TableCell>
                <Badge variant='outline' className={cn('text-[9px]',
                  r.status==='ok'?'border-emerald-400 text-emerald-700'
                  :r.status==='warning'?'border-amber-400 text-amber-700'
                  :'border-muted text-muted-foreground'
                )}>{r.status==='fully_depreciated'?'Fully Dep.':r.status}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <DialogFooter>
        <Button onClick={()=>{setCalcResult(null);setActiveTab('schedule');}}>View Depreciation Schedule</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
)}

{/* DISPOSAL DIALOG */}
<Dialog open={!!showDispose} onOpenChange={()=>setShowDispose(null)}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Record Asset Disposal</DialogTitle>
      <DialogDescription>{assets?.find((a:any)=>a.id===showDispose)?.asset_name}</DialogDescription>
    </DialogHeader>
    {showDispose&&(()=>{
      const asset=assets?.find((a:any)=>a.id===showDispose);
      if(!asset) return null;
      const gb=parseFloat(asset.gross_block_opening)||0;
      const ad=parseFloat(asset.accumulated_dep_opening)||0;
      const add=parseFloat(asset.additions_during_year)||0;
      const nbv=gb-ad+add;
      const proceeds=parseFloat(df.disposal_proceeds)||0;
      const pl=proceeds-nbv;
      return (
        <div className='grid gap-4'>
          <div className='grid grid-cols-2 gap-2 bg-muted/50 rounded p-3 text-sm'>
            <span className='text-muted-foreground'>Gross Block:</span><span className='font-mono text-right'>₹{fmt(gb)}</span>
            <span className='text-muted-foreground'>Acc. Depreciation:</span><span className='font-mono text-right'>₹{fmt(ad)}</span>
            <span className='font-semibold'>Net Book Value:</span><span className='font-mono font-semibold text-right'>₹{fmt(nbv)}</span>
          </div>
          <div><Label>Disposal Date *</Label><Input type='date' value={df.disposal_date} onChange={e=>setDf(p=>({...p,disposal_date:e.target.value}))}/></div>
          <div><Label>Disposal Proceeds (₹)</Label><Input type='number' value={df.disposal_proceeds} onChange={e=>setDf(p=>({...p,disposal_proceeds:e.target.value}))}/></div>
          {proceeds!==0&&(<div className={cn('p-2 rounded text-sm font-medium',
            pl>=0?'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30':'bg-red-50 text-red-700 dark:bg-red-950/30'
          )}>{pl>=0?'Profit':'Loss'} on disposal: ₹{fmt(Math.abs(pl))}</div>)}
          <div><Label>Narration</Label><Input value={df.narration} onChange={e=>setDf(p=>({...p,narration:e.target.value}))}/></div>
        </div>
      );
    })()}
    <DialogFooter>
      <Button variant='outline' onClick={()=>setShowDispose(null)}>Cancel</Button>
      <Button onClick={()=>dispMut.mutate()} disabled={!df.disposal_date}>Record Disposal</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
</div>
);
}
