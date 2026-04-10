/**
 * AuditStatusFilters
 * Toolbar: global search + quick-filter dropdowns + refresh + add-row.
 * The parent AuditStatusGrid owns all state; this component is pure-presentational.
 */
import { Input }  from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, RefreshCw, Plus } from "lucide-react";

// ─── Exported constant ────────────────────────────────────────────────────────

export const AUDIT_STATUS_OPTIONS = [
  "DATA PENDING",
  "QUERIES GIVEN TO CLIENT",
  "PREPARE PENDING",
  "VERIFICATION PENDING",
  "REPORT WITH VJD",
  "REPORT WITH KVD",
  "REPORT SENT TO CLIENT",
  "REPORT SIGNED",
  "OTHERS (SPECIFY)",
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  search:        string;
  onSearch:      (v: string) => void;
  statusFilter:  string;
  onStatus:      (v: string) => void;
  onRefresh:     () => void;
  onAddRow:      () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AuditStatusFilters({
  search, onSearch,
  statusFilter, onStatus,
  onRefresh, onAddRow,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">

      {/* Global search */}
      <div className="relative flex-1 min-w-[180px] max-w-xs">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          className="pl-7 h-8 text-xs"
          placeholder="Search all columns…"
          value={search}
          onChange={e => onSearch(e.target.value)}
        />
      </div>

      {/* Audit Status quick-filter */}
      <Select value={statusFilter} onValueChange={onStatus}>
        <SelectTrigger className="h-8 text-xs w-40">
          <SelectValue placeholder="All Statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" className="text-xs">All Statuses</SelectItem>
          {AUDIT_STATUS_OPTIONS.map(s => (
            <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Refresh */}
      <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={onRefresh} title="Refresh">
        <RefreshCw size={13} />
      </Button>

      {/* Add row — pushed right */}
      <div className="ml-auto">
        <Button
          size="sm"
          className="gap-1.5 h-8 text-xs bg-indigo-600 hover:bg-indigo-700"
          onClick={onAddRow}
        >
          <Plus size={13} /> Add New Audit
        </Button>
      </div>
    </div>
  );
}
