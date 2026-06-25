import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { signedBalance as fsSignedBalance } from "@/lib/fsSignConvention";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { ArrowUp, ArrowDown, Minus, Upload, Loader2, Sparkles } from "lucide-react";

const BS_GROUPS = [
  "Equity Share Capital", "Retained Earnings",
  "Long-Term Borrowings", "Short-Term Borrowings",
  "Trade Payables", "Other Current Liabilities",
  "Non-Current Assets", "Current Assets",
];

const PL_GROUPS = [
  "Revenue", "Cost of Goods Sold",
  "Employee Benefit Expenses", "Finance Costs",
  "Depreciation", "Other Expenses", "Other Income",
];

function pctChange(cy: number, py: number): number | null {
  if (py === 0) return cy === 0 ? 0 : null;
  return ((cy - py) / Math.abs(py)) * 100;
}

function formatRs(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function PctBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-muted-foreground">N/A</span>;
  const isPos = pct > 0;
  const color = Math.abs(pct) < 0.5 ? "text-muted-foreground" : isPos ? "text-green-600" : "text-red-600";
  return (
    <span className={`flex items-center gap-1 font-medium ${color}`}>
      {Math.abs(pct) < 0.5 ? <Minus className="h-3 w-3" /> : isPos ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {pct >= 0 ? "+" : ""}{pct.toFixed(1)}%
    </span>
  );
}

function TrendArrow({ cy, py, higherIsBetter = true }: { cy: number; py: number; higherIsBetter?: boolean }) {
  if (cy === py) return <Minus className="h-4 w-4 text-muted-foreground" />;
  const improved = higherIsBetter ? cy > py : cy < py;
  return improved ? <ArrowUp className="h-4 w-4 text-green-600" /> : <ArrowDown className="h-4 w-4 text-red-600" />;
}

export default function ComparativeStatements() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [mappings, setMappings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentary, setCommentary] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [dataSource, setDataSource] = useState<"snapshots" | "tally">("snapshots");
  const [tallyLedgers, setTallyLedgers] = useState<any[]>([]);

  useEffect(() => {
    if (!clientId) return;
    loadData();
  }, [clientId]);

  async function loadData() {
    setLoading(true);
    const [snapRes, mapRes, tallyRows] = await Promise.all([
      supabase.from("trial_balance_snapshots").select("*").eq("client_id", clientId!).order("financial_year", { ascending: false }).limit(2),
      supabase.from("coa_mappings").select("*"),
      // PAGINATE — PostgREST caps a single response at 1000 rows; an un-paginated
      // TB select silently truncated large clients, under-counting comparatives.
      (async () => {
        const rows: any[] = [];
        for (let from = 0; ; from += 1000) {
          const { data, error } = await supabase.from("tally_trial_balance").select("ledger_name,parent_group,closing_balance,balance_type").eq("client_id", clientId!).range(from, from + 999);
          if (error || !data || !data.length) break;
          rows.push(...data);
          if (data.length < 1000) break;
        }
        return rows;
      })(),
    ]);
    setSnapshots(snapRes.data || []);
    setMappings(mapRes.data || []);
    setTallyLedgers(tallyRows || []);
    setLoading(false);
  }

  // Build lookup: raw_ledger_name → { standard_head, account_group, bs_pl }
  const mappingLookup = useMemo(() => {
    const lookup: Record<string, any> = {};
    for (const m of mappings) {
      if (m.raw_ledger_name) lookup[m.raw_ledger_name.toLowerCase()] = m;
    }
    return lookup;
  }, [mappings]);

  function groupLedgers(normData: any[]): Record<string, number> {
    const groups: Record<string, number> = {};
    for (const l of normData) {
      const name = (l.account_name || l.ledger_name || "").toLowerCase();
      const mapping = mappingLookup[name];
      const group = mapping?.account_group || l.account_group || "Other";
      const balance = Number(l.debit || l.closing_dr || 0) - Number(l.credit || l.closing_cr || 0);
      groups[group] = (groups[group] || 0) + balance;
    }
    return groups;
  }

  const hasTwoYears = snapshots.length >= 2;
  const cySnapshot = snapshots[0];
  const pySnapshot = snapshots[1];

  // Build groups from tally_trial_balance + coa_mappings
  function groupTallyLedgers(ledgers: any[]): Record<string, number> {
    const groups: Record<string, number> = {};
    for (const l of ledgers) {
      const name = (l.ledger_name || "").toLowerCase();
      const mapping = mappingLookup[name];
      const group = mapping?.account_group || l.parent_group || "Other";
      // Break #7: use fsSignConvention to prevent double-sign if closing_balance
      // is ever stored as a negative number. Math.abs is applied inside fsSignedBalance.
      const balance = fsSignedBalance(l.closing_balance, l.balance_type, "DR");
      groups[group] = (groups[group] || 0) + balance;
    }
    return groups;
  }

  const cyGroups = useMemo(() => {
    if (dataSource === "tally") return groupTallyLedgers(tallyLedgers);
    return cySnapshot ? groupLedgers(Array.isArray(cySnapshot.normalised_data) ? cySnapshot.normalised_data : []) : {};
  }, [cySnapshot, mappingLookup, dataSource, tallyLedgers]);

  const pyGroups = useMemo(() => {
    if (dataSource === "tally") return {}; // tally TB is single-period
    return pySnapshot ? groupLedgers(Array.isArray(pySnapshot.normalised_data) ? pySnapshot.normalised_data : []) : {};
  }, [pySnapshot, mappingLookup, dataSource]);

  // Computed P&L metrics
  function getMetrics(groups: Record<string, number>) {
    const revenue = Math.abs(groups["Revenue"] || 0);
    const cogs = Math.abs(groups["Cost of Goods Sold"] || 0);
    const grossProfit = revenue - cogs;
    const empExp = Math.abs(groups["Employee Benefit Expenses"] || 0);
    const finCosts = Math.abs(groups["Finance Costs"] || 0);
    const depreciation = Math.abs(groups["Depreciation"] || 0);
    const otherExp = Math.abs(groups["Other Expenses"] || 0);
    const otherIncome = Math.abs(groups["Other Income"] || 0);
    const ebitda = grossProfit + otherIncome - empExp - otherExp;
    const pbt = ebitda - depreciation - finCosts;
    return { revenue, cogs, grossProfit, grossMargin: revenue ? (grossProfit / revenue) * 100 : 0, ebitda, finCosts, pbt, depreciation, pat: pbt * 0.75 };
  }

  const cyMetrics = useMemo(() => getMetrics(cyGroups), [cyGroups]);
  const pyMetrics = useMemo(() => getMetrics(pyGroups), [pyGroups]);

  // Ratios
  function getRatios(groups: Record<string, number>, metrics: ReturnType<typeof getMetrics>) {
    const ca = Math.abs(groups["Current Assets"] || 0);
    const cl = Math.abs(groups["Trade Payables"] || 0) + Math.abs(groups["Other Current Liabilities"] || 0) + Math.abs(groups["Short-Term Borrowings"] || 0);
    const debt = Math.abs(groups["Long-Term Borrowings"] || 0) + Math.abs(groups["Short-Term Borrowings"] || 0);
    const equity = Math.abs(groups["Equity Share Capital"] || 0) + Math.abs(groups["Retained Earnings"] || 0);
    const ebit = metrics.pbt + metrics.finCosts;
    const debtors = Math.abs(groups["Current Assets"] || 0) * 0.3; // approximate
    const creditors = Math.abs(groups["Trade Payables"] || 0);

    return {
      currentRatio: cl ? ca / cl : 0,
      debtEquity: equity ? debt / equity : 0,
      interestCoverage: metrics.finCosts ? ebit / metrics.finCosts : 0,
      grossMargin: metrics.grossMargin,
      netMargin: metrics.revenue ? (metrics.pat / metrics.revenue) * 100 : 0,
      debtorDays: metrics.revenue ? (debtors / metrics.revenue) * 365 : 0,
      creditorDays: metrics.cogs ? (creditors / metrics.cogs) * 365 : 0,
    };
  }

  const cyRatios = useMemo(() => getRatios(cyGroups, cyMetrics), [cyGroups, cyMetrics]);
  const pyRatios = useMemo(() => getRatios(pyGroups, pyMetrics), [pyGroups, pyMetrics]);

  async function generateCommentary() {
    setAiLoading(true);
    setCommentary("");

    const significantChanges = [...BS_GROUPS, ...PL_GROUPS]
      .map(g => ({ group: g, cy: cyGroups[g] || 0, py: pyGroups[g] || 0, pct: pctChange(cyGroups[g] || 0, pyGroups[g] || 0) }))
      .filter(c => c.pct !== null && Math.abs(c.pct) > 50);

    try {
      const { data, error } = await supabase.functions.invoke("claude-gateway", {
        body: {
          request_type: "comparative_commentary",
          user_message: JSON.stringify({
            cy_summary: cyMetrics,
            py_summary: pyMetrics,
            ratios_cy: cyRatios,
            ratios_py: pyRatios,
            significant_changes: significantChanges,
            cy_fy: cySnapshot?.financial_year,
            py_fy: pySnapshot?.financial_year,
          }),
          stream: true,
        },
      });

      if (error) throw error;

      // Handle streaming response
      if (data instanceof ReadableStream) {
        const reader = data.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let text = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let newlineIdx: number;
          while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
            let line = buffer.slice(0, newlineIdx);
            buffer = buffer.slice(newlineIdx + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (jsonStr === "[DONE]") break;
            try {
              const parsed = JSON.parse(jsonStr);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) { text += delta; setCommentary(text); }
            } catch {}
          }
        }
        if (!text) {
          // Non-streaming fallback
          const decoded = decoder.decode();
          setCommentary(decoded || "Commentary generation complete.");
        }
      } else if (typeof data === "object") {
        // Non-streaming JSON response
        const text = data?.raw || JSON.stringify(data);
        setCommentary(text);
      }
    } catch (err: any) {
      toast.error("AI commentary failed: " + (err.message || "Unknown error"));
    }
    setAiLoading(false);
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  if (!hasTwoYears) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Comparative Financial Statements</h1>
        <Card>
          <CardContent className="py-16 text-center space-y-4">
            <p className="text-lg text-muted-foreground">Comparative analysis requires two years of trial balance data.</p>
            <p className="text-sm text-muted-foreground">
              {snapshots.length === 0 ? "No trial balance imported yet." : `Only ${snapshots.length} year available (${snapshots[0]?.financial_year}).`}
            </p>
            <div className="flex gap-3 justify-center">
              <Button onClick={() => navigate(`/clients/${clientId}/audit/import-trial-balance`)}>
                <Upload className="h-4 w-4 mr-2" />Import Current Year
              </Button>
              <Button variant="outline" onClick={() => navigate(`/clients/${clientId}/audit/import-trial-balance`)}>
                <Upload className="h-4 w-4 mr-2" />Import Previous Year
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const allGroups = [...new Set([...Object.keys(cyGroups), ...Object.keys(pyGroups)])];

  const metricRows = [
    { label: "Revenue", cy: cyMetrics.revenue, py: pyMetrics.revenue },
    { label: "Cost of Goods Sold", cy: cyMetrics.cogs, py: pyMetrics.cogs },
    { label: "Gross Profit", cy: cyMetrics.grossProfit, py: pyMetrics.grossProfit },
    { label: "Gross Margin %", cy: cyMetrics.grossMargin, py: pyMetrics.grossMargin, isPct: true },
    { label: "EBITDA", cy: cyMetrics.ebitda, py: pyMetrics.ebitda },
    { label: "Finance Costs", cy: cyMetrics.finCosts, py: pyMetrics.finCosts },
    { label: "PBT", cy: cyMetrics.pbt, py: pyMetrics.pbt },
    { label: "PAT (est.)", cy: cyMetrics.pat, py: pyMetrics.pat },
  ];

  const ratioRows = [
    { label: "Current Ratio", cy: cyRatios.currentRatio, py: pyRatios.currentRatio, higher: true, fmt: (n: number) => n.toFixed(2) },
    { label: "Debt-Equity Ratio", cy: cyRatios.debtEquity, py: pyRatios.debtEquity, higher: false, fmt: (n: number) => n.toFixed(2) },
    { label: "Interest Coverage", cy: cyRatios.interestCoverage, py: pyRatios.interestCoverage, higher: true, fmt: (n: number) => n.toFixed(2) },
    { label: "Gross Margin %", cy: cyRatios.grossMargin, py: pyRatios.grossMargin, higher: true, fmt: (n: number) => n.toFixed(1) + "%" },
    { label: "Net Margin %", cy: cyRatios.netMargin, py: pyRatios.netMargin, higher: true, fmt: (n: number) => n.toFixed(1) + "%" },
    { label: "Debtor Days", cy: cyRatios.debtorDays, py: pyRatios.debtorDays, higher: false, fmt: (n: number) => n.toFixed(0) },
    { label: "Creditor Days", cy: cyRatios.creditorDays, py: pyRatios.creditorDays, higher: true, fmt: (n: number) => n.toFixed(0) },
  ];

  // Balance check
  const cyAssets = Math.abs(cyGroups["Non-Current Assets"] || 0) + Math.abs(cyGroups["Current Assets"] || 0);
  const cyLiabEquity = Math.abs(cyGroups["Equity Share Capital"] || 0) + Math.abs(cyGroups["Retained Earnings"] || 0) +
    Math.abs(cyGroups["Long-Term Borrowings"] || 0) + Math.abs(cyGroups["Short-Term Borrowings"] || 0) +
    Math.abs(cyGroups["Trade Payables"] || 0) + Math.abs(cyGroups["Other Current Liabilities"] || 0);
  const cyBalanced = Math.abs(cyAssets - cyLiabEquity) < 1;

  const pyAssets = Math.abs(pyGroups["Non-Current Assets"] || 0) + Math.abs(pyGroups["Current Assets"] || 0);
  const pyLiabEquity = Math.abs(pyGroups["Equity Share Capital"] || 0) + Math.abs(pyGroups["Retained Earnings"] || 0) +
    Math.abs(pyGroups["Long-Term Borrowings"] || 0) + Math.abs(pyGroups["Short-Term Borrowings"] || 0) +
    Math.abs(pyGroups["Trade Payables"] || 0) + Math.abs(pyGroups["Other Current Liabilities"] || 0);
  const pyBalanced = Math.abs(pyAssets - pyLiabEquity) < 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Comparative Financial Statements</h1>
          <p className="text-sm text-muted-foreground">
            {dataSource === "tally"
              ? `Tally Sync data — ${tallyLedgers.length} ledgers`
              : `${cySnapshot?.financial_year} vs ${pySnapshot?.financial_year}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Data source:</span>
          <Button
            size="sm"
            variant={dataSource === "snapshots" ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => setDataSource("snapshots")}
          >
            Uploaded TB
          </Button>
          <Button
            size="sm"
            variant={dataSource === "tally" ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => setDataSource("tally")}
            disabled={tallyLedgers.length === 0}
            title={tallyLedgers.length === 0 ? "No Tally data — run Tally Sync first" : ""}
          >
            Tally Sync {tallyLedgers.length > 0 && `(${tallyLedgers.length})`}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="bs">
        <TabsList>
          <TabsTrigger value="bs">Balance Sheet</TabsTrigger>
          <TabsTrigger value="pl">P&L Statement</TabsTrigger>
          <TabsTrigger value="ratios">Key Ratios</TabsTrigger>
        </TabsList>

        <TabsContent value="bs">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account Head</TableHead>
                    <TableHead className="text-right">CY {cySnapshot?.financial_year} (Rs)</TableHead>
                    <TableHead className="text-right">PY {pySnapshot?.financial_year} (Rs)</TableHead>
                    <TableHead className="text-right">Change %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {BS_GROUPS.map(group => {
                    const cy = Math.abs(cyGroups[group] || 0);
                    const py = Math.abs(pyGroups[group] || 0);
                    const pct = pctChange(cy, py);
                    const highlight = pct !== null && Math.abs(pct) > 50;
                    return (
                      <TableRow key={group} className={highlight ? "bg-amber-50" : ""}>
                        <TableCell className="font-medium">{group}</TableCell>
                        <TableCell className="text-right font-mono">{formatRs(cy)}</TableCell>
                        <TableCell className="text-right font-mono">{formatRs(py)}</TableCell>
                        <TableCell className="text-right"><PctBadge pct={pct} /></TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="border-t-2">
                    <TableCell className="font-bold">Total Assets</TableCell>
                    <TableCell className="text-right font-mono font-bold">{formatRs(cyAssets)}</TableCell>
                    <TableCell className="text-right font-mono font-bold">{formatRs(pyAssets)}</TableCell>
                    <TableCell />
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-bold">Total Liabilities + Equity</TableCell>
                    <TableCell className="text-right font-mono font-bold">{formatRs(cyLiabEquity)}</TableCell>
                    <TableCell className="text-right font-mono font-bold">{formatRs(pyLiabEquity)}</TableCell>
                    <TableCell />
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-bold">Balance Check</TableCell>
                    <TableCell className="text-right">{cyBalanced ? <span className="text-green-600">✓ Balanced</span> : <span className="text-red-600">✗ Mismatch</span>}</TableCell>
                    <TableCell className="text-right">{pyBalanced ? <span className="text-green-600">✓ Balanced</span> : <span className="text-red-600">✗ Mismatch</span>}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pl">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Particulars</TableHead>
                    <TableHead className="text-right">CY {cySnapshot?.financial_year} (Rs)</TableHead>
                    <TableHead className="text-right">PY {pySnapshot?.financial_year} (Rs)</TableHead>
                    <TableHead className="text-right">Change %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metricRows.map(row => {
                    const pct = pctChange(row.cy, row.py);
                    const highlight = pct !== null && Math.abs(pct) > 50;
                    return (
                      <TableRow key={row.label} className={`${highlight ? "bg-amber-50" : ""} ${["Gross Profit", "EBITDA", "PBT", "PAT (est.)"].includes(row.label) ? "font-semibold" : ""}`}>
                        <TableCell>{row.label}</TableCell>
                        <TableCell className="text-right font-mono">{row.isPct ? row.cy.toFixed(1) + "%" : formatRs(row.cy)}</TableCell>
                        <TableCell className="text-right font-mono">{row.isPct ? row.py.toFixed(1) + "%" : formatRs(row.py)}</TableCell>
                        <TableCell className="text-right"><PctBadge pct={pct} /></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ratios">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ratio</TableHead>
                    <TableHead className="text-right">CY {cySnapshot?.financial_year}</TableHead>
                    <TableHead className="text-right">PY {pySnapshot?.financial_year}</TableHead>
                    <TableHead className="text-center">Trend</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ratioRows.map(row => (
                    <TableRow key={row.label}>
                      <TableCell className="font-medium">{row.label}</TableCell>
                      <TableCell className="text-right font-mono">{row.fmt(row.cy)}</TableCell>
                      <TableCell className="text-right font-mono">{row.fmt(row.py)}</TableCell>
                      <TableCell className="text-center"><TrendArrow cy={row.cy} py={row.py} higherIsBetter={row.higher} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* AI Commentary */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              MD&A Commentary
            </CardTitle>
            <Button onClick={generateCommentary} disabled={aiLoading}>
              {aiLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
              Generate AI Commentary
            </Button>
          </div>
        </CardHeader>
        {commentary && (
          <CardContent>
            <div className="prose prose-sm max-w-none whitespace-pre-wrap text-foreground">{commentary}</div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
