/**
 * CashFlowNotesTab — Stage 7 sub-tab
 * ────────────────────────────────────────────────────────────────────────────
 * Captures Cash Flow Statement summary numbers + disclosure notes for a
 * corporate engagement. Tab visibility is gated by Block C
 * (`engagement.cash_flow_applicable === true`); when not applicable, the tab
 * is hidden and the Auditor's Report (Stage 8 / 3CA-3CB) auto-uses the
 * "without cash flow" wording variants for the Opinion section, Point (d),
 * and the Opinion conclusion (see comments in those components).
 *
 * Captured fields (all optional, persisted as one row per engagement):
 *   1. Cash & cash equivalents — opening balance
 *   2. Cash & cash equivalents — closing balance
 *   3. Net cash from operating activities
 *   4. Net cash from investing activities
 *   5. Net cash from financing activities
 *   6. Disclosure notes (free text)
 *
 * Auto-link from Trial Balance (Stage 2):
 *   - Searches `trial_balance_snapshots` for ledgers whose name contains
 *     "cash" or "bank" (case-insensitive), sums their `closing_balance` and
 *     `opening_balance`, offers a one-click "Auto-fill from TB" button.
 *   - User can override any number after auto-fill — values are not locked.
 *
 * Net cash from operating / investing / financing activities are NOT
 * derivable from the TB alone (they require classification of every TB
 * movement) so those stay manual for now.
 *
 * Storage: `stage7_cashflow_data` table (see migration TODO at end).
 *   { engagement_id (PK), opening_balance, closing_balance,
 *     net_operating, net_investing, net_financing,
 *     disclosure_notes, last_updated_at }
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  Droplets, Save, Loader2, Sparkles, Info, AlertTriangle,
} from 'lucide-react';

interface Props {
  engagementId: string;
  engagement: any;
}

interface CashflowRow {
  engagement_id: string;
  opening_balance: number | null;
  closing_balance: number | null;
  net_operating: number | null;
  net_investing: number | null;
  net_financing: number | null;
  disclosure_notes: string | null;
  last_updated_at?: string;
}

const EMPTY_ROW: Omit<CashflowRow, 'engagement_id'> = {
  opening_balance: null,
  closing_balance: null,
  net_operating: null,
  net_investing: null,
  net_financing: null,
  disclosure_notes: '',
};

// Format INR (no decimal pad — keep raw if integer, 2dp otherwise)
const fmtINR = (n: number | null) => {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
};

// Numeric-input helper — empty string maps to null, otherwise parseFloat.
const parseNum = (v: string): number | null => {
  if (v.trim() === '') return null;
  const n = parseFloat(v.replace(/,/g, ''));
  return isNaN(n) ? null : n;
};

export function CashFlowNotesTab({ engagementId, engagement }: Props) {
  const isApplicable = engagement?.cash_flow_applicable !== false;

  const [data, setData] = useState<Omit<CashflowRow, 'engagement_id'>>(EMPTY_ROW);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [autoFilling, setAutoFilling] = useState(false);
  const [tbAvailable, setTbAvailable] = useState<boolean>(false);

  // ── Detect whether a TB exists for this engagement ──
  useEffect(() => {
    supabase
      .from('trial_balance_snapshots')
      .select('id', { count: 'exact', head: true })
      .eq('engagement_id', engagementId)
      .then(({ count }) => setTbAvailable((count || 0) > 0));
  }, [engagementId]);

  // ── Load saved cash-flow data ──
  useEffect(() => { loadData(); }, [engagementId]);

  async function loadData() {
    setLoading(true);
    try {
      const { data: row, error } = await (supabase as any)
        .from('stage7_cashflow_data')
        .select('*')
        .eq('engagement_id', engagementId)
        .maybeSingle();
      if (error && error.code !== 'PGRST116' && error.code !== 'PGRST205') throw error;
      if (row) {
        setData({
          opening_balance:  row.opening_balance  ?? null,
          closing_balance:  row.closing_balance  ?? null,
          net_operating:    row.net_operating    ?? null,
          net_investing:    row.net_investing    ?? null,
          net_financing:    row.net_financing    ?? null,
          disclosure_notes: row.disclosure_notes ?? '',
        });
      }
    } catch (err: any) {
      console.warn('[CashFlowNotesTab] load failed:', err?.message);
    }
    setLoading(false);
  }

  async function saveAll() {
    setSaving(true);
    try {
      const payload: CashflowRow = {
        engagement_id: engagementId,
        ...data,
        last_updated_at: new Date().toISOString(),
      };
      const { error } = await (supabase as any)
        .from('stage7_cashflow_data')
        .upsert(payload, { onConflict: 'engagement_id' });
      if (error) throw error;
      toast.success('Cash Flow notes saved');
    } catch (err: any) {
      toast.error('Save failed: ' + (err?.message || 'unknown error'));
    }
    setSaving(false);
  }

  // ── Auto-fill opening + closing from TB ──
  // Matches ledgers whose name contains "cash" or "bank" (case-insensitive).
  // Sums their opening_balance and closing_balance. Heuristic — auditor
  // should review before saving.
  async function autoFillFromTB() {
    setAutoFilling(true);
    try {
      const { data: rows, error } = await supabase
        .from('trial_balance_snapshots')
        .select('ledger_name, opening_balance, closing_balance')
        .eq('engagement_id', engagementId);
      if (error) throw error;

      let openingSum = 0;
      let closingSum = 0;
      let matched = 0;
      for (const r of (rows || []) as any[]) {
        const name = String(r.ledger_name || '').toLowerCase();
        if (/\b(cash|bank)\b/.test(name)) {
          openingSum += Number(r.opening_balance || 0);
          closingSum += Number(r.closing_balance || 0);
          matched++;
        }
      }

      if (matched === 0) {
        toast.info('No "cash" or "bank" ledgers found in Trial Balance. Enter manually.');
        return;
      }

      setData(prev => ({
        ...prev,
        opening_balance: openingSum,
        closing_balance: closingSum,
      }));
      toast.success(`Auto-filled from ${matched} TB ledger${matched === 1 ? '' : 's'}. Review before saving.`);
    } catch (err: any) {
      toast.error('Auto-fill failed: ' + (err?.message || 'unknown error'));
    }
    setAutoFilling(false);
  }

  // Reconciliation check — does (opening + ops + inv + fin) ≈ closing?
  const recon = (() => {
    const { opening_balance: o, closing_balance: c, net_operating: a, net_investing: b, net_financing: f } = data;
    if ([o, c, a, b, f].some(v => v == null)) return null;
    const expected = (o ?? 0) + (a ?? 0) + (b ?? 0) + (f ?? 0);
    const diff = (c ?? 0) - expected;
    return { expected, diff, ok: Math.abs(diff) < 1 };
  })();

  if (loading) {
    return <div className="py-8 text-center text-muted-foreground">Loading Cash Flow notes...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Droplets className="h-4 w-4 text-cyan-600" />
            Cash Flow Statement — Notes
          </h2>
          <p className="text-xs text-muted-foreground">
            Section 2(40), Companies Act 2013 · Method:{' '}
            <span className="font-mono capitalize">{engagement?.cash_flow_method || 'indirect'}</span>
            {!isApplicable && (
              <Badge variant="secondary" className="ml-2 text-[10px]">
                Block C: Not Applicable (template still editable)
              </Badge>
            )}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline" className="gap-1"
            onClick={autoFillFromTB}
            disabled={autoFilling || !tbAvailable}
            title={!tbAvailable ? 'No Trial Balance imported (Stage 2)' : 'Auto-fill cash & bank balances from TB'}
          >
            {autoFilling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Auto-fill from TB
          </Button>
          <Button onClick={saveAll} disabled={saving} className="gap-1">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save
          </Button>
        </div>
      </div>

      {!tbAvailable && (
        <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <p>
            No Trial Balance found for this engagement (Stage 2). You can still
            enter values manually below; once a TB is imported, use{' '}
            <strong>Auto-fill from TB</strong> to populate opening &amp;
            closing balances from "cash" / "bank" ledgers.
          </p>
        </div>
      )}

      {/* ── Cash & Cash Equivalents ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Cash &amp; Cash Equivalents</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <NumberField
            label="Opening Balance (₹)"
            value={data.opening_balance}
            onChange={v => setData(prev => ({ ...prev, opening_balance: v }))}
          />
          <NumberField
            label="Closing Balance (₹)"
            value={data.closing_balance}
            onChange={v => setData(prev => ({ ...prev, closing_balance: v }))}
          />
        </CardContent>
      </Card>

      {/* ── Net cash from activities ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Net Cash Flow Summary</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <NumberField
            label="Operating Activities (₹)"
            value={data.net_operating}
            onChange={v => setData(prev => ({ ...prev, net_operating: v }))}
          />
          <NumberField
            label="Investing Activities (₹)"
            value={data.net_investing}
            onChange={v => setData(prev => ({ ...prev, net_investing: v }))}
          />
          <NumberField
            label="Financing Activities (₹)"
            value={data.net_financing}
            onChange={v => setData(prev => ({ ...prev, net_financing: v }))}
          />
        </CardContent>
      </Card>

      {/* ── Reconciliation banner ── */}
      {recon && (
        <div
          className={
            'flex items-start gap-2 rounded-md border p-3 text-xs ' +
            (recon.ok
              ? 'border-green-200 bg-green-50 text-green-900'
              : 'border-amber-200 bg-amber-50 text-amber-900')
          }
        >
          {recon.ok ? (
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          )}
          <div>
            <p className="font-semibold">
              Reconciliation:{' '}
              {recon.ok ? 'Balanced ✓' : `Off by ₹ ${fmtINR(recon.diff)}`}
            </p>
            <p>
              Expected closing = opening + (operating + investing + financing) = ₹{' '}
              {fmtINR(recon.expected)} · Reported closing = ₹{' '}
              {fmtINR(data.closing_balance)}
            </p>
          </div>
        </div>
      )}

      {/* ── Disclosure notes ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Disclosure Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={data.disclosure_notes || ''}
            onChange={e => setData(prev => ({ ...prev, disclosure_notes: e.target.value }))}
            placeholder="Free-text disclosure notes related to the Cash Flow Statement…"
            className="text-xs min-h-[140px]"
          />
        </CardContent>
      </Card>

      {/* ── Auditor's Report linkage notice ── */}
      <div className="flex items-start gap-2 rounded-md border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-900">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold">Auto-linkage to Auditor's Report</p>
          <p>
            Because <code>cash_flow_applicable = true</code>, Stage 8 / 3CA-3CB
            will include "and Cash Flow Statement" in the Opinion section, in
            Point (d) of the report's Other Legal &amp; Regulatory paragraph,
            and "and its cash flows" in the Opinion conclusion. The summary
            numbers above feed the cash-flow disclosures in the financial
            statements.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Numeric input with INR formatting tooltip ─────────────────────────────
function NumberField({
  label, value, onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        inputMode="decimal"
        step="0.01"
        value={value ?? ''}
        onChange={e => onChange(parseNum(e.target.value))}
        placeholder="0.00"
        className="h-9 text-sm font-mono"
      />
      {value != null && (
        <p className="text-[10px] text-muted-foreground mt-1">₹ {fmtINR(value)}</p>
      )}
    </div>
  );
}

export default CashFlowNotesTab;
