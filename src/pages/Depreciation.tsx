import { useState, useMemo, Fragment } from 'react';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Calculator, Lock, LockOpen, Plus, Trash2, ArrowRight, AlertTriangle,
CheckCircle2, Settings, Info, Loader2, Pencil, X, FileText, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const FY_OPTIONS = (() => {
  const opts: string[] = [];
  const currentYear = new Date().getFullYear();
  for (let y = currentYear + 1; y >= 2001; y--) {
    opts.push(`${y}-${String(y + 1).slice(-2)}`);
  }
  return opts;
})();

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
  // FIX GEN-4: Block adding an asset whose purchase date falls in a
  // future financial year relative to the currently selected FY.
  if (fy && a.date_of_purchase) {
    const fyY = parseInt(fy.split('-')[0]);
    const fyLastDay = new Date(fyY + 1, 2, 31); // Mar 31 of FY end year
    const purchDate = new Date(a.date_of_purchase);
    if (purchDate > fyLastDay) {
      errs.push(
        `Date of Purchase (${a.date_of_purchase}) is beyond FY ${fy}. ` +
        `You cannot add a future-year asset to this financial year.`
      );
    }
  }
  // Residual value validation
  if (a.residual_value != null && a.residual_value !== '') {
    const rv = parseFloat(a.residual_value) || 0;
    if (rv < 0) errs.push('Residual Value cannot be negative.');
    if (rv >= gb && gb > 0) errs.push('Residual Value must be less than Cost of Asset (Gross Block Opening).');
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

const emptyBulkRow = () => ({
  asset_name: '', category_id: '', location: '', date_of_purchase: '',
  gross_block_opening: '0', accumulated_dep_opening: '0', residual_value: '',
  additions_during_year: '0', addition_date: '', narration: '',
});

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
const [finalizing, setFinalizing] = useState(false);
const [registerView, setRegisterView] = useState<'flat'|'category'>('flat');
const [showBulkAdd, setShowBulkAdd] = useState(false);
const [bulkRows, setBulkRows] = useState(Array.from({length:5}, emptyBulkRow));
const [bulkSaving, setBulkSaving] = useState(false);
const [editAsset, setEditAsset] = useState<any>(null);
const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
const [scheduleView, setScheduleView] = useState<'asset'|'category'>('asset');

// Carry forward & unlock state
const [showCarryForward, setShowCarryForward] = useState(false);
const [carryingForward, setCarryingForward] = useState(false);
const [unlocking, setUnlocking] = useState(false);

const [na, setNa] = useState({
asset_name:'', category_id:'', location:'', date_of_purchase:'',
gross_block_opening:'0', accumulated_dep_opening:'0',
residual_value:'',
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
  const COMPANY_TYPES = ['Private Ltd', 'Public Ltd', 'OPC'];
  let q = supabase
    .from('clients')
    .select('id, name, entity_type')
    .in('entity_type', COMPANY_TYPES)
    .order('name');
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
.select('*,fa_assets(asset_name,asset_code,dep_on_opening_block,dep_on_additions,additions_during_year,depreciation_method_used,residual_value,fa_categories(name,depreciation_method,wdv_rate,slm_rate,useful_life_years,residual_value_pct))')
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

// Additions Log query
const { data: additionsLog } = useQuery({
queryKey: ['fa-additions-log', clientId, fy],
queryFn: async () => {
const ids = (assets||[]).map((a:any) => a.id);
if (!ids.length) return [];
const { data } = await supabase
.from('fa_asset_additions')
.select('*, fa_assets(asset_name, asset_code, fa_categories(name))')
.in('asset_id', ids)
.order('addition_date', { ascending: false });
return data || [];
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
residual_value:          na.residual_value ? parseFloat(na.residual_value) : null,
additions_during_year:   parseFloat(na.additions_during_year)||0,
addition_date:           na.addition_date||null,
disposals_during_year:   parseFloat(na.disposals_during_year)||0,
disposal_date:           na.disposal_date||null,
narration:               na.narration||null,
created_by: user?.id,
} as any);
if (error) throw error;
// Log addition if additions > 0
const addAmt = parseFloat(na.additions_during_year)||0;
if (addAmt > 0 && na.addition_date) {
  // We need the inserted asset id — fetch latest
  const { data: latest } = await supabase.from('fa_assets')
    .select('id').eq('client_id', clientId).eq('fy', fy).eq('asset_code', code).single();
  if (latest) {
    await supabase.from('fa_asset_additions').insert({
      asset_id: latest.id, addition_date: na.addition_date,
      addition_amount: addAmt, description: na.asset_name,
      entry_narration: na.narration || null, created_by: user?.id,
    } as any);
  }
}
},
onSuccess: () => {
toast.success('Asset added');
qc.invalidateQueries({queryKey:['dep-assets',clientId,fy]});
qc.invalidateQueries({queryKey:['fa-additions-log',clientId,fy]});
setShowAdd(false);
setNa({asset_name:'',category_id:'',location:'',date_of_purchase:'',
       gross_block_opening:'0',accumulated_dep_opening:'0',
       residual_value:'',
       additions_during_year:'0',addition_date:'',
       disposals_during_year:'0',disposal_date:'',narration:''});
},
onError: (e:any) => { if(e.message!=='validation') toast.error(e.message); },
});

const editMut = useMutation({
mutationFn: async () => {
if (!editAsset) return;
const errs = validateAsset(editAsset, fy);
if (errs.length > 0) { toast.error(errs[0]); throw new Error('validation'); }
const { error } = await supabase.from('fa_assets').update({
  asset_name:              editAsset.asset_name,
  category_id:             editAsset.category_id,
  location:                editAsset.location || null,
  date_of_purchase:        editAsset.date_of_purchase,
  gross_block_opening:     parseFloat(editAsset.gross_block_opening)    || 0,
  accumulated_dep_opening: parseFloat(editAsset.accumulated_dep_opening) || 0,
  residual_value:          editAsset.residual_value
                             ? parseFloat(editAsset.residual_value) : null,
  additions_during_year:   parseFloat(editAsset.additions_during_year)  || 0,
  addition_date:           editAsset.addition_date || null,
  disposals_during_year:   parseFloat(editAsset.disposals_during_year)  || 0,
  disposal_date:           editAsset.disposal_date || null,
  narration:               editAsset.narration || null,
  depreciation_for_year:   null,
  wdv_closing:             null,
} as any).eq('id', editAsset.id);
if (error) throw error;
// Log addition if additions > 0
const addAmt = parseFloat(editAsset.additions_during_year)||0;
if (addAmt > 0 && editAsset.addition_date) {
  await supabase.from('fa_asset_additions').insert({
    asset_id: editAsset.id, addition_date: editAsset.addition_date,
    addition_amount: addAmt, description: editAsset.asset_name,
    entry_narration: editAsset.narration || null, created_by: user?.id,
  } as any);
}
},
onSuccess: () => {
toast.success('Asset updated. Run Calculate Depreciation to refresh.');
qc.invalidateQueries({ queryKey: ['dep-assets', clientId, fy] });
qc.invalidateQueries({ queryKey: ['fa-additions-log', clientId, fy] });
setEditAsset(null);
},
onError: (e: any) => { if (e.message !== 'validation') toast.error(e.message); },
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

// Finalize handler — locks assets, then offers carry forward
const handleFinalize = async () => {
if (!window.confirm(
  `Finalize depreciation for ${fy}?\n\n` +
  `This will lock all ${assets?.length} assets and prevent further edits.\n` +
  `Calculation must be run before finalizing.`
)) return;
const uncalculated = (assets || []).filter((a: any) => a.depreciation_for_year == null);
if (uncalculated.length > 0) {
  toast.error(
    `Cannot finalize — ${uncalculated.length} asset(s) have no depreciation calculated.`,
    { description: 'Run Calculate Depreciation first.' }
  );
  return;
}
setFinalizing(true);
try {
  const ids = (assets || []).map((a: any) => a.id);
  const { error } = await supabase
    .from('fa_assets')
    .update({ is_locked: true, is_finalized: true } as any)
    .in('id', ids);
  if (error) throw error;

  // Auto-update next-FY carried-forward rows if they exist
  const [startY] = fy.split('-');
  const nextFyStr = `${parseInt(startY)+1}-${String(parseInt(startY)+2).slice(-2)}`;
  const { data: nextFyAssets } = await supabase
    .from('fa_assets')
    .select('id, asset_code')
    .eq('client_id', clientId)
    .eq('fy', nextFyStr)
    .eq('is_carried_forward', true);

  if (nextFyAssets && nextFyAssets.length > 0) {
    for (const a of (assets || [])) {
      const gbOpen    = parseFloat(a.gross_block_opening)    || 0;
      const addns     = parseFloat(a.additions_during_year)  || 0;
      const disps     = parseFloat(a.disposals_during_year)  || 0;
      const acDepOpen = parseFloat(a.accumulated_dep_opening) || 0;
      const depForYr  = parseFloat(a.depreciation_for_year)  || 0;
      const gbClose   = gbOpen + addns - disps;
      const acClose   = acDepOpen + depForYr;
      const match = nextFyAssets.find((n: any) =>
        n.asset_code?.startsWith(a.asset_code?.split('-').slice(0, -1).join('-') || ''));
      if (match) {
        await supabase.from('fa_assets').update({
          gross_block_opening:     gbClose,
          accumulated_dep_opening: acClose,
        } as any).eq('id', match.id);
      }
    }
    toast.info(`${nextFyAssets.length} next-FY opening balances updated.`);
  }

  toast.success(`FY ${fy} depreciation finalized and locked.`);
  qc.invalidateQueries({ queryKey: ['dep-assets', clientId, fy] });
  setShowCarryForward(true);
} catch (e: any) { toast.error(e.message); }
finally { setFinalizing(false); }
};

// Carry Forward handler
const handleCarryForward = async () => {
const [startY] = fy.split('-');
const nextFyStart = parseInt(startY) + 1;
const nextFy = `${nextFyStart}-${String(nextFyStart + 1).slice(-2)}`;

setCarryingForward(true);
try {
  const activeAssets = (assets || []).filter((a: any) =>
    (parseFloat(a.disposals_during_year) || 0) === 0
  );

  const { count: existingCount } = await supabase
    .from('fa_assets')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('fy', nextFy);

  if ((existingCount ?? 0) > 0) {
    toast.error(`Next FY (${nextFy}) already has ${existingCount} assets. Clear them first.`);
    return;
  }

  const nextFyRows = activeAssets.map((a: any) => {
    const gbOpen    = parseFloat(a.gross_block_opening)    || 0;
    const addns     = parseFloat(a.additions_during_year)  || 0;
    const disps     = parseFloat(a.disposals_during_year)  || 0;
    const acDepOpen = parseFloat(a.accumulated_dep_opening) || 0;
    const depForYr  = parseFloat(a.depreciation_for_year)  || 0;
    const gbClosing = gbOpen + addns - disps;
    const acDepClose= acDepOpen + depForYr;
    return {
      client_id:               clientId,
      fy:                      nextFy,
      asset_name:              a.asset_name,
      asset_code:              a.asset_code?.replace(fy.replace('-',''), nextFy.replace('-','')),
      category_id:             a.category_id,
      location:                a.location,
      date_of_purchase:        a.date_of_purchase,
      gross_block_opening:     gbClosing,
      accumulated_dep_opening: acDepClose,
      additions_during_year:   0,
      disposals_during_year:   0,
      disposal_proceeds:       0,
      residual_value:          a.residual_value,
      is_carried_forward:      true,
      is_locked:               false,
      is_finalized:            false,
      created_by:              user?.id,
    };
  });

  const { error } = await supabase.from('fa_assets').insert(nextFyRows as any);
  if (error) throw error;

  toast.success(
    `${nextFyRows.length} assets carried forward to ${nextFy}. ` +
    `Switch to ${nextFy} to view and edit them.`
  );
  setShowCarryForward(false);
  qc.invalidateQueries({ queryKey: ['dep-assets', clientId, nextFy] });
} catch(e: any) { toast.error(e.message); }
finally { setCarryingForward(false); }
};

// Unlock handler
const handleUnlock = async () => {
if (!window.confirm(
  `Unlock FY ${fy}?\n\n` +
  `This will re-open all assets for editing. ` +
  `After making changes, you must Recalculate and Re-Finalize. ` +
  `If next-FY data has been carried forward, its opening balances ` +
  `will be updated automatically when you Re-Finalize.`
)) return;
setUnlocking(true);
try {
  const ids = (assets || []).map((a: any) => a.id);
  const { error } = await supabase.from('fa_assets')
    .update({ is_locked: false, is_finalized: false } as any)
    .in('id', ids);
  if (error) throw error;
  toast.success(`FY ${fy} unlocked. Recalculate and Re-Finalize after changes.`);
  qc.invalidateQueries({ queryKey: ['dep-assets', clientId, fy] });
} catch(e: any) { toast.error(e.message); }
finally { setUnlocking(false); }
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
if (!window.confirm('Delete this asset? This cannot be undone.')) return;
const {error} = await supabase.from('fa_assets').delete().eq('id',id);
if (error) { toast.error(error.message); return; }
toast.success('Asset deleted');
qc.invalidateQueries({queryKey:['dep-assets',clientId,fy]});
};

const handleDeleteCategory = async (catId: string, catName: string) => {
const { count, error: countErr } = await supabase
  .from('fa_assets')
  .select('id', { count: 'exact', head: true })
  .eq('category_id', catId);
if (countErr) { toast.error(countErr.message); return; }
if ((count ?? 0) > 0) {
  toast.error(
    `Cannot delete '${catName}' — ${count} asset(s) are assigned to this category.`,
    { description: 'Reassign or delete those assets first.' }
  );
  return;
}
if (!window.confirm(`Delete category '${catName}'? This cannot be undone.`)) return;
const { error } = await supabase.from('fa_categories').delete().eq('id', catId);
if (error) { toast.error(error.message); return; }
toast.success(`Category '${catName}' deleted.`);
refetchCats();
};

const handleBulkSave = async () => {
const validRows = bulkRows.filter(r => r.asset_name.trim() && r.category_id);
if (validRows.length === 0) {
  toast.error('No valid rows to save. Asset Name and Category are required.');
  return;
}
const errors: string[] = [];
validRows.forEach((r, i) => {
  if (!r.date_of_purchase) errors.push(`Row ${i+1}: Date of Purchase is required.`);
  const gb = parseFloat(r.gross_block_opening) || 0;
  const ad = parseFloat(r.accumulated_dep_opening) || 0;
  if (ad > gb) errors.push(`Row ${i+1}: Accumulated Dep cannot exceed Gross Block.`);
});
if (errors.length > 0) { toast.error(errors[0]); return; }

setBulkSaving(true);
try {
  const baseCount = assets?.length || 0;
  const inserts = validRows.map((r, i) => ({
    client_id: clientId, fy,
    asset_code: `FA-${fy.replace('-','')}-${String(baseCount+i+1).padStart(4,'0')}`,
    asset_name: r.asset_name.trim(),
    category_id: r.category_id,
    location: r.location || null,
    date_of_purchase: r.date_of_purchase,
    gross_block_opening:     parseFloat(r.gross_block_opening)    || 0,
    accumulated_dep_opening: parseFloat(r.accumulated_dep_opening) || 0,
    residual_value:          r.residual_value ? parseFloat(r.residual_value) : null,
    additions_during_year:   parseFloat(r.additions_during_year)  || 0,
    addition_date:           r.addition_date || null,
    narration:               r.narration || null,
    created_by:              user?.id,
  }));
  const { error } = await supabase.from('fa_assets').insert(inserts as any);
  if (error) throw error;
  toast.success(`${inserts.length} asset(s) saved successfully.`);
  qc.invalidateQueries({ queryKey: ['dep-assets', clientId, fy] });
  qc.invalidateQueries({ queryKey: ['fa-additions-log', clientId, fy] });
  setShowBulkAdd(false);
  setBulkRows(Array.from({length:5}, emptyBulkRow));
} catch(e:any) { toast.error(e.message); }
finally { setBulkSaving(false); }
};

// ── Excel Export ──────────────────────────────────────────────
const handleExcelExport = () => {
if (!assets?.length) { toast.error('No assets to export'); return; }
const clientName = clients?.find((c: any) => c.id === clientId)?.name || 'Client';
const wb = XLSX.utils.book_new();

// SHEET 1: ASSET REGISTER
const regData: any[][] = [
  [clientName + ' — Fixed Asset Register', '', '', '', '', '', '', '', '', '', '', '', ''],
  ['Financial Year: ' + fy + ' | Companies Act 2013 — Schedule II', '', '', '', '', '', '', '', '', '', '', '', ''],
  [],
  ['#', 'Asset Code', 'Asset Name', 'Category', 'Method',
   'Purch Date', 'Gross Block Opening', 'Additions',
   'Acc Dep Opening', 'Residual Value', 'WDV Opening',
   'Dep for Year', 'WDV Closing'],
];
const dataStart = 5;
(assets || []).forEach((a: any, i: number) => {
  const row = dataStart + i;
  const gb   = parseFloat(a.gross_block_opening)    || 0;
  const ad   = parseFloat(a.accumulated_dep_opening) || 0;
  const addns = parseFloat(a.additions_during_year)  || 0;
  const res   = a.residual_value ?? Math.round(gb * (parseFloat(a.fa_categories?.residual_value_pct)||5) / 100 * 100)/100;
  const dep   = parseFloat(a.depreciation_for_year)  || 0;
  regData.push([
    i + 1, a.asset_code, a.asset_name,
    a.fa_categories?.name || '', a.fa_categories?.depreciation_method || 'WDV',
    a.date_of_purchase,
    gb, addns, ad, res,
    { f: `G${row}-I${row}`, v: gb - ad },
    dep,
    { f: `K${row}+H${row}-L${row}`, v: gb - ad + addns - dep },
  ]);
});
const lastRow = dataStart + (assets?.length || 0) - 1;
regData.push([
  '', '', 'TOTAL', '', '', '',
  { f: `SUM(G${dataStart}:G${lastRow})`, v: (assets||[]).reduce((s:number,a:any)=>s+(parseFloat(a.gross_block_opening)||0),0) },
  { f: `SUM(H${dataStart}:H${lastRow})`, v: (assets||[]).reduce((s:number,a:any)=>s+(parseFloat(a.additions_during_year)||0),0) },
  { f: `SUM(I${dataStart}:I${lastRow})`, v: (assets||[]).reduce((s:number,a:any)=>s+(parseFloat(a.accumulated_dep_opening)||0),0) },
  { f: `SUM(J${dataStart}:J${lastRow})`, v: 0 },
  { f: `SUM(K${dataStart}:K${lastRow})`, v: (assets||[]).reduce((s:number,a:any)=>s+((parseFloat(a.gross_block_opening)||0)-(parseFloat(a.accumulated_dep_opening)||0)),0) },
  { f: `SUM(L${dataStart}:L${lastRow})`, v: (assets||[]).reduce((s:number,a:any)=>s+(parseFloat(a.depreciation_for_year)||0),0) },
  { f: `SUM(M${dataStart}:M${lastRow})`, v: (assets||[]).reduce((s:number,a:any)=>s+(parseFloat(a.wdv_closing)||0),0) },
]);
const wsReg = XLSX.utils.aoa_to_sheet(regData);
wsReg['!cols'] = [{wch:4},{wch:14},{wch:30},{wch:22},{wch:6},{wch:12},{wch:18},{wch:15},{wch:18},{wch:15},{wch:15},{wch:15},{wch:15}];
wsReg['!merges'] = [{s:{r:0,c:0},e:{r:0,c:12}},{s:{r:1,c:0},e:{r:1,c:12}}];
XLSX.utils.book_append_sheet(wb, wsReg, 'Asset Register');

// SHEET 2: DEPRECIATION SCHEDULE
const schedData: any[][] = [
  [clientName + ' — Depreciation Schedule', '', '', '', '', '', '', ''],
  ['Financial Year: ' + fy, '', '', '', '', '', '', ''],
  [],
  ['Asset Code', 'Asset Name', 'Category', 'Method', 'Rate / Basis', 'WDV Opening', 'Dep Amount', 'WDV Closing'],
];
(schedule || []).forEach((s: any) => {
  const ast = s.fa_assets;
  const method = ast?.depreciation_method_used || ast?.fa_categories?.depreciation_method || 'WDV';
  const cat = ast?.fa_categories;
  const rateBasis = method === 'SLM'
    ? `(Cost-Res)/${cat?.useful_life_years}yr = SLM`
    : `${parseFloat(s.depreciation_rate).toFixed(2)}% WDV`;
  schedData.push([
    ast?.asset_code, ast?.asset_name, ast?.fa_categories?.name, method, rateBasis,
    parseFloat(s.wdv_opening), parseFloat(s.depreciation_amount), parseFloat(s.wdv_closing),
  ]);
});
const wsSched = XLSX.utils.aoa_to_sheet(schedData);
wsSched['!cols'] = [{wch:14},{wch:30},{wch:22},{wch:6},{wch:24},{wch:15},{wch:15},{wch:15}];
wsSched['!merges'] = [{s:{r:0,c:0},e:{r:0,c:7}},{s:{r:1,c:0},e:{r:1,c:7}}];
XLSX.utils.book_append_sheet(wb, wsSched, 'Dep Schedule');

// SHEET 3: CATEGORY-WISE SUMMARY
const sumData: any[][] = [
  [clientName + ' — Category-wise Summary', '', '', '', '', '', '', '', '', ''],
  ['Financial Year: ' + fy, '', '', '', '', '', '', '', '', ''],
  [],
  ['Category', 'Life (yrs)', 'Gross Open', 'Additions', 'Disposals',
   'Gross Close', 'Acc Dep Open', 'Dep for Year', 'Acc Dep Close', 'Net Block'],
];
(summary || []).forEach((s: any) => {
  sumData.push([
    s.category_name, s.useful_life_years,
    parseFloat(s.gross_block_opening), parseFloat(s.additions),
    parseFloat(s.disposals), parseFloat(s.gross_block_closing),
    parseFloat(s.acc_dep_opening), parseFloat(s.depreciation),
    parseFloat(s.acc_dep_closing), parseFloat(s.net_block),
  ]);
});
const wsSum = XLSX.utils.aoa_to_sheet(sumData);
wsSum['!cols'] = [{wch:24},{wch:8},{wch:16},{wch:14},{wch:12},{wch:16},{wch:16},{wch:14},{wch:16},{wch:14}];
wsSum['!merges'] = [{s:{r:0,c:0},e:{r:0,c:9}},{s:{r:1,c:0},e:{r:1,c:9}}];
XLSX.utils.book_append_sheet(wb, wsSum, 'Summary');

// SHEET 4: DISPOSAL LOG
if (disposals?.length) {
  const dispData: any[][] = [
    [clientName + ' — Disposal Log', '', '', '', '', '', '', ''],
    ['Financial Year: ' + fy, '', '', '', '', '', '', ''],
    [],
    ['Asset', 'Disposal Date', 'Gross Reversed', 'Acc Dep Reversed',
     'Net Book Value', 'Proceeds', 'Profit/(Loss)', 'Narration'],
  ];
  (disposals || []).forEach((d: any) => {
    dispData.push([
      d.fa_assets?.asset_name, d.disposal_date,
      parseFloat(d.gross_block_reversed), parseFloat(d.accumulated_dep_reversed),
      parseFloat(d.net_book_value_at_disposal), parseFloat(d.disposal_proceeds),
      parseFloat(d.profit_loss_on_disposal), d.entry_narration || '',
    ]);
  });
  const wsDisp = XLSX.utils.aoa_to_sheet(dispData);
  wsDisp['!cols'] = [{wch:28},{wch:14},{wch:16},{wch:18},{wch:16},{wch:14},{wch:14},{wch:30}];
  wsDisp['!merges'] = [{s:{r:0,c:0},e:{r:0,c:7}},{s:{r:1,c:0},e:{r:1,c:7}}];
  XLSX.utils.book_append_sheet(wb, wsDisp, 'Disposals');
}

XLSX.writeFile(wb, `${clientName.replace(/[^a-z0-9]/gi,'_')}_Depreciation_${fy}.xlsx`);
toast.success('Excel exported successfully');
};

// ── PDF Export ──────────────────────────────────────────────────
const handlePdfExport = () => {
if (!assets?.length) { toast.error('No assets to export'); return; }
const clientName = clients?.find((c: any) => c.id === clientId)?.name || 'Client';

const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
const pageW = doc.internal.pageSize.getWidth();
const pageH = doc.internal.pageSize.getHeight();
const margin = 12;
const DARK   = [13, 17, 23] as [number,number,number];
const GOLD   = [201, 168, 76] as [number,number,number];
const WHITE  = [255, 255, 255] as [number,number,number];
const LTBLUE = [239, 246, 255] as [number,number,number];
const GREY   = [100, 110, 120] as [number,number,number];

// COVER PAGE
doc.setFillColor(...DARK);
doc.rect(0, 0, pageW, pageH, 'F');
doc.setFillColor(...GOLD);
doc.rect(0, pageH * 0.42, pageW, 1.5, 'F');
doc.setFont('helvetica', 'bold');
doc.setFontSize(28);
doc.setTextColor(...GOLD);
doc.text('Fixed Asset Register', pageW / 2, pageH * 0.35, { align: 'center' });
doc.text('& Depreciation Report', pageW / 2, pageH * 0.35 + 14, { align: 'center' });
doc.setFontSize(14);
doc.setTextColor(...WHITE);
doc.text(clientName, pageW / 2, pageH * 0.35 + 28, { align: 'center' });
doc.text(`Financial Year: ${fy}`, pageW / 2, pageH * 0.35 + 38, { align: 'center' });
doc.setFontSize(10);
doc.setTextColor(160, 170, 180);
doc.text('Companies Act 2013 — Schedule II Depreciation', pageW / 2, pageH * 0.35 + 52, { align: 'center' });
doc.text(`Generated on: ${new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'long', year:'numeric' })}`,
  pageW / 2, pageH * 0.35 + 60, { align: 'center' });

const addSection = (title: string, head: string[][], body: any[][]) => {
  doc.addPage();
  // Section title bar
  doc.setFillColor(...DARK);
  doc.rect(margin, margin, pageW - margin*2, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...GOLD);
  doc.text(title, margin + 3, margin + 5.5);

  autoTable(doc, {
    head, body,
    startY: margin + 10,
    margin: { left: margin, right: margin },
    theme: 'grid',
    headStyles: { fillColor: DARK, textColor: GOLD, fontStyle: 'bold', fontSize: 7.5, cellPadding: 2 },
    bodyStyles: { fontSize: 7, cellPadding: 1.5, textColor: [30, 30, 30] },
    alternateRowStyles: { fillColor: LTBLUE },
    footStyles: { fillColor: [240, 247, 255], textColor: DARK, fontStyle: 'bold', fontSize: 7.5 },
    didDrawPage: () => {
      doc.setFontSize(8);
      doc.setTextColor(...GREY);
      doc.text(
        `Page ${(doc as any).internal.getCurrentPageInfo().pageNumber} | ${clientName} | FY ${fy} | Confidential`,
        pageW / 2, pageH - 5, { align: 'center' }
      );
    },
  });
};

// ASSET REGISTER
const regHead = [['#','Code','Asset Name','Category','Method','Purch Date',
                   'Gross Block','Additions','Acc Dep','Residual','WDV Open','Dep/Year','WDV Close']];
const regBody = (assets||[]).map((a: any, i: number) => {
  const gb  = parseFloat(a.gross_block_opening)||0;
  const ad  = parseFloat(a.accumulated_dep_opening)||0;
  const addV = parseFloat(a.additions_during_year)||0;
  const res = a.residual_value ?? Math.round(gb*(parseFloat(a.fa_categories?.residual_value_pct)||5)/100*100)/100;
  const dep = parseFloat(a.depreciation_for_year)||0;
  const wdvO = gb - ad;
  const wdvC = a.wdv_closing ?? wdvO + addV - dep;
  return [i+1, a.asset_code, a.asset_name,
    a.fa_categories?.name||'', a.fa_categories?.depreciation_method||'WDV',
    a.date_of_purchase, fmt(gb), fmt(addV), fmt(ad), fmt(res), fmt(wdvO), fmt(dep), fmt(wdvC)];
});
addSection('Asset Register — ' + fy, regHead, regBody);

// DEPRECIATION SCHEDULE
if (schedule?.length) {
  const schedHead = [['Code','Asset Name','Category','Method','Rate/Basis','WDV Open','Dep Amt','WDV Close']];
  const schedBody = schedule.map((s: any) => {
    const ast = s.fa_assets;
    const m = ast?.depreciation_method_used || 'WDV';
    const cat = ast?.fa_categories;
    return [ast?.asset_code, ast?.asset_name, cat?.name, m,
      m==='SLM'?`(Cost-Res)/${cat?.useful_life_years}yr`:`${parseFloat(s.depreciation_rate).toFixed(2)}% WDV`,
      fmt(parseFloat(s.wdv_opening)), fmt(parseFloat(s.depreciation_amount)), fmt(parseFloat(s.wdv_closing))];
  });
  addSection('Depreciation Schedule — ' + fy, schedHead, schedBody);
}

// CATEGORY SUMMARY
if (summary?.length) {
  const sumHead = [['Category','Life','Gross Open','Additions','Disposals',
                    'Gross Close','Acc Dep Open','Dep/Year','Acc Dep Close','Net Block']];
  const sumBody = summary.map((s: any) => [
    s.category_name, `${s.useful_life_years} yr`,
    fmt(parseFloat(s.gross_block_opening)), fmt(parseFloat(s.additions)),
    fmt(parseFloat(s.disposals)), fmt(parseFloat(s.gross_block_closing)),
    fmt(parseFloat(s.acc_dep_opening)), fmt(parseFloat(s.depreciation)),
    fmt(parseFloat(s.acc_dep_closing)), fmt(parseFloat(s.net_block))]);
  addSection('Category-wise Summary — ' + fy, sumHead, sumBody);
}

// DISPOSAL LOG
if (disposals?.length) {
  const dispHead = [['Asset','Date','Gross Rev.','Acc Dep Rev.','NBV','Proceeds','P/(L)','Narration']];
  const dispBody = disposals.map((d: any) => [
    d.fa_assets?.asset_name, d.disposal_date,
    fmt(parseFloat(d.gross_block_reversed)), fmt(parseFloat(d.accumulated_dep_reversed)),
    fmt(parseFloat(d.net_book_value_at_disposal)), fmt(parseFloat(d.disposal_proceeds)),
    fmt(parseFloat(d.profit_loss_on_disposal)), d.entry_narration||'']);
  addSection('Disposal Log — ' + fy, dispHead, dispBody);
}

doc.save(`${clientName.replace(/[^a-z0-9]/gi,'_')}_Depreciation_${fy}.pdf`);
toast.success('PDF exported successfully');
};

return (
<div className='space-y-6'>
<div className='flex items-center justify-between'>
  <div>
    <h1 className='text-2xl font-bold text-foreground'>Depreciation Register</h1>
    <p className='text-sm text-muted-foreground'>Companies Act 2013 — Schedule II — WDV &amp; SLM Methods</p>
  </div>
  <div className='flex items-center gap-2'>
    {clientId && assets?.length ? (
      <>
        <Button variant='outline' size='sm' onClick={handleExcelExport} className='gap-1'>
          <Download size={14}/> Excel
        </Button>
        <Button variant='outline' size='sm' onClick={handlePdfExport} className='gap-1'>
          <FileText size={14}/> PDF
        </Button>
      </>
    ) : null}
    <Button variant='outline' size='sm' onClick={() => setShowCats(true)} className='gap-2'>
      <Settings size={14} /> Asset Category Master
    </Button>
  </div>
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
      <p className='text-xs text-muted-foreground mt-1'>Companies only (Private Ltd, Public Ltd, OPC)</p>
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
    {clientId && assets && assets.length > 0 && !isLocked && (
      <Button variant='outline' onClick={handleFinalize} disabled={finalizing} className='gap-2'>
        {finalizing ? <Loader2 size={16} className='animate-spin' /> : <Lock size={16} />}
        {finalizing ? 'Finalizing...' : 'Save & Finalize FY'}
      </Button>
    )}
    {isLocked && (
      <>
        <Badge variant='outline' className='gap-1 border-amber-400 text-amber-600'><Lock size={14} /> FY Finalized &amp; Locked</Badge>
        <Button
          variant='outline' size='sm'
          className='gap-1 border-amber-400 text-amber-700 hover:bg-amber-50'
          onClick={handleUnlock} disabled={unlocking}
        >
          {unlocking ? <Loader2 size={14} className='animate-spin'/> : <LockOpen size={14}/>}
          {unlocking ? 'Unlocking...' : 'Unlock FY for Editing'}
        </Button>
      </>
    )}
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
    <TabsTrigger value='additions'>Additions Log{additionsLog?.length ? <Badge variant='secondary' className='ml-1 text-[10px]'>{additionsLog.length}</Badge> : null}</TabsTrigger>
    <TabsTrigger value='disposals'>Disposal Log</TabsTrigger>
  </TabsList>

  {/* ═══ ASSET REGISTER TAB ═══ */}
  <TabsContent value='register'>
    <Card>
      <CardHeader className='flex flex-row items-center justify-between pb-2'>
        <div>
          <CardTitle className='text-base'>Asset Register — {fy}</CardTitle>
          <CardDescription className='text-xs'>WDV Opening = Gross Block Opening minus Accumulated Dep Opening</CardDescription>
        </div>
        <div className='flex items-center gap-2'>
          <div className='flex border rounded-md overflow-hidden'>
            <Button variant={registerView==='flat'?'default':'ghost'} size='sm' className='rounded-none h-8 text-xs' onClick={()=>setRegisterView('flat')}>All Assets</Button>
            <Button variant={registerView==='category'?'default':'ghost'} size='sm' className='rounded-none h-8 text-xs' onClick={()=>setRegisterView('category')}>Category View</Button>
          </div>
          {!isLocked && <Button size='sm' onClick={() => setShowAdd(true)} className='gap-1'><Plus size={14} />Add Asset</Button>}
          {!isLocked && <Button size='sm' variant='outline' onClick={() => setShowBulkAdd(true)} className='gap-1'><Plus size={14} />Bulk Add</Button>}
        </div>
      </CardHeader>
      <CardContent className='p-0'><div className='overflow-auto'>

        {/* ── FLAT VIEW ── */}
        {registerView === 'flat' && (
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
            <TableHead className='text-right'>Residual Val</TableHead>
            <TableHead className='text-right font-semibold'>WDV Opening</TableHead>
            <TableHead className='text-right text-amber-600 dark:text-amber-400'>Residual Val.</TableHead>
            <TableHead className='text-right w-16'>Rate / Life</TableHead>
            <TableHead className='text-right font-semibold'><div>Dep for Year</div><div className='text-[9px] font-normal text-muted-foreground italic'>hover for formula</div></TableHead>
            <TableHead className='text-right font-bold'>WDV Closing</TableHead>
            <TableHead className='w-24'></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {loadingAssets ? (
              <TableRow><TableCell colSpan={16} className='text-center py-8'><Loader2 className='mx-auto animate-spin' /></TableCell></TableRow>
            ) : !assets?.length ? (
              <TableRow><TableCell colSpan={16} className='text-center py-8 text-muted-foreground'>No assets for {fy}. Click Add Asset.</TableCell></TableRow>
            ) : assets.map((a:any, i:number) => {
              const gb   = parseFloat(a.gross_block_opening)||0;
              const ad   = parseFloat(a.accumulated_dep_opening)||0;
              const add  = parseFloat(a.additions_during_year)||0;
              const dis  = parseFloat(a.disposals_during_year)||0;
              const wdvO = gb - ad;
              const dep  = a.depreciation_for_year != null ? parseFloat(a.depreciation_for_year) : null;
              const wdvC = a.wdv_closing != null ? parseFloat(a.wdv_closing) : null;
              const method = a.fa_categories?.depreciation_method || 'WDV';
              const resVal = a.residual_value != null ? parseFloat(a.residual_value) : null;
              const rateDisplay = method === 'SLM'
                ? (a.fa_categories?.useful_life_years ? `${a.fa_categories.useful_life_years} yrs` : '—')
                : (a.fa_categories?.wdv_rate          ? `${a.fa_categories.wdv_rate}%`             : '—');
              const formulaText: string =
                (a as any).dep_formula_json?.formula_text ||
                (method === 'SLM' && a.fa_categories?.useful_life_years
                  ? `(Cost ₹${fmt(parseFloat(a.gross_block_opening)||0)} − Residual ₹${fmt(resVal||0)}) ÷ ${a.fa_categories.useful_life_years} yrs`
                  : 'Run Calculate Depreciation to see formula');
              const isAtResidual = resVal != null && wdvC != null && Math.abs(wdvC - resVal) < 1;
              const residualPct = parseFloat(a.fa_categories?.residual_value_pct) || 5;
              const resValDisplay = resVal ?? Math.round(gb * residualPct / 100 * 100)/100;
              const warn   = wdvO < 0 || ad > gb;
              return (
                <TableRow key={a.id} className={cn(a.is_fully_depreciated&&'bg-muted/20', warn&&'bg-red-50 dark:bg-red-950/20')}>
                  <TableCell className='text-xs text-muted-foreground'>{i+1}</TableCell>
                  <TableCell className='font-mono text-xs'>
                    {a.asset_code}
                    {a.is_carried_forward && <Badge variant='outline' className='ml-1 text-[8px] px-1'>CF</Badge>}
                  </TableCell>
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
                  <TableCell className='text-right tabular-nums text-sm text-muted-foreground'>{fmt(resValDisplay)}</TableCell>
                  <TableCell className='text-right tabular-nums text-sm font-semibold'>{fmt(wdvO)}</TableCell>
                  <TableCell className='text-right tabular-nums text-sm text-amber-600 dark:text-amber-400'>{resVal != null ? fmt(resVal) : '—'}</TableCell>
                  <TableCell className='text-right tabular-nums text-xs'>{rateDisplay}</TableCell>
                  <TableCell className='text-right tabular-nums text-sm font-semibold'>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className='cursor-help inline-flex items-center gap-1'>
                            {dep != null ? fmt(dep) : <span className='text-muted-foreground text-xs italic'>pending</span>}
                            {(a as any).dep_formula_json?.is_balancing_year && (
                              <Badge variant='outline' className='text-[8px] px-1 py-0 border-orange-400 text-orange-600 bg-orange-50 dark:bg-orange-950/30'>BAL</Badge>
                            )}
                            {(a as any).dep_formula_json?.is_pro_rata && !(a as any).dep_formula_json?.is_balancing_year && (
                              <Badge variant='outline' className='text-[8px] px-1 py-0 border-blue-400 text-blue-600 bg-blue-50 dark:bg-blue-950/30'>PRO</Badge>
                            )}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side='top' className='max-w-sm p-3'>
                          <p className='font-semibold text-xs'>{method === 'SLM' ? 'SLM — Useful Life Method' : 'WDV — Written Down Value'}</p>
                          <p className='text-xs mt-1'>{formulaText}</p>
                          {(a as any).dep_formula_json?.dep_amount != null && (
                            <p className='text-xs mt-1 font-semibold'>Depreciation: ₹{fmt((a as any).dep_formula_json.dep_amount)}</p>
                          )}
                          {(a as any).dep_formula_json?.residual != null && (
                            <p className='text-xs mt-0.5 text-muted-foreground'>Residual Value: ₹{fmt((a as any).dep_formula_json.residual)}</p>
                          )}
                          {(a as any).dep_formula_json?.wdv_open != null && (
                            <p className='text-xs mt-0.5 text-muted-foreground'>Opening WDV: ₹{fmt((a as any).dep_formula_json.wdv_open)}</p>
                          )}
                          {(a as any).dep_formula_json?.dep_days && (a as any).dep_formula_json.dep_days < 365 && (
                            <p className='text-xs mt-1 text-muted-foreground'>Pro-rata: {(a as any).dep_formula_json.dep_days} days used in this FY</p>
                          )}
                          {(a as any).dep_formula_json?.is_balancing_year && (
                            <p className='text-xs mt-1 text-orange-600'>Final year — dep restricted to (Opening WDV − Residual Value)</p>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableCell>
                  <TableCell className={cn('text-right tabular-nums text-sm font-bold',wdvC!=null&&wdvC<0?'text-destructive':'')}>
                    {wdvC != null ? (
                      <span className='inline-flex items-center gap-1'>
                        {fmt(wdvC)}
                        {isAtResidual && (
                          <Badge variant='outline' className='text-[8px] px-1 py-0 border-green-400 text-green-600 bg-green-50 dark:bg-green-950/30'>RES</Badge>
                        )}
                      </span>
                    ) : '—'}
                  </TableCell>
                  <TableCell>
                    {!a.is_locked&&(<div className='flex gap-1'>
                      <Button variant='ghost' size='icon' className='h-7 w-7' title='Edit' onClick={()=>setEditAsset({
                        ...a,
                        gross_block_opening:     String(a.gross_block_opening || '0'),
                        accumulated_dep_opening: String(a.accumulated_dep_opening || '0'),
                        additions_during_year:   String(a.additions_during_year || '0'),
                        disposals_during_year:   String(a.disposals_during_year || '0'),
                        residual_value:          a.residual_value ? String(a.residual_value) : '',
                      })}><Pencil size={13}/></Button>
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
                <TableCell/>
                <TableCell className='text-right tabular-nums'>{fmt(totals.wdvOpen)}</TableCell>
                <TableCell className='text-right tabular-nums'>{fmt(assets.reduce((s: number, a: any) => s + (parseFloat(a.residual_value) || 0), 0))}</TableCell>
                <TableCell/>
                <TableCell className='text-right tabular-nums'>{fmt(totals.dep)}</TableCell>
                <TableCell className='text-right tabular-nums'>{fmt(totals.wdvClose)}</TableCell>
                <TableCell/>
              </TableRow>
            )}
          </TableBody>
        </Table>
        )}

        {/* ── CATEGORY VIEW ── */}
        {registerView === 'category' && (() => {
          const grouped: Record<string, any[]> = {};
          (assets||[]).forEach((a:any) => {
            const cat = a.fa_categories?.name || 'Uncategorized';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(a);
          });
          const grandTotals = (assets||[]).reduce((acc:any, a:any) => ({
            gb:   acc.gb   + (parseFloat(a.gross_block_opening)||0),
            add:  acc.add  + (parseFloat(a.additions_during_year)||0),
            disp: acc.disp + (parseFloat(a.disposals_during_year)||0),
            acDep:acc.acDep+ (parseFloat(a.accumulated_dep_opening)||0),
            wdvO: acc.wdvO + ((parseFloat(a.gross_block_opening)||0)-(parseFloat(a.accumulated_dep_opening)||0)),
            dep:  acc.dep  + (parseFloat(a.depreciation_for_year)||0),
            wdvC: acc.wdvC + (parseFloat(a.wdv_closing)||0),
          }), {gb:0,add:0,disp:0,acDep:0,wdvO:0,dep:0,wdvC:0});

          return (
          <Table>
            <TableHeader><TableRow className='bg-muted/50 text-xs'>
              <TableHead className='w-8'>#</TableHead>
              <TableHead className='w-24'>Code</TableHead>
              <TableHead className='min-w-[140px]'>Name</TableHead>
              <TableHead className='w-24'>Purch Date</TableHead>
              <TableHead className='text-right'>Gross Block</TableHead>
              <TableHead className='text-right'>Additions</TableHead>
              <TableHead className='text-right'>Acc Dep Open</TableHead>
              <TableHead className='text-right'>Residual Val</TableHead>
              <TableHead className='text-right'>WDV Opening</TableHead>
              <TableHead className='text-right'>Depreciation</TableHead>
              <TableHead className='text-right'>WDV Closing</TableHead>
              <TableHead className='w-20'></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {Object.entries(grouped).map(([catName, catAssets]) => {
                const sub = catAssets.reduce((acc:any, a:any) => ({
                  gb:   acc.gb   + (parseFloat(a.gross_block_opening)||0),
                  add:  acc.add  + (parseFloat(a.additions_during_year)||0),
                  acDep:acc.acDep+ (parseFloat(a.accumulated_dep_opening)||0),
                  wdvO: acc.wdvO + ((parseFloat(a.gross_block_opening)||0)-(parseFloat(a.accumulated_dep_opening)||0)),
                  dep:  acc.dep  + (parseFloat(a.depreciation_for_year)||0),
                  wdvC: acc.wdvC + (parseFloat(a.wdv_closing)||0),
                }), {gb:0,add:0,acDep:0,wdvO:0,dep:0,wdvC:0});
                return (
                  <Fragment key={catName}>
                    <TableRow className='bg-primary/5 border-t-2 border-border'>
                      <TableCell colSpan={12} className='font-semibold text-sm py-2'>
                        {catName} — {catAssets.length} asset(s)
                      </TableCell>
                    </TableRow>
                    {catAssets.map((a:any, i:number) => {
                      const gb  = parseFloat(a.gross_block_opening)||0;
                      const ad  = parseFloat(a.accumulated_dep_opening)||0;
                      const wdvO = gb - ad;
                      const dep  = a.depreciation_for_year != null ? parseFloat(a.depreciation_for_year) : null;
                      const wdvC = a.wdv_closing != null ? parseFloat(a.wdv_closing) : null;
                      const residualPct = parseFloat(a.fa_categories?.residual_value_pct) || 5;
                      const resVal = a.residual_value ?? Math.round(gb * residualPct / 100 * 100)/100;
                      return (
                        <TableRow key={a.id}>
                          <TableCell className='text-xs text-muted-foreground'>{i+1}</TableCell>
                          <TableCell className='font-mono text-xs'>{a.asset_code}</TableCell>
                          <TableCell className='text-sm'>{a.asset_name}</TableCell>
                          <TableCell className='text-xs'>{a.date_of_purchase}</TableCell>
                          <TableCell className='text-right tabular-nums text-sm'>{fmt(gb)}</TableCell>
                          <TableCell className='text-right tabular-nums text-sm'>{fmt(parseFloat(a.additions_during_year)||0)}</TableCell>
                          <TableCell className='text-right tabular-nums text-sm'>{fmt(ad)}</TableCell>
                          <TableCell className='text-right tabular-nums text-sm text-muted-foreground'>{fmt(resVal)}</TableCell>
                          <TableCell className='text-right tabular-nums text-sm'>{fmt(wdvO)}</TableCell>
                          <TableCell className='text-right tabular-nums text-sm'>
                            {dep!=null?fmt(dep):<span className='text-muted-foreground text-xs italic'>pending</span>}
                          </TableCell>
                          <TableCell className='text-right tabular-nums text-sm'>{wdvC!=null?fmt(wdvC):'—'}</TableCell>
                          <TableCell>
                            {!a.is_locked&&(<div className='flex gap-1'>
                              <Button variant='ghost' size='icon' className='h-7 w-7' title='Edit' onClick={()=>setEditAsset({
                                ...a,
                                gross_block_opening: String(a.gross_block_opening||'0'),
                                accumulated_dep_opening: String(a.accumulated_dep_opening||'0'),
                                additions_during_year: String(a.additions_during_year||'0'),
                                disposals_during_year: String(a.disposals_during_year||'0'),
                                residual_value: a.residual_value ? String(a.residual_value) : '',
                              })}><Pencil size={13}/></Button>
                              <Button variant='ghost' size='icon' className='h-7 w-7 text-destructive' title='Delete' onClick={()=>deleteAsset(a.id)}><Trash2 size={13}/></Button>
                            </div>)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className='bg-muted/40 font-semibold text-xs border-b-2'>
                      <TableCell colSpan={4}>Subtotal — {catName}</TableCell>
                      <TableCell className='text-right tabular-nums'>{fmt(sub.gb)}</TableCell>
                      <TableCell className='text-right tabular-nums'>{fmt(sub.add)}</TableCell>
                      <TableCell className='text-right tabular-nums'>{fmt(sub.acDep)}</TableCell>
                      <TableCell/>
                      <TableCell className='text-right tabular-nums'>{fmt(sub.wdvO)}</TableCell>
                      <TableCell className='text-right tabular-nums'>{fmt(sub.dep)}</TableCell>
                      <TableCell className='text-right tabular-nums'>{fmt(sub.wdvC)}</TableCell>
                      <TableCell/>
                    </TableRow>
                  </Fragment>
                );
              })}
              <TableRow className='bg-muted font-bold border-t-2 border-border text-sm'>
                <TableCell colSpan={4}>GRAND TOTAL — {assets?.length} Assets</TableCell>
                <TableCell className='text-right tabular-nums'>{fmt(grandTotals.gb)}</TableCell>
                <TableCell className='text-right tabular-nums'>{fmt(grandTotals.add)}</TableCell>
                <TableCell className='text-right tabular-nums'>{fmt(grandTotals.acDep)}</TableCell>
                <TableCell/>
                <TableCell className='text-right tabular-nums'>{fmt(grandTotals.wdvO)}</TableCell>
                <TableCell className='text-right tabular-nums'>{fmt(grandTotals.dep)}</TableCell>
                <TableCell className='text-right tabular-nums'>{fmt(grandTotals.wdvC)}</TableCell>
                <TableCell/>
              </TableRow>
            </TableBody>
          </Table>
          );
        })()}

      </div></CardContent>
    </Card>
  </TabsContent>

  {/* ═══ DEPRECIATION SCHEDULE TAB ═══ */}
  <TabsContent value='schedule'>
    <Card>
      <CardHeader className='flex flex-row items-center justify-between pb-2'>
        <div>
          <CardTitle className='text-base'>Depreciation Schedule — {fy}</CardTitle>
          <CardDescription className='text-xs'>Dep on Opening Block + Dep on Additions shown separately</CardDescription>
        </div>
        <div className='flex border rounded-md overflow-hidden'>
          <Button variant={scheduleView==='asset'?'default':'ghost'} size='sm' className='rounded-none h-8 text-xs' onClick={()=>setScheduleView('asset')}>Asset-wise</Button>
          <Button variant={scheduleView==='category'?'default':'ghost'} size='sm' className='rounded-none h-8 text-xs' onClick={()=>setScheduleView('category')}>Category-wise</Button>
        </div>
      </CardHeader>
      <CardContent className='p-0'>

        {/* Asset-wise schedule view */}
        {scheduleView === 'asset' && (
        <Table>
          <TableHeader><TableRow className='bg-muted/50 text-xs'>
            <TableHead>Code</TableHead><TableHead>Asset Name</TableHead><TableHead>Category</TableHead>
            <TableHead className='text-center'>Method</TableHead>
            <TableHead className='text-right'>Rate / Basis</TableHead>
            <TableHead className='text-right'>WDV Opening</TableHead>
            <TableHead className='text-right'>Residual</TableHead>
            <TableHead className='text-right'>Dep on Opening</TableHead>
            <TableHead className='text-right'>Additions</TableHead>
            <TableHead className='text-right'>Dep on Additions</TableHead>
            <TableHead className='text-right font-semibold'>Total Dep</TableHead>
            <TableHead className='text-right font-bold'>WDV Closing</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {!schedule?.length ? (
              <TableRow><TableCell colSpan={12} className='text-center py-8 text-muted-foreground'>Run Calculate Depreciation first</TableCell></TableRow>
            ) : schedule.map((s:any) => {
              const ast = s.fa_assets;
              const method = ast?.depreciation_method_used || ast?.fa_categories?.depreciation_method||'WDV';
              const cat = ast?.fa_categories;
              const addAst = assets?.find((a:any) => a.id===s.asset_id);
              const residual = addAst?.residual_value ?? Math.round((parseFloat(s.wdv_opening)+(parseFloat(ast?.accumulated_dep_opening)||0)) * (parseFloat(cat?.residual_value_pct)||5) / 100 * 100)/100;
              const rateBasis = method === 'SLM'
                ? `(Cost-Res)/${cat?.useful_life_years}yr`
                : `${parseFloat(s.depreciation_rate).toFixed(2)}% WDV`;
              const wdvC = parseFloat(s.wdv_closing);
              const isFullyDep = wdvC <= (typeof residual === 'number' ? residual : 0);
              return (
                <TableRow key={s.id}>
                  <TableCell className='font-mono text-xs'>{ast?.asset_code}</TableCell>
                  <TableCell className='text-sm font-medium'>
                    {ast?.asset_name}
                    {isFullyDep && <Badge variant='outline' className='ml-1 text-[9px]'>Fully Dep.</Badge>}
                  </TableCell>
                  <TableCell className='text-xs'>{cat?.name}</TableCell>
                  <TableCell className='text-center'><MethodBadge method={method}/></TableCell>
                  <TableCell className='text-right text-xs text-muted-foreground'>{rateBasis}</TableCell>
                  <TableCell className='text-right tabular-nums text-sm'>{fmt(parseFloat(s.wdv_opening))}</TableCell>
                  <TableCell className='text-right tabular-nums text-xs text-muted-foreground'>{fmt(residual)}</TableCell>
                  <TableCell className='text-right tabular-nums text-sm'>{fmt(parseFloat(ast?.dep_on_opening_block??s.depreciation_amount))}</TableCell>
                  <TableCell className='text-right tabular-nums text-sm text-muted-foreground'>{addAst&&parseFloat(addAst.additions_during_year)>0?fmt(parseFloat(addAst.additions_during_year)):'—'}</TableCell>
                  <TableCell className='text-right tabular-nums text-sm'>{fmt(parseFloat(ast?.dep_on_additions??0))}</TableCell>
                  <TableCell className='text-right tabular-nums text-sm font-semibold'>{fmt(parseFloat(s.depreciation_amount))}</TableCell>
                  <TableCell className='text-right tabular-nums text-sm font-bold'>{fmt(wdvC)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        )}

        {/* Category-wise schedule view */}
        {scheduleView === 'category' && (() => {
          const grouped: Record<string, any[]> = {};
          (schedule||[]).forEach((s:any) => {
            const catName = s.fa_assets?.fa_categories?.name || 'Uncategorized';
            if (!grouped[catName]) grouped[catName] = [];
            grouped[catName].push(s);
          });
          return (
          <Table>
            <TableHeader><TableRow className='bg-muted/50 text-xs'>
              <TableHead>Code</TableHead><TableHead>Asset Name</TableHead>
              <TableHead className='text-center'>Method</TableHead>
              <TableHead className='text-right'>Rate / Basis</TableHead>
              <TableHead className='text-right'>WDV Opening</TableHead>
              <TableHead className='text-right'>Total Dep</TableHead>
              <TableHead className='text-right font-bold'>WDV Closing</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {!schedule?.length ? (
                <TableRow><TableCell colSpan={7} className='text-center py-8 text-muted-foreground'>Run Calculate Depreciation first</TableCell></TableRow>
              ) : Object.entries(grouped).map(([catName, catScheds]) => {
                const sub = catScheds.reduce((acc:any, s:any) => ({
                  wdvO: acc.wdvO + (parseFloat(s.wdv_opening)||0),
                  dep:  acc.dep  + (parseFloat(s.depreciation_amount)||0),
                  wdvC: acc.wdvC + (parseFloat(s.wdv_closing)||0),
                }), {wdvO:0,dep:0,wdvC:0});
                return (
                  <Fragment key={catName}>
                    <TableRow className='bg-primary/5 border-t-2 border-border'>
                      <TableCell colSpan={7} className='font-semibold text-sm py-2'>{catName} — {catScheds.length} asset(s)</TableCell>
                    </TableRow>
                    {catScheds.map((s:any) => {
                      const ast = s.fa_assets;
                      const method = ast?.depreciation_method_used || ast?.fa_categories?.depreciation_method||'WDV';
                      const cat = ast?.fa_categories;
                      const rateBasis = method === 'SLM'
                        ? `(Cost-Res)/${cat?.useful_life_years}yr`
                        : `${parseFloat(s.depreciation_rate).toFixed(2)}% WDV`;
                      return (
                        <TableRow key={s.id}>
                          <TableCell className='font-mono text-xs'>{ast?.asset_code}</TableCell>
                          <TableCell className='text-sm'>{ast?.asset_name}</TableCell>
                          <TableCell className='text-center'><MethodBadge method={method}/></TableCell>
                          <TableCell className='text-right text-xs text-muted-foreground'>{rateBasis}</TableCell>
                          <TableCell className='text-right tabular-nums text-sm'>{fmt(parseFloat(s.wdv_opening))}</TableCell>
                          <TableCell className='text-right tabular-nums text-sm font-semibold'>{fmt(parseFloat(s.depreciation_amount))}</TableCell>
                          <TableCell className='text-right tabular-nums text-sm font-bold'>{fmt(parseFloat(s.wdv_closing))}</TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className='bg-muted/40 font-semibold text-xs border-b-2'>
                      <TableCell colSpan={4}>Subtotal — {catName}</TableCell>
                      <TableCell className='text-right tabular-nums'>{fmt(sub.wdvO)}</TableCell>
                      <TableCell className='text-right tabular-nums'>{fmt(sub.dep)}</TableCell>
                      <TableCell className='text-right tabular-nums'>{fmt(sub.wdvC)}</TableCell>
                    </TableRow>
                  </Fragment>
                );
              })}
              {schedule?.length > 0 && (() => {
                const gt = schedule.reduce((acc:any, s:any) => ({
                  wdvO: acc.wdvO + (parseFloat(s.wdv_opening)||0),
                  dep:  acc.dep  + (parseFloat(s.depreciation_amount)||0),
                  wdvC: acc.wdvC + (parseFloat(s.wdv_closing)||0),
                }), {wdvO:0,dep:0,wdvC:0});
                return (
                  <TableRow className='bg-muted font-bold border-t-2 border-border text-sm'>
                    <TableCell colSpan={4}>GRAND TOTAL</TableCell>
                    <TableCell className='text-right tabular-nums'>{fmt(gt.wdvO)}</TableCell>
                    <TableCell className='text-right tabular-nums'>{fmt(gt.dep)}</TableCell>
                    <TableCell className='text-right tabular-nums'>{fmt(gt.wdvC)}</TableCell>
                  </TableRow>
                );
              })()}
            </TableBody>
          </Table>
          );
        })()}

      </CardContent>
    </Card>
  </TabsContent>

  {/* ═══ BLOCK-WISE SUMMARY TAB ═══ */}
  <TabsContent value='summary'>
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>Block-wise Summary — {fy}</CardTitle>
        <CardDescription className='text-xs'>Category-wise | Schedule II format | Click + to expand assets</CardDescription>
      </CardHeader>
      <CardContent className='p-0'>
        <Table>
          <TableHeader><TableRow className='bg-muted/50 text-xs'>
            <TableHead className='w-10'></TableHead>
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
              <TableRow><TableCell colSpan={13} className='text-center py-8 text-muted-foreground'>No data</TableCell></TableRow>
            ) : summary.map((s:any,i:number) => {
              const catKey = s.category_name;
              const isOpen = expandedCategories.has(catKey);
              const catAssets = (assets||[]).filter((a:any) =>
                a.fa_categories?.name === s.category_name);
              return (
                <Fragment key={i}>
                  <TableRow className={cn(i%2===0?'bg-muted/20':'', 'font-medium')}>
                    <TableCell className='text-center'>
                      <Button variant='ghost' size='icon' className='h-6 w-6 text-xs' onClick={() => setExpandedCategories(prev => {
                        const next = new Set(prev);
                        next.has(catKey) ? next.delete(catKey) : next.add(catKey);
                        return next;
                      })}>
                        {isOpen ? '\u2212' : '+'}
                      </Button>
                    </TableCell>
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
                  {isOpen && catAssets.map((a:any) => {
                    const gb  = parseFloat(a.gross_block_opening)||0;
                    const ad  = parseFloat(a.accumulated_dep_opening)||0;
                    const addV = parseFloat(a.additions_during_year)||0;
                    const disV = parseFloat(a.disposals_during_year)||0;
                    const dep = parseFloat(a.depreciation_for_year)||0;
                    const wdvC = a.wdv_closing != null ? parseFloat(a.wdv_closing) : gb-ad-dep;
                    return (
                      <TableRow key={a.id} className='bg-muted/10 text-xs'>
                        <TableCell/>
                        <TableCell className='pl-8 text-muted-foreground'>{a.asset_name}</TableCell>
                        <TableCell className='text-center text-muted-foreground'>{a.date_of_purchase||'—'}</TableCell>
                        <TableCell/>
                        <TableCell/>
                        <TableCell className='text-right tabular-nums'>{fmt(gb)}</TableCell>
                        <TableCell className='text-right tabular-nums'>{fmt(addV)}</TableCell>
                        <TableCell className='text-right tabular-nums'>{fmt(disV)}</TableCell>
                        <TableCell className='text-right tabular-nums'>{fmt(gb+addV-disV)}</TableCell>
                        <TableCell className='text-right tabular-nums'>{fmt(ad)}</TableCell>
                        <TableCell className='text-right tabular-nums'>{fmt(dep)}</TableCell>
                        <TableCell className='text-right tabular-nums'>{fmt(ad+dep)}</TableCell>
                        <TableCell className='text-right tabular-nums'>{fmt(wdvC)}</TableCell>
                      </TableRow>
                    );
                  })}
                </Fragment>
              );
            })}
            {summary&&summary.length>0&&(()=>{
              const tot=(f:string)=>summary.reduce((s:number,r:any)=>s+(parseFloat(r[f])||0),0);
              return (
                <TableRow className='bg-muted font-bold border-t-2 border-border'>
                  <TableCell/>
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

  {/* ═══ ADDITIONS LOG TAB ═══ */}
  <TabsContent value='additions'>
    <Card>
      <CardHeader><CardTitle className='text-base'>Additions Log — {fy}</CardTitle></CardHeader>
      <CardContent className='p-0'>
        <Table>
          <TableHeader><TableRow className='text-xs bg-muted/50'>
            <TableHead>Asset</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Addition Date</TableHead>
            <TableHead className='text-right'>Amount (₹)</TableHead>
            <TableHead>Invoice No</TableHead>
            <TableHead>Supplier</TableHead>
            <TableHead>Narration</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {!additionsLog?.length ? (
              <TableRow><TableCell colSpan={7} className='text-center py-8 text-muted-foreground'>No additions recorded for {fy}</TableCell></TableRow>
            ) : additionsLog.map((a: any) => (
              <TableRow key={a.id}>
                <TableCell className='font-medium text-sm'>{a.fa_assets?.asset_name}</TableCell>
                <TableCell className='text-xs'>{a.fa_assets?.fa_categories?.name}</TableCell>
                <TableCell className='text-sm'>{a.addition_date}</TableCell>
                <TableCell className='text-right tabular-nums text-sm font-semibold'>{fmt(parseFloat(a.addition_amount))}</TableCell>
                <TableCell className='text-xs'>{a.invoice_no || '—'}</TableCell>
                <TableCell className='text-xs'>{a.supplier || '—'}</TableCell>
                <TableCell className='text-xs text-muted-foreground'>{a.entry_narration || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </TabsContent>

  {/* ═══ DISPOSAL LOG TAB ═══ */}
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

{/* ═══ CARRY FORWARD DIALOG ═══ */}
<Dialog open={showCarryForward} onOpenChange={setShowCarryForward}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>FY {fy} Finalized — Carry Forward to Next FY?</DialogTitle>
      <DialogDescription>
        This will create opening balance rows for FY{' '}
        {(() => { const [y] = fy.split('-'); const n=parseInt(y)+1;
                  return `${n}-${String(n+1).slice(-2)}`; })()}
        {' '}using the closing WDV of each active asset as the new opening balance.
        Disposed assets are excluded.
      </DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <Button variant='outline' onClick={() => setShowCarryForward(false)}>
        Skip — I will do this later
      </Button>
      <Button onClick={handleCarryForward} disabled={carryingForward} className='gap-2'>
        {carryingForward && <Loader2 size={14} className='animate-spin'/>}
        Yes, Carry Forward
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>

{/* ═══ CATEGORY MASTER DIALOG ═══ */}
<Dialog open={showCats} onOpenChange={setShowCats}>
  <DialogContent className='max-w-5xl max-h-[80vh] overflow-y-auto'>
    <DialogHeader>
      <DialogTitle>Asset Category Master — Schedule II Companies Act 2013</DialogTitle>
      <DialogDescription>
        Global categories are Schedule II defaults (read-only). Firm-specific categories can be deleted if unused.
      </DialogDescription>
    </DialogHeader>
    <Alert className='mb-2'>
      <Info size={14} className='mr-2'/>
      <AlertDescription className='text-xs'>
        To change a rate, create a new category. Existing categories cannot be edited to protect historical calculations.
      </AlertDescription>
    </Alert>
    <Table>
      <TableHeader><TableRow className='text-xs bg-muted'>
        <TableHead>Name</TableHead><TableHead>Asset Class</TableHead><TableHead>Part</TableHead>
        <TableHead className='text-right'>Life</TableHead><TableHead className='text-right'>WDV%</TableHead>
        <TableHead className='text-right'>SLM%</TableHead><TableHead className='text-right'>Residual%</TableHead>
        <TableHead>Method</TableHead><TableHead>Scope</TableHead>
        <TableHead className='w-12'></TableHead>
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
            <TableCell><MethodBadge method={c.depreciation_method||'WDV'}/></TableCell>
            <TableCell><Badge variant='outline' className='text-[10px]'>{c.firm_id?'Firm':'Global'}</Badge></TableCell>
            <TableCell>
              {c.firm_id && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant='ghost' size='icon' className='h-7 w-7 text-destructive' onClick={()=>handleDeleteCategory(c.id, c.name)}>
                        <Trash2 size={13}/>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Delete category</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </TableCell>
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
        <div><Label>WDV Rate %</Label><Input type='number' step='0.01' value={nc.wdv_rate} onChange={e=>setNc(p=>({...p,wdv_rate:e.target.value}))}/></div>
        <div><Label>SLM Rate %</Label><Input type='number' step='0.01' value={nc.slm_rate} onChange={e=>setNc(p=>({...p,slm_rate:e.target.value}))}/></div>
        <div><Label>Residual %</Label><Input type='number' value={nc.residual_value_pct} onChange={e=>setNc(p=>({...p,residual_value_pct:e.target.value}))}/></div>
      </div>
    </div>
    <DialogFooter>
      <Button variant='outline' onClick={()=>setShowAddCat(false)}>Cancel</Button>
      <Button onClick={()=>addCatMut.mutate()} disabled={!nc.name||!nc.useful_life_years||addCatMut.isPending}>Add Category</Button>
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
      <div>
        <Label>Residual Value (₹)</Label>
        <Input type='number' min='0' value={na.residual_value} onChange={e=>setNa(p=>({...p,residual_value:e.target.value}))} placeholder='Default from category %' />
        {na.residual_value && parseFloat(na.residual_value) >= parseFloat(na.gross_block_opening||'0') && parseFloat(na.gross_block_opening||'0') > 0 && (
          <p className='text-xs text-destructive mt-1'>Residual Value must be less than Cost of Asset</p>
        )}
        <p className='text-xs text-muted-foreground mt-0.5'>Leave blank to auto-calculate from category default %</p>
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

{/* ═══ EDIT ASSET DIALOG ═══ */}
<Dialog open={!!editAsset} onOpenChange={() => setEditAsset(null)}>
  <DialogContent className='max-w-xl'>
    <DialogHeader>
      <DialogTitle>Edit Asset — {editAsset?.asset_name}</DialogTitle>
      <DialogDescription>
        <Alert className='mt-2 border-amber-300 bg-amber-50 dark:bg-amber-950/30'>
          <AlertTriangle size={14} className='mr-2 text-amber-600'/>
          <AlertDescription className='text-xs text-amber-700 dark:text-amber-300'>
            Depreciation will be cleared and must be recalculated after saving.
          </AlertDescription>
        </Alert>
      </DialogDescription>
    </DialogHeader>
    {editAsset && (
      <div className='grid gap-3'>
        <div><Label>Asset Name *</Label><Input value={editAsset.asset_name} onChange={e=>setEditAsset((p:any)=>({...p,asset_name:e.target.value}))}/></div>
        <div>
          <Label>Category *</Label>
          <Select value={editAsset.category_id} onValueChange={v=>setEditAsset((p:any)=>({...p,category_id:v}))}>
            <SelectTrigger><SelectValue placeholder='Select category'/></SelectTrigger>
            <SelectContent>
              {(cats||[]).map((c:any)=>(
                <SelectItem key={c.id} value={c.id}>{c.name} — {c.depreciation_method||'WDV'} ({c.useful_life_years}yr)</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='grid grid-cols-2 gap-3'>
          <div><Label>Date of Purchase *</Label><Input type='date' value={editAsset.date_of_purchase} onChange={e=>setEditAsset((p:any)=>({...p,date_of_purchase:e.target.value}))}/></div>
          <div><Label>Location</Label><Input value={editAsset.location||''} onChange={e=>setEditAsset((p:any)=>({...p,location:e.target.value}))}/></div>
        </div>
        <Separator/>
        <p className='text-xs font-semibold text-muted-foreground uppercase tracking-wider'>Opening Balances</p>
        <div className='grid grid-cols-2 gap-3'>
          <div><Label>Gross Block Opening (₹)</Label><Input type='number' value={editAsset.gross_block_opening} onChange={e=>setEditAsset((p:any)=>({...p,gross_block_opening:e.target.value}))}/></div>
          <div><Label>Acc Dep Opening (₹)</Label><Input type='number' value={editAsset.accumulated_dep_opening} onChange={e=>setEditAsset((p:any)=>({...p,accumulated_dep_opening:e.target.value}))}/></div>
        </div>
        <p className='text-xs font-semibold text-muted-foreground uppercase tracking-wider'>Movements</p>
        <div className='grid grid-cols-2 gap-3'>
          <div><Label>Additions (₹)</Label><Input type='number' value={editAsset.additions_during_year} onChange={e=>setEditAsset((p:any)=>({...p,additions_during_year:e.target.value}))}/></div>
          <div><Label>Addition Date</Label><Input type='date' value={editAsset.addition_date||''} onChange={e=>setEditAsset((p:any)=>({...p,addition_date:e.target.value}))}/></div>
          <div><Label>Disposals (₹)</Label><Input type='number' value={editAsset.disposals_during_year} onChange={e=>setEditAsset((p:any)=>({...p,disposals_during_year:e.target.value}))}/></div>
          <div><Label>Disposal Date</Label><Input type='date' value={editAsset.disposal_date||''} onChange={e=>setEditAsset((p:any)=>({...p,disposal_date:e.target.value}))}/></div>
        </div>
        <div>
          <Label>Residual Value (₹)</Label>
          <Input type='number' min='0' value={editAsset.residual_value} onChange={e=>setEditAsset((p:any)=>({...p,residual_value:e.target.value}))} placeholder='Default from category %' />
          {editAsset.residual_value && parseFloat(editAsset.residual_value) >= parseFloat(editAsset.gross_block_opening||'0') && parseFloat(editAsset.gross_block_opening||'0') > 0 && (
            <p className='text-xs text-destructive mt-1'>Residual Value must be less than Cost of Asset</p>
          )}
        </div>
        <div><Label>Narration</Label><Input value={editAsset.narration||''} onChange={e=>setEditAsset((p:any)=>({...p,narration:e.target.value}))}/></div>
      </div>
    )}
    <DialogFooter>
      <Button variant='outline' onClick={() => setEditAsset(null)}>Cancel</Button>
      <Button onClick={() => editMut.mutate()} disabled={editMut.isPending}>
        {editMut.isPending && <Loader2 size={14} className='mr-1 animate-spin'/>}
        Save Changes
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>

{/* ═══ BULK ADD DIALOG ═══ */}
<Dialog open={showBulkAdd} onOpenChange={setShowBulkAdd}>
  <DialogContent className='max-w-[95vw] max-h-[90vh] overflow-hidden flex flex-col'>
    <DialogHeader>
      <DialogTitle>Bulk Add Assets — {fy}</DialogTitle>
      <DialogDescription>
        Fill in asset details. Rows with Asset Name and Category filled are saved. Empty rows are skipped.
      </DialogDescription>
    </DialogHeader>
    <ScrollArea className='flex-1 max-h-[55vh]'>
      <div className='overflow-auto'>
        <Table>
          <TableHeader><TableRow className='text-xs bg-muted'>
            <TableHead className='w-8'>#</TableHead>
            <TableHead className='min-w-[140px]'>Asset Name *</TableHead>
            <TableHead className='min-w-[160px]'>Category *</TableHead>
            <TableHead className='min-w-[120px]'>Date of Purchase *</TableHead>
            <TableHead className='min-w-[100px]'>Location</TableHead>
            <TableHead className='min-w-[110px]'>Gross Blk Open</TableHead>
            <TableHead className='min-w-[110px]'>Acc Dep Open</TableHead>
            <TableHead className='min-w-[100px]'>Residual (₹)</TableHead>
            <TableHead className='min-w-[100px]'>Additions</TableHead>
            <TableHead className='min-w-[120px]'>Addition Date</TableHead>
            <TableHead className='min-w-[120px]'>Narration</TableHead>
            <TableHead className='w-8'></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {bulkRows.map((row, idx) => (
              <TableRow key={idx}>
                <TableCell className='text-xs text-muted-foreground'>{idx+1}</TableCell>
                <TableCell>
                  <Input className='h-8 text-xs' value={row.asset_name}
                    onChange={e => setBulkRows(rows => rows.map((r,i) =>
                      i===idx ? {...r, asset_name: e.target.value} : r))}
                    placeholder='Asset name' />
                </TableCell>
                <TableCell>
                  <Select value={row.category_id} onValueChange={v => setBulkRows(rows => rows.map((r,i) =>
                      i===idx ? {...r, category_id: v} : r))}>
                    <SelectTrigger className='h-8 text-xs'>
                      <SelectValue placeholder='Category'/>
                    </SelectTrigger>
                    <SelectContent>
                      {(cats||[]).map((c:any) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Input className='h-8 text-xs' type='date' value={row.date_of_purchase}
                    onChange={e => setBulkRows(rows => rows.map((r,i) =>
                      i===idx ? {...r, date_of_purchase: e.target.value} : r))} />
                </TableCell>
                <TableCell>
                  <Input className='h-8 text-xs' value={row.location}
                    onChange={e => setBulkRows(rows => rows.map((r,i) =>
                      i===idx ? {...r, location: e.target.value} : r))}
                    placeholder='Optional' />
                </TableCell>
                <TableCell>
                  <Input className='h-8 text-xs' type='number' value={row.gross_block_opening}
                    onChange={e => setBulkRows(rows => rows.map((r,i) =>
                      i===idx ? {...r, gross_block_opening: e.target.value} : r))} />
                </TableCell>
                <TableCell>
                  <Input className='h-8 text-xs' type='number' value={row.accumulated_dep_opening}
                    onChange={e => setBulkRows(rows => rows.map((r,i) =>
                      i===idx ? {...r, accumulated_dep_opening: e.target.value} : r))} />
                </TableCell>
                <TableCell>
                  <Input className='h-8 text-xs' type='number' value={row.residual_value}
                    onChange={e => setBulkRows(rows => rows.map((r,i) =>
                      i===idx ? {...r, residual_value: e.target.value} : r))}
                    placeholder='Default from cat' />
                </TableCell>
                <TableCell>
                  <Input className='h-8 text-xs' type='number' value={row.additions_during_year}
                    onChange={e => setBulkRows(rows => rows.map((r,i) =>
                      i===idx ? {...r, additions_during_year: e.target.value} : r))} />
                </TableCell>
                <TableCell>
                  <Input className='h-8 text-xs' type='date' value={row.addition_date}
                    onChange={e => setBulkRows(rows => rows.map((r,i) =>
                      i===idx ? {...r, addition_date: e.target.value} : r))} />
                </TableCell>
                <TableCell>
                  <Input className='h-8 text-xs' value={row.narration}
                    onChange={e => setBulkRows(rows => rows.map((r,i) =>
                      i===idx ? {...r, narration: e.target.value} : r))}
                    placeholder='Optional' />
                </TableCell>
                <TableCell>
                  <Button variant='ghost' size='icon' className='h-7 w-7 text-destructive' onClick={() => setBulkRows(rows => rows.filter((_,i)=>i!==idx))}>
                    <X size={13}/>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </ScrollArea>
    <div className='flex items-center justify-between pt-2'>
      <Button variant='ghost' size='sm' onClick={() => setBulkRows(r => [...r, ...Array.from({length:5}, emptyBulkRow)])}>
        + Add 5 More Rows
      </Button>
      <span className='text-xs text-muted-foreground'>
        {bulkRows.filter(r=>r.asset_name.trim()&&r.category_id).length} valid rows to save
      </span>
    </div>
    <DialogFooter>
      <Button variant='outline' onClick={() => setShowBulkAdd(false)}>Cancel</Button>
      <Button onClick={handleBulkSave} disabled={bulkSaving || bulkRows.filter(r=>r.asset_name.trim()&&r.category_id).length===0}>
        {bulkSaving && <Loader2 size={14} className='mr-1 animate-spin'/>}
        Save {bulkRows.filter(r=>r.asset_name.trim()&&r.category_id).length} Assets
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
        WDV: rate on Written Down Value. SLM: (Cost − Residual) ÷ Useful Life.
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
    <DialogContent className='max-w-4xl max-h-[70vh] overflow-y-auto'>
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
          <TableHead>Asset</TableHead>
          <TableHead className='text-center'>Method</TableHead>
          <TableHead className='text-right'>Rate / Basis</TableHead>
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
              <TableCell className='text-center'><MethodBadge method={r.method}/></TableCell>
              <TableCell className='text-right text-xs text-muted-foreground max-w-[160px] truncate'>{r.rate_display || '—'}</TableCell>
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
