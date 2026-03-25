// ClauseRenderer.tsx — renders ANY clause from its ClauseDefinition
// All clauses use this renderer — no clause-specific JSX blocks.

import { useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, RotateCcw } from "lucide-react";
import type { ClauseDefinition, SubClause, AnnexureColumn, ControlType } from "@/data/form3cd-master";
import { DROPDOWN_LIBRARY } from "@/data/form3cd-dropdowns";

interface ClauseRendererProps {
  definition: ClauseDefinition | SubClause;
  value: any;
  onChange: (value: any) => void;
  isLocked?: boolean;
  parentValues?: Record<string, any>; // for dependsOn checks
  depth?: number;
}

const fmt = (n: number) =>
  n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

export default function ClauseRenderer({ definition, value, onChange, isLocked = false, parentValues, depth = 0 }: ClauseRendererProps) {
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

  switch (control) {
    case 'yes_no':
      return (
        <div className={`space-y-3 ${depth > 0 ? 'border-l-2 border-muted pl-4' : ''}`}>
          {headingEl}
          <RadioControl
            name={('key' in definition ? definition.key : ('clauseNo' in definition ? definition.clauseNo : 'radio'))}
            options={[{ value: true, label: 'Yes' }, { value: false, label: 'No' }]}
            value={data._value}
            onChange={v => update('_value', v)}
            disabled={isLocked}
          />
          {data._value === false && !definition.subClauses?.length && (
            <div className="p-2 bg-muted rounded text-sm text-muted-foreground">Not Applicable</div>
          )}
          {definition.subClauses?.map(sub => (
            <ClauseRenderer
              key={sub.key}
              definition={sub}
              value={data[sub.key] || {}}
              onChange={v => update(sub.key, v)}
              isLocked={isLocked}
              parentValues={{ ...parentValues, [('key' in definition ? definition.key : '')]: data._value }}
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
            options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'na', label: 'N/A' }]}
            value={data._value}
            onChange={v => update('_value', v)}
            disabled={isLocked}
          />
          {definition.subClauses?.map(sub => (
            <ClauseRenderer
              key={sub.key} definition={sub}
              value={data[sub.key] || {}} onChange={v => update(sub.key, v)}
              isLocked={isLocked}
              parentValues={{ ...parentValues, [('key' in definition ? definition.key : '')]: data._value }}
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
          {definition.subClauses?.map((sub, i) => (
            <div key={sub.key}>
              {i > 0 && <Separator className="my-2" />}
              <ClauseRenderer
                definition={sub}
                value={data[sub.key] || {}}
                onChange={v => update(sub.key, v)}
                isLocked={isLocked}
                parentValues={data}
                depth={depth + 1}
              />
            </div>
          ))}
        </div>
      );

    case 'matrix':
    case 'note_reference':
      // Fallback to simple field for now — these are specialized
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
    columns.forEach(c => { emptyRow[c.key] = ''; });
    onChange([...rows, emptyRow]);
  }

  function removeRow(i: number) {
    onChange(rows.filter((_, idx) => idx !== i));
  }

  function updateCell(ri: number, key: string, val: string) {
    const newRows = rows.map((r, idx) => {
      if (idx !== ri) return r;
      const next = { ...r, [key]: val };

      // Auto-fill TDS nature from section
      const col = columns.find(c => c.key === key);
      if (col?.type === 'dropdown' && col.dropdownRef === 'TDS_SECTIONS') {
        const natureCol = columns.find(c => c.type === 'readonly' && c.key === 'nature');
        if (natureCol) {
          const opt = DROPDOWN_LIBRARY.TDS_SECTIONS?.find(o => o.value === val);
          next.nature = opt ? opt.label.split(' - ')[1] || opt.label : '';
        }
      }

      // Recalculate auto_calc columns
      columns.filter(c => c.type === 'auto_calc' && c.formula).forEach(c => {
        next[c.key] = evaluateFormula(c.formula!, next);
      });

      return next;
    });
    onChange(newRows);
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

  return (
    <div className="space-y-2 overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="text-xs bg-muted/50">
            <TableHead className="w-8 text-xs">Sr</TableHead>
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
              <TableCell colSpan={columns.length + 2} className="text-center text-muted-foreground text-sm py-4">
                No rows — click "+ Add Row" to begin
              </TableCell>
            </TableRow>
          )}
          {rows.map((row, ri) => (
            <TableRow key={ri}>
              <TableCell className="p-1 text-xs text-center text-muted-foreground">{ri + 1}</TableCell>
              {columns.map(col => (
                <TableCell key={col.key} className={`p-1 ${col.type === 'auto_calc' || col.type === 'readonly' ? 'bg-muted/30' : ''}`}>
                  <CellInput
                    column={col}
                    value={row[col.key] ?? ''}
                    onChange={val => updateCell(ri, col.key, val)}
                    disabled={isLocked}
                    row={row}
                  />
                </TableCell>
              ))}
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
              <TableCell className="p-1">Totals</TableCell>
              {columns.map(col => {
                const hasTotal = totalColumns?.includes(col.key);
                const hasAutoTotal = col.type === 'auto_calc';
                if (hasTotal) return <TableCell key={col.key} className="p-1 text-right tabular-nums">{fmt(totals[col.key] || 0)}</TableCell>;
                if (hasAutoTotal) return <TableCell key={col.key} className="p-1 text-right tabular-nums">{fmt(autoCalcTotals[col.key] || 0)}</TableCell>;
                return <TableCell key={col.key} className="p-1" />;
              })}
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
function CellInput({ column, value, onChange, disabled, row }: {
  column: AnnexureColumn;
  value: any;
  onChange: (val: string) => void;
  disabled?: boolean;
  row: Record<string, any>;
}) {
  const displayVal = String(value ?? '');

  switch (column.type) {
    case 'text':
      return <Input value={displayVal} onChange={e => onChange(e.target.value)} className="h-8 text-xs" disabled={disabled} />;

    case 'numeric':
      return <Input type="number" value={displayVal} onChange={e => onChange(e.target.value)} className="h-8 text-xs" disabled={disabled} />;

    case 'date':
      return <Input type="date" value={displayVal} onChange={e => onChange(e.target.value)} className="h-8 text-xs" disabled={disabled} />;

    case 'pan':
      return (
        <Input
          value={displayVal}
          onChange={e => onChange(e.target.value.toUpperCase())}
          className="h-8 text-xs font-mono"
          maxLength={10}
          placeholder="AAAPZ1234C"
          disabled={disabled}
        />
      );

    case 'dropdown': {
      const options = resolveDropdownOptions(column);
      return (
        <Select value={displayVal} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select" /></SelectTrigger>
          <SelectContent className="max-h-60">
            {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }

    case 'yes_no_dropdown':
      return (
        <Select value={displayVal} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="Y">Yes</SelectItem>
            <SelectItem value="N">No</SelectItem>
          </SelectContent>
        </Select>
      );

    case 'auto_calc': {
      const computed = column.formula ? evaluateFormula(column.formula, row) : 0;
      return (
        <span className="text-xs font-semibold text-right block pr-1">
          {typeof computed === 'number' ? fmt(computed) : String(computed)}
        </span>
      );
    }

    case 'readonly':
      return <span className="text-xs text-muted-foreground block pr-1">{displayVal || '—'}</span>;

    default:
      return <Input value={displayVal} onChange={e => onChange(e.target.value)} className="h-8 text-xs" disabled={disabled} />;
  }
}
