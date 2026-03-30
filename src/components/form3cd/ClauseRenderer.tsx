// ClauseRenderer.tsx — renders ANY clause from its ClauseDefinition
// All clauses use this renderer — no clause-specific JSX blocks.

import { useState, useCallback, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, RotateCcw, CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import type { ClauseDefinition, SubClause, AnnexureColumn, ControlType } from "@/data/form3cd-master";
import { DROPDOWN_LIBRARY, BUSINESS_SECTORS, BUSINESS_SUBSECTORS } from "@/data/form3cd-dropdowns";

interface ClauseRendererProps {
  definition: ClauseDefinition | SubClause;
  value: any;
  onChange: (value: any) => void;
  isLocked?: boolean;
  client?: any;
  parentValues?: Record<string, any>; // for dependsOn checks
  depth?: number;
}

const fmt = (n: number) =>
  n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TDS_SECTION_NATURE_MAP: Record<string, string> = {
  '192': 'Salary',
  '192A': 'Premature PF Withdrawal',
  '193': 'Interest on Securities',
  '194': 'Dividend',
  '194A': 'Interest other than Securities',
  '194B': 'Lottery / Crossword Winnings',
  '194C': 'Contractor / Sub-contractor',
  '194D': 'Insurance Commission',
  '194G': 'Commission on Lottery Tickets',
  '194H': 'Commission / Brokerage',
  '194-I(a)': 'Rent on Plant & Machinery',
  '194-I(b)': 'Rent on Land, Building, Furniture',
  '194IA': 'Transfer of Immovable Property',
  '194IB': 'Rent by Individual/HUF',
  '194J': 'Professional/Technical Services',
  '194LA': 'Compensation on Acquisition',
  '194Q': 'Purchase of Goods',
  '194R': 'Benefits/Perquisites to Business',
  '194S': 'Virtual Digital Asset',
  '194T': 'Payment to Partners',
  '206C': 'TCS on Sale of Specified Goods',
};

function resolveDropdownOptions(def: ClauseDefinition | SubClause | AnnexureColumn): { value: string; label: string }[] {
  if ('dropdownRef' in def && def.dropdownRef && DROPDOWN_LIBRARY[def.dropdownRef]) {
    return DROPDOWN_LIBRARY[def.dropdownRef];
  }
  if ('dropdownOptions' in def && def.dropdownOptions) {
    return def.dropdownOptions;
  }
  if ('options' in def && def.options) {
    return def.options;
  }
  return [];
}

function evaluateFormula(formula: string, row: Record<string, any>): number | string {
  if (formula === 'date_diff(actualDate, dueDate)') {
    const due = row.dueDate ? new Date(row.dueDate) : null;
    const actual = row.actualDate ? new Date(row.actualDate) : null;
    if (!due || !actual) return '—';
    const diff = Math.ceil((actual.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
    return diff > 0 ? `${diff} days` : 'On time';
  }

  // Special: date-comparison conditional for disallowance (Clause 20b)
  if (formula === 'actual_date > due_date ? employee_deduction : 0') {
    const due = row.due_date ? new Date(row.due_date) : null;
    const actual = row.actual_date ? new Date(row.actual_date) : null;
    if (!due || !actual || isNaN(due.getTime()) || isNaN(actual.getTime())) return 0;
    return actual.getTime() > due.getTime() ? (parseFloat(row.employee_deduction || '0') || 0) : 0;
  }

  try {
    // Replace column references with values
    let expr = formula;
    const keys = Object.keys(row).sort((a, b) => b.length - a.length);
    for (const key of keys) {
      const val = parseFloat(row[key] || '0') || 0;
      expr = expr.replace(new RegExp(`\\b${key}\\b`, 'g'), String(val));
    }
    // eslint-disable-next-line no-new-func
    const result = new Function(`return (${expr})`)();
    return typeof result === 'number' ? Math.round(result * 100) / 100 : result;
  } catch {
    return 0;
  }
}

export default function ClauseRenderer({ definition, value, onChange, isLocked = false, client, parentValues, depth = 0 }: ClauseRendererProps) {
  const data = value || {};
  const control = definition.control;

  const update = useCallback((key: string, val: any) => {
    onChange({ ...data, [key]: val });
  }, [data, onChange]);

  // Check dependsOn
  if ('dependsOn' in definition && definition.dependsOn && parentValues) {
    const expectedValue = definition.dependsOnValue !== undefined ? definition.dependsOnValue : true;
    const parentVal = parentValues[definition.dependsOn];
    if (parentVal !== expectedValue) return null;
  }

  const headingEl = depth > 0 ? (
    <Label className={`font-medium text-sm ${depth > 1 ? 'text-xs' : ''}`}>{definition.heading}</Label>
  ) : null;

  const renderClause21cPart2 = () => {
    const cl21cRows: any[] = data?.cl_21c?._rows || [];
    const totalSalary = cl21cRows.reduce((s: number, r: any) => s + (parseFloat(r.salary) || 0), 0);
    const totalInterest = cl21cRows.reduce((s: number, r: any) => s + (parseFloat(r.interest) || 0), 0);
    const netProfit = parseFloat(data?._21c_net_profit || '0') || 0;
    const interestIncome = parseFloat(data?._21c_interest_income || '0') || 0;
    const bookProfit = totalSalary + netProfit - interestIncome;
    const step1 = Math.min(Math.max(bookProfit, 0), 600000) * 0.9;
    const step2 = bookProfit > 600000 ? (bookProfit - 600000) * 0.6 : 0;
    const totalAllowable = step1 + step2;
    const inadmissible = totalSalary - totalAllowable;
    const fmtINR = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

    return (
      <div className="mt-4 rounded-lg border bg-muted/30 p-4 space-y-3">
        <h4 className="text-sm font-semibold">Part 2 — Calculation of Amount Inadmissible u/s 40(b)</h4>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium text-muted-foreground">[A] Remuneration paid to partners</TableCell>
              <TableCell className="w-[220px] text-right font-mono font-medium">₹ {fmtINR(totalSalary)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-muted-foreground">Add: Net Profit as per P. &amp; L. A/c.</TableCell>
              <TableCell>
                <Input
                  type="number"
                  className="h-8 text-right"
                  value={data?._21c_net_profit || ''}
                  onChange={e => update('_21c_net_profit', e.target.value)}
                  disabled={isLocked}
                  placeholder="0"
                />
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-muted-foreground">Add/(Less): Interest Income</TableCell>
              <TableCell>
                <Input
                  type="number"
                  className="h-8 text-right"
                  value={data?._21c_interest_income || ''}
                  onChange={e => update('_21c_interest_income', e.target.value)}
                  disabled={isLocked}
                  placeholder="0"
                />
              </TableCell>
            </TableRow>
            <TableRow className="bg-accent/30">
              <TableCell>
                <div className="font-semibold">Row D: Book Profit</div>
                <div className="text-xs text-muted-foreground">Remuneration paid to partners + Net P&amp;L - Interest Income</div>
              </TableCell>
              <TableCell className="text-right font-mono font-semibold">₹ {fmtINR(bookProfit)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-muted-foreground">Row E: Allowable Salary — Step 1: First Rs. 6,00,000 @ 90%</TableCell>
              <TableCell className="text-right font-mono">₹ {fmtINR(step1)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-muted-foreground">Row F: Allowable Salary — Step 2: Balance of Book Profit @ 60%</TableCell>
              <TableCell className="text-right font-mono">₹ {fmtINR(step2)}</TableCell>
            </TableRow>
            <TableRow className="bg-accent/30">
              <TableCell className="font-semibold">Row G: [B] Total Allowable Salary</TableCell>
              <TableCell className="text-right font-mono font-semibold">₹ {fmtINR(totalAllowable)}</TableCell>
            </TableRow>
            <TableRow className="bg-destructive/10">
              <TableCell className="font-semibold">Row H: Salary paid to partners inadmissible ([A] - [B])</TableCell>
              <TableCell className="text-right font-mono font-semibold">{inadmissible <= 0 ? 'Nil' : `₹ ${fmtINR(inadmissible)}`}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    );
  };

  switch (control) {
    case 'yes_no':
      return (
        <div className={`space-y-3 ${depth > 0 ? 'border-l-2 border-muted pl-4' : ''}`}>
          {headingEl}
          <RadioControl
            name={('key' in definition ? definition.key : ('clauseNo' in definition ? definition.clauseNo : 'radio'))}
            options={[{ value: true, label: 'Yes' }, { value: false, label: 'No' }]}
            value={data._value}
            onChange={v => {
              const next = { ...data, _value: v };
              // Auto-fill default text when No is selected
              if (v === false && definition.defaultValue) {
                next._defaultText = definition.defaultValue;
              }
              onChange(next);
            }}
            disabled={isLocked}
          />
          {data._value === false && definition.defaultValue && (
            <div className="space-y-2">
              <Input
                value={data._defaultText || definition.defaultValue}
                onChange={e => update('_defaultText', e.target.value)}
                disabled={isLocked}
                className="max-w-md"
              />
            </div>
          )}
          {data._value === false && !definition.defaultValue && !definition.subClauses?.length && (
            <div className="p-2 bg-muted rounded text-sm text-muted-foreground">Not Applicable</div>
          )}
          {data._value === true && definition.subClauses?.map(sub => (
            <ClauseRenderer
              key={sub.key}
              definition={sub}
              value={data[sub.key] || {}}
              onChange={v => update(sub.key, v)}
              isLocked={isLocked}
              parentValues={{ ...parentValues, [('key' in definition ? definition.key : ('clauseNo' in definition ? (definition as any).clauseNo : ''))]: data._value }}
              depth={depth + 1}
            />
          ))}
        </div>
      );

    case 'yes_no_na':
      return (
        <div className={`space-y-3 ${depth > 0 ? 'border-l-2 border-muted pl-4' : ''}`}>
          {headingEl}
          <RadioControl
            name={('key' in definition ? definition.key : 'radio')}
            options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'na', label: 'Not Applicable' }]}
            value={data._value}
            onChange={v => update('_value', v)}
            disabled={isLocked}
          />
          {(data._value === 'no' || data._value === 'na') && (
            <div className="p-2 bg-muted rounded text-sm text-muted-foreground">
              {data._value === 'na' ? 'Not Applicable' : 'No'}
            </div>
          )}
          {definition.subClauses?.map(sub => (
            <ClauseRenderer
              key={sub.key} definition={sub}
              value={data[sub.key] || {}} onChange={v => update(sub.key, v)}
              isLocked={isLocked}
              parentValues={{ ...parentValues, [('key' in definition ? definition.key : ('clauseNo' in definition ? (definition as any).clauseNo : ''))]: data._value }}
              depth={depth + 1}
            />
          ))}
        </div>
      );

    case 'yes_no_notdue':
      return (
        <div className={`space-y-3 ${depth > 0 ? 'border-l-2 border-muted pl-4' : ''}`}>
          {headingEl}
          <RadioControl
            name={('key' in definition ? definition.key : 'radio')}
            options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'notdue', label: 'Not Due' }]}
            value={data._value}
            onChange={v => update('_value', v)}
            disabled={isLocked}
          />
          {data._value === 'notdue' && (
            <div className="space-y-2 max-w-sm">
              <Label className="text-sm text-muted-foreground">Expected date of furnishing the report</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !data._expected_date && "text-muted-foreground")} disabled={isLocked}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {data._expected_date ? format(new Date(data._expected_date), "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={data._expected_date ? new Date(data._expected_date) : undefined} onSelect={d => update('_expected_date', d ? d.toISOString() : '')} initialFocus className={cn("p-3 pointer-events-auto")} />
                </PopoverContent>
              </Popover>
            </div>
          )}
          {data._value === 'yes' && definition.subClauses?.map(sub => (
            <ClauseRenderer
              key={sub.key}
              definition={sub}
              value={data[sub.key] || {}}
              onChange={v => update(sub.key, v)}
              isLocked={isLocked}
              parentValues={{ ...parentValues, [('key' in definition ? definition.key : ('clauseNo' in definition ? (definition as any).clauseNo : ''))]: data._value }}
              depth={depth + 1}
            />
          ))}
        </div>
      );

    case 'not_applicable_annexure':
      return (
        <div className={`space-y-3 ${depth > 0 ? 'border-l-2 border-muted pl-4' : ''}`}>
          {headingEl}
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <Checkbox
                checked={data._notApplicable === true}
                onCheckedChange={v => {
                  const next = { ...data, _notApplicable: !!v };
                  if (v) next._asPerAnnexure = false;
                  onChange(next);
                }}
                disabled={isLocked}
              />
              Not Applicable
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <Checkbox
                checked={data._asPerAnnexure === true}
                onCheckedChange={v => {
                  const next = { ...data, _asPerAnnexure: !!v };
                  if (v) next._notApplicable = false;
                  onChange(next);
                }}
                disabled={isLocked || data._notApplicable}
              />
              As Per Annexure
            </label>
          </div>
          {data._notApplicable && (
            <div className="p-2 bg-muted rounded text-sm text-muted-foreground">Not Applicable</div>
          )}
          {data._asPerAnnexure && definition.annexureColumns && (
            <AnnexureTable
              columns={definition.annexureColumns}
              rows={data._rows || []}
              onChange={rows => update('_rows', rows)}
              isLocked={isLocked}
              showTotals={'showTotals' in definition ? definition.showTotals : false}
              totalColumns={'totalColumns' in definition ? definition.totalColumns : undefined}
            />
          )}
          {!data._notApplicable && !data._asPerAnnexure && definition.annexureColumns && (
            <AnnexureTable
              columns={definition.annexureColumns}
              rows={data._rows || []}
              onChange={rows => update('_rows', rows)}
              isLocked={isLocked}
              showTotals={'showTotals' in definition ? definition.showTotals : false}
              totalColumns={'totalColumns' in definition ? definition.totalColumns : undefined}
            />
          )}
        </div>
      );

    case 'dropdown':
      return (
        <div className={`space-y-2 ${depth > 0 ? 'border-l-2 border-muted pl-4' : ''}`}>
          {headingEl}
          <Select value={data._value || ''} onValueChange={v => update('_value', v)} disabled={isLocked}>
            <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
            <SelectContent className="max-h-60">
              {resolveDropdownOptions(definition).map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {definition.subClauses?.map(sub => (
            <ClauseRenderer
              key={sub.key} definition={sub}
              value={data[sub.key] || {}} onChange={v => update(sub.key, v)}
              isLocked={isLocked} parentValues={parentValues} depth={depth + 1}
            />
          ))}
        </div>
      );

    case 'single_field':
      return (
        <div className={`space-y-2 ${depth > 0 ? 'border-l-2 border-muted pl-4' : ''}`}>
          {headingEl}
          <div className="flex items-center gap-2">
            {('fieldType' in definition && definition.fieldType === 'textarea') ? (
              <Textarea
                value={data._value || definition.defaultValue || ''}
                onChange={e => update('_value', e.target.value)}
                disabled={isLocked}
                placeholder={('placeholder' in definition && definition.placeholder) || ''}
              />
            ) : (
              <Input
                type={('fieldType' in definition && definition.fieldType === 'number') ? 'number' : 'text'}
                value={data._value || definition.defaultValue || ''}
                onChange={e => update('_value', e.target.value)}
                disabled={isLocked}
                placeholder={('placeholder' in definition && definition.placeholder) || ''}
              />
            )}
            <Button
              variant="ghost" size="icon" className="h-8 w-8 shrink-0"
              onClick={() => update('_value', definition.defaultValue || '')}
              disabled={isLocked}
            >
              <RotateCcw className="h-3 w-3" />
            </Button>
          </div>
        </div>
      );

    case 'structured_table':
      return (
        <div className={`space-y-3 ${depth > 0 ? 'border-l-2 border-muted pl-4' : ''}`}>
          {headingEl}
          {'notes' in definition && definition.notes && (
            <div className="text-xs text-muted-foreground p-2 bg-blue-50 dark:bg-blue-950/20 rounded border border-blue-200">
              <strong>Note:</strong> {definition.notes}
            </div>
          )}
          {definition.annexureColumns && (
            <AnnexureTable
              columns={definition.annexureColumns}
              rows={data._rows || []}
              onChange={rows => update('_rows', rows)}
              isLocked={isLocked}
              showTotals={'showTotals' in definition ? definition.showTotals : false}
              totalColumns={'totalColumns' in definition ? definition.totalColumns : undefined}
            />
          )}
        </div>
      );

    case 'composite':
      return (
        <div className={`space-y-4 ${depth > 0 ? 'border-l-2 border-muted pl-4' : ''}`}>
          {headingEl}
          {'clauseNo' in definition && definition.clauseNo === '34' && (
            <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm">
              <span className="font-medium">TAN:</span>{' '}
              {client?.tan_number || client?.tan ? (
                <span className="font-mono">{client?.tan_number || client?.tan}</span>
              ) : (
                <>
                  <span className="text-muted-foreground">Not set (update in Client Module)</span>{' '}
                  {client?.id && (
                    <a href={`/clients/${client.id}`} className="text-primary underline underline-offset-2">
                      Open client
                    </a>
                  )}
                </>
              )}
            </div>
          )}
          {definition.subClauses?.map((sub, i) => (
            <div key={sub.key}>
              {i > 0 && <Separator className="my-2" />}
              <ClauseRenderer
                definition={sub}
                value={data[sub.key] || {}}
                onChange={v => update(sub.key, v)}
                isLocked={isLocked}
                client={client}
                parentValues={data}
                depth={depth + 1}
              />
              {'clauseNo' in definition && definition.clauseNo === '21' && sub.key === 'cl_21c' && renderClause21cPart2()}
            </div>
          ))}
        </div>
      );

    case 'heading_only':
      return (
        <div className={`${depth > 0 ? 'border-l-2 border-muted pl-4' : ''}`}>
          <p className="text-sm font-semibold text-foreground">{definition.heading}</p>
        </div>
      );

    case 'fixed_vertical_table' as any: {
      const CL40_ROWS = [
        { key: 'r1', label: 'Total turnover of the assessee', suffix: '₹', inputType: 'number' },
        { key: 'r2', label: 'Gross profit/turnover', suffix: '%', inputType: 'number' },
        { key: 'r3', label: 'Net profit/turnover', suffix: '%', inputType: 'number' },
        { key: 'r4', label: 'Stock-in-trade/turnover', suffix: 'Times', inputType: 'number' },
        { key: 'r5', label: 'Material consumed/finished goods produced', suffix: '%', inputType: 'number' },
      ];
      return (
        <div className={`space-y-3 ${depth > 0 ? 'border-l-2 border-muted pl-4' : ''}`}>
          {headingEl}
          <Table>
            <TableHeader>
              <TableRow className="bg-muted">
                <TableHead className="w-12 font-semibold text-xs">Sr.</TableHead>
                <TableHead className="font-semibold text-xs">Particulars</TableHead>
                <TableHead className="w-[200px] font-semibold text-xs">Previous Year</TableHead>
                <TableHead className="w-[200px] font-semibold text-xs">Preceding Previous Year</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {CL40_ROWS.map((r, i) => (
                <TableRow key={r.key} className={i % 2 === 0 ? 'bg-background' : 'bg-muted/30'}>
                  <TableCell className="text-xs font-mono text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="text-sm">{r.label}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        className="h-8 text-xs text-right"
                        value={data[`${r.key}_prev`] || ''}
                        onChange={e => update(`${r.key}_prev`, e.target.value)}
                        disabled={isLocked}
                        placeholder="0"
                      />
                      <span className="text-[11px] text-muted-foreground shrink-0 w-8">{r.suffix}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        className="h-8 text-xs text-right"
                        value={data[`${r.key}_prec`] || ''}
                        onChange={e => update(`${r.key}_prec`, e.target.value)}
                        disabled={isLocked}
                        placeholder="0"
                      />
                      <span className="text-[11px] text-muted-foreground shrink-0 w-8">{r.suffix}</span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      );
    }

    case 'yes_no_text':
      return (
        <div className={`space-y-3 ${depth > 0 ? 'border-l-2 border-muted pl-4' : ''}`}>
          {headingEl}
          <div className="flex items-center gap-4">
            {['Yes', 'No'].map(opt => (
              <label key={opt} className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="radio" name={`${'key' in definition ? definition.key : definition.clauseNo}_yesno`} checked={data._value === (opt === 'Yes')}
                  onChange={() => update('_value', opt === 'Yes')} disabled={isLocked} />
                {opt}
              </label>
            ))}
          </div>
          {data._value === true && (
            <Textarea value={data._text || ''} onChange={e => update('_text', e.target.value)}
              placeholder="Enter details..." disabled={isLocked} className="text-sm" rows={3} />
          )}
        </div>
      );

    case 'yes_no_structured': {
      const rows = ('structuredRows' in definition ? (definition as any).structuredRows : []) as { label: string; key: string }[];
      return (
        <div className={`space-y-3 ${depth > 0 ? 'border-l-2 border-muted pl-4' : ''}`}>
          {headingEl}
          <div className="flex items-center gap-4">
            {['Yes', 'No'].map(opt => (
              <label key={opt} className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="radio" name={`${'key' in definition ? definition.key : definition.clauseNo}_yesno_s`} checked={data._value === (opt === 'Yes')}
                  onChange={() => update('_value', opt === 'Yes')} disabled={isLocked} />
                {opt}
              </label>
            ))}
          </div>
          {data._value === true && rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[250px]">CENVAT/ITC</TableHead>
                  <TableHead>Amount (₹)</TableHead>
                  <TableHead>Treatment in Profit & Loss / Accounts</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(r => (
                  <TableRow key={r.key}>
                    <TableCell className="font-medium text-sm">{r.label}</TableCell>
                    <TableCell>
                      <Input type="number" className="h-8 text-xs" value={data[`${r.key}_amount`] || ''}
                        onChange={e => update(`${r.key}_amount`, e.target.value)} disabled={isLocked} />
                    </TableCell>
                    <TableCell>
                      <Input className="h-8 text-xs" value={data[`${r.key}_treatment`] || ''}
                        onChange={e => update(`${r.key}_treatment`, e.target.value)} disabled={isLocked} />
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={isLocked}
                        onClick={() => { update(`${r.key}_amount`, ''); update(`${r.key}_treatment`, ''); }}>
                        <RotateCcw className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      );
    }

    case 'note_reference':
      return (
        <div className={`space-y-3 ${depth > 0 ? 'border-l-2 border-muted pl-4' : ''}`}>
          {headingEl}
          {/* Not Applicable checkbox */}
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <Checkbox
                checked={data._notApplicable === true}
                onCheckedChange={v => {
                  const next = { ...data, _notApplicable: !!v };
                  if (v) { next._asPerAnnexure = false; }
                  onChange(next);
                }}
                disabled={isLocked}
              />
              Not Applicable
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <Checkbox
                checked={data._asPerAnnexure === true}
                onCheckedChange={v => {
                  const next = { ...data, _asPerAnnexure: !!v };
                  if (v) { next._notApplicable = false; }
                  onChange(next);
                }}
                disabled={isLocked || data._notApplicable}
              />
              As Per Annexure
            </label>
          </div>
          {data._notApplicable && (
            <div className="p-2 bg-muted rounded text-sm text-muted-foreground">N/A</div>
          )}
          {!data._notApplicable && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">As per Note — </Label>
              <Input
                value={data._noteRef || ''}
                onChange={e => update('_noteRef', e.target.value)}
                disabled={isLocked}
                placeholder="Enter note number"
                className="max-w-xs"
              />
            </div>
          )}
          {data._asPerAnnexure && definition.annexureColumns && (
            <AnnexureTable
              columns={definition.annexureColumns}
              rows={data._rows || []}
              onChange={rows => update('_rows', rows)}
              isLocked={isLocked}
              showTotals={'showTotals' in definition ? definition.showTotals : false}
              totalColumns={'totalColumns' in definition ? definition.totalColumns : undefined}
            />
          )}
        </div>
      );

    case 'same_as_checkbox': {
      const sameAsLabel = definition.defaultValue === 'same_as_11a' ? 'Same as 11(a)' : 'Same as Above';
      return (
        <div className={`space-y-3 ${depth > 0 ? 'border-l-2 border-muted pl-4' : ''}`}>
          {headingEl}
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <Checkbox
              checked={data._sameAs === true}
              onCheckedChange={v => update('_sameAs', !!v)}
              disabled={isLocked}
            />
            {sameAsLabel}
          </label>
          {data._sameAs && (
            <div className="p-2 bg-muted rounded text-sm text-muted-foreground italic">
              Marked as "{sameAsLabel}" — status recorded.
            </div>
          )}
          {!data._sameAs && (
            <Textarea
              value={data._value || ''}
              onChange={e => update('_value', e.target.value)}
              disabled={isLocked}
              placeholder="Enter details here..."
              className="min-h-[80px]"
            />
          )}
        </div>
      );
    }

    case 'matrix':
      return (
        <div className={`space-y-2 ${depth > 0 ? 'border-l-2 border-muted pl-4' : ''}`}>
          {headingEl}
          <Textarea
            value={data._value || ''}
            onChange={e => update('_value', e.target.value)}
            disabled={isLocked}
            placeholder="Enter details..."
          />
        </div>
      );

    default:
      return null;
  }
}

// ─── Radio Control ───
function RadioControl({ name, options, value, onChange, disabled }: {
  name: string;
  options: { value: any; label: string }[];
  value: any;
  onChange: (v: any) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-4">
      {options.map(opt => (
        <label key={String(opt.value)} className="flex items-center gap-2 cursor-pointer text-sm">
          <input
            type="radio"
            name={name}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
            disabled={disabled}
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

// ─── Annexure Table (Generic) ───
function AnnexureTable({ columns, rows, onChange, isLocked, showTotals, totalColumns }: {
  columns: AnnexureColumn[];
  rows: Record<string, any>[];
  onChange: (rows: Record<string, any>[]) => void;
  isLocked?: boolean;
  showTotals?: boolean;
  totalColumns?: string[];
}) {
  function addRow() {
    const emptyRow: Record<string, any> = {};
    columns.forEach((c, i) => {
      // Auto-fill serial number for readonly sr_no columns
      if (c.key === 'sr_no' && c.type === 'readonly') {
        emptyRow[c.key] = String(rows.length + 1);
      } else {
        emptyRow[c.key] = '';
      }
    });
    onChange([...rows, emptyRow]);
  }

  function removeRow(i: number) {
    const newRows = rows.filter((_, idx) => idx !== i);
    // Re-number sr_no if it's a readonly column
    const srCol = columns.find(c => c.key === 'sr_no' && c.type === 'readonly');
    if (srCol) {
      newRows.forEach((r, idx) => { r.sr_no = String(idx + 1); });
    }
    onChange(newRows);
  }

  function updateCell(ri: number, key: string, val: string) {
    const newRows = rows.map((r, idx) => {
      if (idx !== ri) return r;
      const next = { ...r, [key]: val };

      // When sector changes, clear sub_sector and code
      if (key === 'sector') {
        next.sub_sector = '';
        next.code = '';
      }

      // When sub_sector changes, auto-set code to the selected value (5-digit code)
      if (key === 'sub_sector' && val) {
        next.code = val;
      }

      // Auto-fill Clause 34(a) Nature of Payment from selected section
      if (key === 'section' && columns.some(c => c.key === 'nature_of_payment')) {
        next.nature_of_payment = TDS_SECTION_NATURE_MAP[val] || '';
        next._nature_of_payment_editable = false;
      }

      // Recalculate auto_calc columns
      columns.filter(c => c.type === 'auto_calc' && c.formula).forEach(c => {
        next[c.key] = evaluateFormula(c.formula!, next);
      });

      return next;
    });
    onChange(newRows);
  }

  function patchRow(ri: number, patch: Record<string, any>) {
    onChange(rows.map((r, idx) => idx === ri ? { ...r, ...patch } : r));
  }

  // Compute totals
  const totals: Record<string, number> = {};
  if (showTotals && totalColumns) {
    totalColumns.forEach(key => {
      totals[key] = rows.reduce((s, r) => s + (parseFloat(r[key] || '0') || 0), 0);
    });
  }

  // Also compute auto_calc totals
  const autoCalcTotals: Record<string, number> = {};
  columns.filter(c => c.type === 'auto_calc').forEach(c => {
    autoCalcTotals[c.key] = rows.reduce((s, r) => {
      const val = c.formula ? evaluateFormula(c.formula, r) : 0;
      return s + (typeof val === 'number' ? val : 0);
    }, 0);
  });

  const hasSrNoCol = columns.some(c => c.key === 'sr_no');

  return (
    <div className="space-y-2 overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="text-xs bg-muted/50">
            {!hasSrNoCol && <TableHead className="w-8 text-xs">Sr</TableHead>}
            {columns.map(col => (
              <TableHead
                key={col.key}
                className="text-xs"
                style={{
                  width: col.width ? `${col.width}px` : undefined,
                  minWidth: col.minWidth ? `${col.minWidth}px` : col.width ? `${col.width}px` : undefined,
                }}
              >
                {col.label}
              </TableHead>
            ))}
            {!isLocked && <TableHead className="w-10" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={columns.length + (hasSrNoCol ? 0 : 1) + (isLocked ? 0 : 1)} className="text-center text-muted-foreground text-sm py-4">
                No rows — click "+ Add Row" to begin
              </TableCell>
            </TableRow>
          )}
          {rows.map((row, ri) => (
            <TableRow key={ri}>
              {!hasSrNoCol && <TableCell className="p-1 text-xs text-center text-muted-foreground">{ri + 1}</TableCell>}
              {columns.map(col => {
                // Conditional visibility: if conditionalOn is set, check if the driving column matches
                const isConditionallyHidden = col.conditionalOn && col.conditionalOnValue !== undefined
                  && row[col.conditionalOn] !== col.conditionalOnValue;
                return (
                  <TableCell key={col.key} className={`p-1 ${col.type === 'auto_calc' || col.type === 'readonly' || isConditionallyHidden ? 'bg-muted/30' : ''}`}>
                    {isConditionallyHidden ? (
                      <span className="text-xs text-muted-foreground px-2">—</span>
                    ) : (
                      <CellInput
                        column={col}
                        value={row[col.key] ?? ''}
                        onChange={val => updateCell(ri, col.key, val)}
                        onRowChange={patch => patchRow(ri, patch)}
                        disabled={isLocked}
                        row={row}
                      />
                    )}
                  </TableCell>
                );
              })}
              {!isLocked && (
                <TableCell className="p-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeRow(ri)}>
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
          {rows.length > 0 && (showTotals || columns.some(c => c.type === 'auto_calc')) && (
            <TableRow className="bg-muted/30 font-semibold text-xs">
              {!hasSrNoCol && <TableCell className="p-1 text-center">—</TableCell>}
              {columns.map(col => (
                <TableCell key={col.key} className="p-1">
                  {(totalColumns?.includes(col.key) && totals[col.key] !== undefined) ? (
                    <span className="text-xs font-bold">₹{fmt(totals[col.key])}</span>
                  ) : autoCalcTotals[col.key] !== undefined ? (
                    <span className="text-xs font-bold">₹{fmt(autoCalcTotals[col.key])}</span>
                  ) : col.key === columns[0]?.key ? (
                    <span className="text-xs font-bold">Total</span>
                  ) : ''}
                </TableCell>
              ))}
              {!isLocked && <TableCell />}
            </TableRow>
          )}
        </TableBody>
      </Table>
      {!isLocked && (
        <Button variant="outline" size="sm" onClick={addRow}>
          <Plus className="h-3 w-3 mr-1" /> Add Row
        </Button>
      )}
    </div>
  );
}

// ─── Cell Input ───
function CellInput({ column, value, onChange, onRowChange, disabled, row }: {
  column: AnnexureColumn;
  value: any;
  onChange: (val: string) => void;
  onRowChange?: (patch: Record<string, any>) => void;
  disabled?: boolean;
  row?: Record<string, any>;
}) {
  if (column.key === 'nature_of_payment') {
    const editable = row?._nature_of_payment_editable === true;
    return (
      <div className="flex items-center gap-1">
        <Input
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          readOnly={!editable}
          className="h-8 text-xs"
        />
        {!disabled && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-[11px]"
            onClick={() => onRowChange?.({ _nature_of_payment_editable: !editable })}
          >
            {editable ? 'Lock' : 'Edit'}
          </Button>
        )}
      </div>
    );
  }

  switch (column.type) {
    case 'text':
      return <Input value={value || ''} onChange={e => onChange(e.target.value)} disabled={disabled} className="h-8 text-xs" />;
    case 'numeric':
      return <Input type="number" value={value || ''} onChange={e => onChange(e.target.value)} disabled={disabled} className="h-8 text-xs text-right" />;
    case 'date':
      return <Input type="date" value={value || ''} onChange={e => onChange(e.target.value)} disabled={disabled} className="h-8 text-xs" />;
    case 'pan':
      return (
        <Input
          value={value || ''}
          onChange={e => onChange(e.target.value.toUpperCase())}
          disabled={disabled}
          maxLength={10}
          placeholder="AAAAA0000A"
          className="h-8 text-xs font-mono"
        />
      );
    case 'dropdown': {
      let options = resolveDropdownOptions(column);

      // Handle dependent sector/sub_sector dropdowns
      if (column.key === 'sector' && !options.length) {
        options = BUSINESS_SECTORS;
      }
      if (column.key === 'sub_sector' && column.dependsOnColumn === 'sector') {
        const sectorValue = row?.[column.dependsOnColumn] || '';
        options = sectorValue ? (BUSINESS_SUBSECTORS[sectorValue] || []) : [];
        if (!sectorValue) {
          return (
            <Select value="" disabled>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select Sector first" /></SelectTrigger>
              <SelectContent><SelectItem value="_" className="text-xs">Select Sector first</SelectItem></SelectContent>
            </Select>
          );
        }
      }

      return (
        <Select value={value || ''} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select..." /></SelectTrigger>
          <SelectContent className="max-h-60">
            {options.map(o => (
              <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    case 'yes_no_dropdown':
      return (
        <Select value={value || ''} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="Y" className="text-xs">Yes</SelectItem>
            <SelectItem value="N" className="text-xs">No</SelectItem>
          </SelectContent>
        </Select>
      );
    case 'auto_calc': {
      const computed = column.formula && row ? evaluateFormula(column.formula, row) : value;
      return (
        <span className="text-xs px-2 py-1 block text-right font-medium">
          {typeof computed === 'number' ? `₹${fmt(computed)}` : String(computed || '—')}
        </span>
      );
    }
    case 'readonly':
      return <span className="text-xs px-2 py-1 block text-muted-foreground">{value || '—'}</span>;
    default:
      return <Input value={value || ''} onChange={e => onChange(e.target.value)} disabled={disabled} className="h-8 text-xs" />;
  }
}
