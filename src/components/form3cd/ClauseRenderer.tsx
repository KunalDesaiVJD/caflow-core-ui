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
import { DROPDOWN_LIBRARY, BUSINESS_SECTORS, BUSINESS_SUBSECTORS } from "@/data/form3cd-dropdowns";

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
          {definition.subClauses?.map(sub => (
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
              <TableCell className="p-1 text-center">—</TableCell>
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
function CellInput({ column, value, onChange, disabled, row }: {
  column: AnnexureColumn;
  value: any;
  onChange: (val: string) => void;
  disabled?: boolean;
  row?: Record<string, any>;
}) {
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
