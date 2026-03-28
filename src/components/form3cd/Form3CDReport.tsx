// Form3CDReport.tsx — Printable A4 report renderer
// Reads ALL headings, sequences and column definitions from FORM_3CD_CLAUSES master.
// Single change to master = both form UI and report update simultaneously.

import { useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Printer, Download, X } from "lucide-react";
import { FORM_3CD_CLAUSES } from "@/data/form3cd-clauses";
import type { ClauseDefinition, SubClause, AnnexureColumn } from "@/data/form3cd-master";
import { exportToPdf } from "@/lib/exportUtils";

interface Form3CDReportProps {
  clauseData: Record<string, any>;
  client: any;
  engagement: any;
  fy: string;
  ay: string;
  onClose: () => void;
}

function computeFYDates(fy: string | null): { from: string; to: string } {
  if (!fy) return { from: "", to: "" };
  const match = fy.match(/(\d{4})/);
  if (!match) return { from: "", to: "" };
  const start = parseInt(match[1]);
  return { from: `01/04/${start}`, to: `31/03/${start + 1}` };
}

const fmtIndian = (n: number | string | undefined | null): string => {
  if (n === undefined || n === null || n === '') return '—';
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (isNaN(num)) return String(n);
  return num.toLocaleString('en-IN');
};

export default function Form3CDReport({ clauseData, client, engagement, fy, ay, onClose }: Form3CDReportProps) {
  const printRef = useRef<HTMLDivElement>(null);

  // Active clauses sorted by displayOrder — from master
  const activeClauses = useMemo(() =>
    FORM_3CD_CLAUSES
      .filter(c => c.isActive)
      .sort((a, b) => a.displayOrder - b.displayOrder),
    []
  );

  function clauseStateKey(clauseNo: string): string {
    return `cl_${clauseNo}`;
  }

  // Render a table from annexureColumns definition + rows data
  function renderAnnexureTable(columns: AnnexureColumn[], rows: any[]): React.ReactNode {
    if (!rows || rows.length === 0) return <p className="rpt-nil">NIL</p>;
    return (
      <table className="rpt-table">
        <thead>
          <tr>
            <th style={{ width: 40 }}>S.No.</th>
            {columns.map(col => (
              <th key={col.key}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row: any, ri: number) => (
            <tr key={ri} className={ri % 2 === 1 ? "rpt-row-alt" : ""}>
              <td style={{ textAlign: 'center' }}>{ri + 1}</td>
              {columns.map(col => (
                <td key={col.key}>
                  {col.type === 'numeric' ? fmtIndian(row[col.key]) : String(row[col.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  // Render sub-clauses recursively
  function renderSubClause(sub: SubClause, data: any, depth: number = 0): React.ReactNode {
    const val = data?.[sub.key] ?? data;
    const indent = depth > 0 ? { marginLeft: depth * 16 } : {};

    if (sub.control === 'heading_only') {
      return (
        <div key={sub.key} style={indent} className="rpt-subclause">
          <p className="font-semibold text-xs">{sub.heading}</p>
        </div>
      );
    }

    // Yes/No controls
    if (['yes_no', 'yes_no_na', 'yes_no_notdue', 'yes_no_text', 'yes_no_structured'].includes(sub.control)) {
      const answer = val?._value ?? val;
      const display = answer === true ? 'Yes' : answer === false ? 'No' : answer === 'notdue' ? 'Not Due' : String(answer ?? 'N/A');
      return (
        <div key={sub.key} style={indent} className="rpt-subclause">
          <p className="rpt-field"><strong>{sub.heading}:</strong> {display}</p>
          {sub.subClauses?.map(child => renderSubClause(child, val, depth + 1))}
        </div>
      );
    }

    // Tables
    if (sub.annexureColumns && Array.isArray(val?._rows)) {
      return (
        <div key={sub.key} style={indent} className="rpt-subclause">
          <p className="font-semibold text-xs mb-1">{sub.heading}</p>
          {renderAnnexureTable(sub.annexureColumns, val._rows)}
        </div>
      );
    }

    // Single field / dropdown
    if (['single_field', 'dropdown'].includes(sub.control)) {
      const display = val?._value ?? val;
      return (
        <div key={sub.key} style={indent} className="rpt-subclause">
          <p className="rpt-field"><strong>{sub.heading}:</strong> {display ? String(display) : 'NIL'}</p>
        </div>
      );
    }

    // Composite or other — render children
    if (sub.subClauses) {
      return (
        <div key={sub.key} style={indent} className="rpt-subclause">
          <p className="font-semibold text-xs mb-1">{sub.heading}</p>
          {sub.subClauses.map(child => renderSubClause(child, val, depth + 1))}
        </div>
      );
    }

    // Fallback: show raw value
    const raw = val?._value ?? val;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return (
        <div key={sub.key} style={indent} className="rpt-subclause">
          <p className="font-semibold text-xs">{sub.heading}</p>
          {Object.entries(raw).filter(([k]) => !k.startsWith('_')).map(([k, v]) => (
            <p key={k} className="rpt-field"><strong>{k.replace(/_/g, ' ')}:</strong> {String(v ?? '')}</p>
          ))}
        </div>
      );
    }

    return (
      <div key={sub.key} style={indent} className="rpt-subclause">
        <p className="rpt-field"><strong>{sub.heading}:</strong> {raw != null ? String(raw) : 'NIL'}</p>
      </div>
    );
  }

  // Render full clause content from clauseData + master definition
  function renderClauseContent(clause: ClauseDefinition, data: any): React.ReactNode {
    if (!data || Object.keys(data).length === 0) return <p className="rpt-nil">NIL / Not Applicable</p>;

    const hasContent = Object.values(data).some(v => {
      if (typeof v === "string") return v.trim().length > 0;
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === "boolean") return true;
      if (typeof v === "number") return true;
      return v !== null && v !== undefined;
    });
    if (!hasContent) return <p className="rpt-nil">NIL / Not Applicable</p>;

    const elements: React.ReactNode[] = [];

    // Top-level _value (yes/no answer)
    if (data._value !== undefined) {
      const v = data._value;
      const display = v === true ? 'Yes' : v === false ? 'No' : v === 'notdue' ? 'Not Due' : String(v);
      elements.push(<p key="_val" className="rpt-field"><strong>Answer:</strong> {display}</p>);
    }

    if (data._notApplicable === true) {
      elements.push(<p key="_na" className="rpt-nil">Not Applicable</p>);
    }

    // Top-level rows (annexure data)
    if (Array.isArray(data._rows) && data._rows.length > 0 && clause.annexureColumns) {
      elements.push(
        <div key="_rows">{renderAnnexureTable(clause.annexureColumns, data._rows)}</div>
      );
    } else if (Array.isArray(data._rows) && data._rows.length > 0) {
      // Fallback: render rows using their own keys as columns
      const cols = Object.keys(data._rows[0]);
      elements.push(
        <table key="_rows_fb" className="rpt-table">
          <thead><tr>{cols.map(c => <th key={c}>{c.replace(/_/g, ' ')}</th>)}</tr></thead>
          <tbody>
            {data._rows.map((row: any, ri: number) => (
              <tr key={ri} className={ri % 2 === 1 ? "rpt-row-alt" : ""}>
                {cols.map(c => <td key={c}>{String(row[c] ?? '')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    // Sub-clauses from master definition
    if (clause.subClauses) {
      clause.subClauses.forEach(sub => {
        elements.push(renderSubClause(sub, data, 0));
      });
    }

    // Any remaining string fields not already rendered
    Object.entries(data).forEach(([k, v]) => {
      if (k.startsWith('_')) return;
      if (k === 'remarks') return; // render separately
      if (typeof v === 'string' && v.trim()) {
        elements.push(<p key={k} className="rpt-field"><strong>{k.replace(/_/g, ' ')}:</strong> {v}</p>);
      } else if (typeof v === 'boolean') {
        elements.push(<p key={k} className="rpt-field"><strong>{k.replace(/_/g, ' ')}:</strong> {v ? 'Yes' : 'No'}</p>);
      }
    });

    // Remarks
    if (data.remarks && String(data.remarks).trim()) {
      elements.push(
        <p key="_remarks" className="rpt-field" style={{ marginTop: 4 }}>
          <strong>Remarks:</strong> {data.remarks}
        </p>
      );
    }

    return elements.length > 0 ? <div className="rpt-clause-content">{elements}</div> : <p className="rpt-nil">NIL</p>;
  }

  const fyDates = computeFYDates(fy);

  return (
    <div className="fixed inset-0 z-[100] bg-background overflow-auto print:static print:overflow-visible">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 bg-background border-b px-6 py-3 flex items-center justify-between print:hidden">
        <h2 className="text-lg font-bold">Form 3CD — Report Preview</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-1" /> Print
          </Button>
          <Button variant="outline" size="sm" onClick={() => {
            if (printRef.current) exportToPdf(printRef.current, `Form-3CD_${client?.name || 'report'}_${fy}.pdf`);
          }}>
            <Download className="h-4 w-4 mr-1" /> Export PDF
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4 mr-1" /> Close
          </Button>
        </div>
      </div>

      {/* Report body */}
      <div ref={printRef} className="print-view max-w-4xl mx-auto p-8 print:p-0 print:max-w-none">
        <style>{`
          @media print {
            body * { visibility: hidden; }
            .print-view, .print-view * { visibility: visible; }
            .print-view { position: absolute; left: 0; top: 0; width: 100%; }
            @page { size: A4 portrait; margin: 2cm; }
          }
          .rpt-table { width: 100%; border-collapse: collapse; font-size: 10px; margin: 6px 0; }
          .rpt-table th, .rpt-table td { border: 1px solid hsl(var(--border)); padding: 3px 6px; text-align: left; vertical-align: top; }
          .rpt-table th { background: hsl(var(--muted)); font-weight: 600; font-size: 9px; }
          .rpt-row-alt { background: hsl(var(--muted) / 0.3); }
          .rpt-clause { margin-bottom: 16px; border-bottom: 1px solid hsl(var(--border)); padding-bottom: 12px; page-break-inside: avoid; }
          .rpt-nil { color: hsl(var(--muted-foreground)); font-style: italic; font-size: 11px; }
          .rpt-field { margin: 2px 0; font-size: 11px; }
          .rpt-subclause { margin: 4px 0; }
          .rpt-clause-content { margin-top: 4px; }
          @media print {
            .rpt-table th { background: #f0f0f0 !important; }
            .rpt-table th, .rpt-table td { border-color: #999 !important; }
            .rpt-row-alt { background: #f9f9f9 !important; }
            .rpt-nil { color: #888 !important; }
            .rpt-clause { border-color: #ccc !important; }
          }
        `}</style>

        {/* HEADER */}
        <div className="text-center mb-6">
          <h1 className="text-lg font-bold">FORM NO. 3CD</h1>
          <p className="text-xs text-muted-foreground">[See rule 6G(2)]</p>
          <p className="text-sm mt-1">Statement of particulars required to be furnished under section 44AB of the Income-tax Act, 1961</p>
        </div>

        <Separator className="my-3" />

        {/* Page Header Info */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs mb-4">
          <p><strong>Name of Assessee:</strong> {client?.name || '—'}</p>
          <p><strong>PAN:</strong> <span className="font-mono">{client?.pan || '—'}</span></p>
          <p><strong>Address:</strong> {client?.address || client?.registered_office || '—'}</p>
          <p><strong>Status:</strong> {client?.entity_type || engagement?.entity_type || '—'}</p>
          <p><strong>Previous Year:</strong> {fyDates.from ? `${fyDates.from} to ${fyDates.to}` : fy}</p>
          <p><strong>Assessment Year:</strong> {ay}</p>
        </div>

        <Separator className="my-3" />

        {/* Clauses 1-7 as table */}
        <div className="rpt-clause">
          <h3 className="font-bold text-xs mb-2">PART A — GENERAL INFORMATION (Clauses 1–7)</h3>
          <table className="rpt-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>Cl.</th>
                <th>Particulars</th>
                <th style={{ width: '40%' }}>Details</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>1</td><td>Name of the assessee</td><td>{client?.name || '—'}</td></tr>
              <tr className="rpt-row-alt"><td>2</td><td>Address</td><td>{client?.address || client?.registered_office || '—'}</td></tr>
              <tr><td>3</td><td>Permanent Account Number</td><td className="font-mono">{client?.pan || '—'}</td></tr>
              <tr className="rpt-row-alt"><td>4</td><td>Whether the assessee is liable to pay indirect tax?</td><td>{clauseData['cl_8']?._cl17?.indirectTaxLiable === true ? `Yes — ${clauseData['cl_8']?._cl17?.indirectTaxDetails || ''}` : clauseData['cl_8']?._cl17?.indirectTaxLiable === false ? 'No' : '—'}</td></tr>
              <tr><td>5</td><td>Status</td><td>{client?.entity_type || clauseData['cl_8']?._cl17?.statusOverride || '—'}</td></tr>
              <tr className="rpt-row-alt"><td>6</td><td>Previous year</td><td>{fyDates.from ? `${fyDates.from} to ${fyDates.to}` : '—'}</td></tr>
              <tr><td>7</td><td>Assessment Year</td><td>{ay || '—'}</td></tr>
            </tbody>
          </table>
        </div>

        {/* ALL CLAUSES 8+ — from master */}
        {activeClauses.map(c => {
          const key = clauseStateKey(c.clauseNo);
          const data = clauseData[key] || {};
          return (
            <div key={c.clauseNo} className="rpt-clause">
              <h3 className="font-bold text-xs mb-1">
                Clause {c.clauseNo.replace('_', '-')}: {c.heading}
              </h3>
              {renderClauseContent(c, data)}
            </div>
          );
        })}

        {/* DECLARATION / SIGNATURE BLOCK */}
        <div style={{ pageBreakBefore: 'always', marginTop: 40, paddingTop: 24, borderTop: '2px solid hsl(var(--border))' }}>
          <h3 className="font-bold text-center text-sm mb-6">DECLARATION</h3>
          <p className="text-xs mb-8 leading-relaxed">
            I/We have examined the accounts and records of <strong>{client?.name || '________'}</strong>{' '}
            (PAN: <span className="font-mono">{client?.pan || '________'}</span>) for the previous year{' '}
            {fy || '________'} relevant to the Assessment Year {ay || '________'}, and certify that the
            information given above is true and correct to the best of my/our knowledge and belief.
          </p>
          <div className="grid grid-cols-2 gap-8 text-xs mt-12">
            <div className="space-y-6">
              <div className="border-b border-dashed pb-1"><strong>Name of the Chartered Accountant:</strong> ___________________________</div>
              <div className="border-b border-dashed pb-1"><strong>Membership Number:</strong> ___________________________</div>
              <div className="border-b border-dashed pb-1"><strong>FRN:</strong> ___________________________</div>
            </div>
            <div className="space-y-6">
              <div className="border-b border-dashed pb-1"><strong>Date:</strong> ___________________________</div>
              <div className="border-b border-dashed pb-1"><strong>Place:</strong> ___________________________</div>
              <div className="border-b border-dashed pb-1"><strong>UDIN:</strong> ___________________________</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
