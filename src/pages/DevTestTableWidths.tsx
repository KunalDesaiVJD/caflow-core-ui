import { useLayoutEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Clock, ArrowRight, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const FILING_STATUSES = [
  "Not Started", "Data Awaited", "Under Process", "Reviewed", "Filed", "Processed",
];
const FILING_STATUS_COLORS: Record<string, string> = {
  "Not Started": "bg-muted text-muted-foreground",
  "Data Awaited": "bg-yellow-100 text-yellow-800",
  "Under Process": "bg-blue-100 text-blue-800",
  "Reviewed": "bg-purple-100 text-purple-800",
  "Filed": "bg-green-100 text-green-800",
  "Processed": "bg-emerald-100 text-emerald-800",
};

const ROWS = [
  { id: "1", client: "SHIVASHRAY DEVELOPERS", status: "Not Started", date: "", ack: "", prepared: "—", filed: "—" },
  { id: "2", client: "SHIVASHRAY DEVELOPERS (P) LTD", status: "Filed", date: "2026-07-10", ack: "ABCDE1234F", prepared: "Priya Sharma", filed: "Kunal Desai" },
  { id: "3", client: "ABC TRADERS", status: "Reviewed", date: "", ack: "", prepared: "Rahul Mehta", filed: "—" },
  { id: "4", client: "XYZ PRIVATE LIMITED", status: "Processed", date: "2026-07-12", ack: "XYZAB9988C", prepared: "A", filed: "Siddharth Venkataraman" },
];

export default function DevTestTableWidths() {
  const statusMeasureRef = useRef<HTMLSpanElement>(null);
  const [statusColWidth, setStatusColWidth] = useState(180);

  useLayoutEffect(() => {
    const statusEl = statusMeasureRef.current;
    if (!statusEl) return;
    const sampleStatus = document.querySelector('[data-autofit="status"]');
    if (sampleStatus) statusEl.style.font = getComputedStyle(sampleStatus).font;
    const STATUS_PADDING = 34 + 16 + 8;
    let maxStatus = 0;
    for (const text of FILING_STATUSES) {
      statusEl.textContent = text;
      maxStatus = Math.max(maxStatus, statusEl.getBoundingClientRect().width);
    }
    setStatusColWidth(Math.ceil(maxStatus) + STATUS_PADDING);
  }, []);

  return (
    <div className="p-6">
      <span ref={statusMeasureRef} className="absolute -left-[9999px] top-0 whitespace-nowrap" aria-hidden />
      <h1 className="text-lg font-semibold mb-4">Dev Test — Client Filing Summary column widths</h1>
      <div className="rounded-md border">
        <div className="overflow-x-auto">
          <Table className="w-auto" style={{ tableLayout: "fixed", minWidth: 40 + 260 + statusColWidth + 160 + 160 + 112 + 112 + 100 }}>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox checked={false} />
                </TableHead>
                <TableHead className="w-[260px] sticky left-0 bg-background z-10">Client</TableHead>
                <TableHead style={{ width: statusColWidth, minWidth: statusColWidth }}>Status</TableHead>
                <TableHead className="w-40">Filing Date</TableHead>
                <TableHead className="w-40">Ack No</TableHead>
                <TableHead className="w-28">Prepared By</TableHead>
                <TableHead className="w-28">Filed By</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ROWS.map(f => (
                <TableRow key={f.id}>
                  <TableCell>
                    <Checkbox checked={false} />
                  </TableCell>
                  <TableCell className="font-medium sticky left-0 bg-background">
                    <span className="inline-block max-w-[260px] cursor-default">
                      {f.client}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Select value={f.status}>
                      <SelectTrigger className="h-7 text-xs" style={{ width: statusColWidth }}>
                        <Badge data-autofit="status" className={cn("text-xs", FILING_STATUS_COLORS[f.status] || "bg-muted")}>{f.status}</Badge>
                      </SelectTrigger>
                      <SelectContent>
                        {FILING_STATUSES.map(s => (
                          <SelectItem key={s} value={s}><span>{s}</span></SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input type="date" className="h-7 w-32 text-xs bg-muted cursor-not-allowed opacity-70" value={f.date} disabled />
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <Input className="h-7 w-32 text-xs" defaultValue={f.ack} />
                      <div className="flex items-center gap-1 flex-wrap">
                        {!f.ack && (
                          <label className="text-[9px] text-muted-foreground cursor-pointer">
                            📎 Attach ACK
                          </label>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className={cn("text-xs", f.prepared === "—" && "text-muted-foreground")}>{f.prepared}</span>
                  </TableCell>
                  <TableCell>
                    <span className={cn("text-xs", f.filed === "—" && "text-muted-foreground")}>{f.filed}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-0.5">
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="History"><Clock size={14} /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Go to Data Entry"><ArrowRight size={14} /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
