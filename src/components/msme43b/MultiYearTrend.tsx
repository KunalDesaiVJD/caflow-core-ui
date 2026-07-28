import { useMemo } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TrendingUp } from 'lucide-react';
import type { Msme43bRunSummary } from '@/lib/msme43b';

const inr = (v: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(v));

/** Compact axis label: ₹ in Cr / L / K. */
function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(Math.round(v));
}

const COLORS = {
  disallowed: '#dc2626',   // red-600
  allowedFY: '#059669',    // emerald-600
  outstanding: '#d97706',  // amber-600
};

/**
 * Multi-year trend of the 43B(h) position for a client, built from its saved
 * runs. One point per financial year (the latest saved run for that CY year).
 * Renders only when at least two distinct years exist.
 */
export function MultiYearTrend({ runs }: { runs: Msme43bRunSummary[] }) {
  const data = useMemo(() => {
    // runs arrive newest-first → the first seen per CY year is the latest saved.
    const byYear = new Map<string, Msme43bRunSummary>();
    for (const r of runs) if (!byYear.has(r.cy_label)) byYear.set(r.cy_label, r);
    return [...byYear.values()]
      .sort((a, b) => a.cy_label.localeCompare(b.cy_label))
      .map((r) => ({
        year: r.cy_label,
        disallowed: r.total_disallowed_cy,
        allowedFY: r.total_allowed_fy,
        outstanding: r.total_still_outstanding,
      }));
  }, [runs]);

  if (data.length < 2) return null;

  const totalDisallowed = data.reduce((a, d) => a + d.disallowed, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4" /> Multi-year trend
        </CardTitle>
        <CardDescription>
          43B(h) position across {data.length} financial years · cumulative disallowance ₹{inr(totalDisallowed)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="year" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={compact} width={48} />
            <Tooltip
              formatter={(v: number, name: string) => [`₹${inr(v)}`, name]}
              contentStyle={{ fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar name="Disallowed" dataKey="disallowed" fill={COLORS.disallowed} radius={[3, 3, 0, 0]} />
            <Bar name="Allowed on payment" dataKey="allowedFY" fill={COLORS.allowedFY} radius={[3, 3, 0, 0]} />
            <Bar name="Still outstanding" dataKey="outstanding" fill={COLORS.outstanding} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Year</TableHead>
              <TableHead className="text-right">Disallowed</TableHead>
              <TableHead className="text-right">Allowed on payment</TableHead>
              <TableHead className="text-right">Still outstanding</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((d) => (
              <TableRow key={d.year}>
                <TableCell className="tabular-nums">{d.year}</TableCell>
                <TableCell className="text-right tabular-nums text-red-600">₹{inr(d.disallowed)}</TableCell>
                <TableCell className="text-right tabular-nums text-emerald-600">₹{inr(d.allowedFY)}</TableCell>
                <TableCell className="text-right tabular-nums text-amber-600">₹{inr(d.outstanding)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
