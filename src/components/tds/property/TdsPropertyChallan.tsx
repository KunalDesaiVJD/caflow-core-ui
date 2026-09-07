/**
 * Attach the paid challan, and check it.
 *
 * After the tax is paid the department returns two PDFs — a Challan Receipt
 * and the Form 141 Challan-cum-statement. This panel reads both, cross-checks
 * them against each other, and reconciles them against what the engine
 * computed for the matching payment.
 *
 * No model call: both documents are machine-generated with clean text layers
 * and a fixed vocabulary, so src/lib/tds/form141Challan.ts parses them
 * deterministically. Free, instant, byte-exact, and pinned in tests against
 * the real filed pair.
 *
 * The check that earns this panel its place is the SHORT PAYMENT: a challan
 * carrying less interest or fee than the transaction requires looks like a
 * completed payment on screen and in the file, and nothing else in the chain
 * would ever compare the two figures.
 */
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, Loader2, CheckCircle2, AlertCircle, AlertTriangle, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";

import { pdfToTextPages } from "@/lib/tds/pdfText";
import {
  parseForm141Challan,
  mergeChallanDocuments,
  reconcileChallan,
  challanPeriod,
  type ChallanFields,
  type MergedChallan,
} from "@/lib/tds/form141Challan";
import type { Form141Statement } from "@/lib/tds/form141ScheduleB";
import type { Form141Finding } from "@/lib/tds/form141Validate";
import { formatInr } from "./propertyDeal";

interface Props {
  statements: Form141Statement[];
  filingBuyerPan: string | null;
  clientName: string | null;
  /** Records the challan against a payment: sets its deposit/filing dates so
   *  the engine's interest and fee recompute, and stores the government's own
   *  identifiers on save. */
  onAttach: (instalmentSeq: number, fields: ChallanFields) => void;
  attached: Record<number, ChallanFields>;
}

/**
 * pdfjs returns positioned runs, not lines. Group them into visual rows by y
 * (the same 4px tolerance ackPdf.ts uses) and read each row left to right, so
 * the parser sees the document the way a person does.
 */
const Y_TOL = 4;
async function fileToText(file: File): Promise<string> {
  const pages = await pdfToTextPages(file);
  return pages
    .map((items) => {
      const rows = new Map<number, { x: number; str: string }[]>();
      for (const it of items) {
        const key = Math.round(it.y / Y_TOL) * Y_TOL;
        if (!rows.has(key)) rows.set(key, []);
        rows.get(key)!.push({ x: it.x, str: it.str });
      }
      return [...rows.entries()]
        .sort((a, b) => b[0] - a[0]) // pdf y grows upward
        .map(([, row]) => row.sort((a, b) => a.x - b.x).map((r) => r.str).join(" ").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

export function TdsPropertyChallan({ statements, filingBuyerPan, clientName, onAttach, attached }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [merged, setMerged] = useState<MergedChallan | null>(null);
  const [fileNames, setFileNames] = useState<string[]>([]);

  const handleFiles = async (files: FileList) => {
    setReading(true);
    try {
      const parsed: ChallanFields[] = [];
      const names: string[] = [];
      for (const file of Array.from(files)) {
        if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
          toast.error(`${file.name} is not a PDF. Upload the challan receipt or the Form 141 statement as downloaded.`);
          continue;
        }
        const text = await fileToText(file);
        const fields = parseForm141Challan(text);
        if (fields.documentKind === "unknown" && !fields.cin) {
          // An image-only scan yields nothing. Say so rather than silently
          // producing an all-null result that reconciles cleanly against
          // everything.
          toast.error(`${file.name} has no readable text layer. Download the challan again from the portal rather than scanning a printout.`);
          continue;
        }
        parsed.push(fields);
        names.push(file.name);
      }
      if (!parsed.length) return;

      const result = parsed.length > 1
        ? mergeChallanDocuments(parsed[0], parsed[1])
        : { fields: parsed[0], conflicts: [] as MergedChallan["conflicts"] };
      setMerged(result);
      setFileNames(names);
      toast.success(`Read ${names.join(" and ")}.`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "The challan could not be read.");
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  // Which computed payment does this challan belong to? Matched on the
  // period the document itself states, never on upload order.
  const period = merged ? challanPeriod(merged.fields) : null;
  const target = merged
    ? statements.find((s) => s.taxYear === period?.taxYear && s.month === period?.month) ?? null
    : null;

  const findings: Form141Finding[] = merged && target
    ? reconcileChallan(merged.fields, target, { filingBuyerPan, clientName }, merged.conflicts)
    : [];
  const blocking = findings.filter((f) => f.severity === "blocking");

  const attachedCount = Object.keys(attached).length;

  return (
    <Card>
      <CardContent className="pt-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">Paid challan</h3>
            <p className="text-xs text-muted-foreground">
              Upload the challan receipt and the Form 141 statement together. They are checked against each
              other and against the tax computed here — including whether the interest and fee actually paid
              cover what is due.
            </p>
          </div>
          <input
            ref={inputRef} type="file" accept="application/pdf" multiple className="hidden"
            onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); }}
          />
          <Button size="sm" variant="outline" disabled={reading || !statements.length} onClick={() => inputRef.current?.click()}>
            {reading ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Upload size={14} className="mr-1.5" />}
            {reading ? "Reading…" : "Upload challan"}
          </Button>
        </div>

        {!statements.length && (
          <p className="text-xs text-muted-foreground">
            Record the payment above first — there is nothing to reconcile a challan against yet.
          </p>
        )}

        {attachedCount > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(attached).map(([seq, f]) => (
              <Badge key={seq} variant="outline" className="text-[10px] font-mono">
                <Paperclip size={10} className="mr-1" />
                Payment {seq} · {f.cin || f.acknowledgementNumber}
              </Badge>
            ))}
          </div>
        )}

        {merged && (
          <div className="rounded-md border p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium truncate">{fileNames.join(" + ")}</span>
              {target
                ? <Badge variant="outline" className="text-[10px] shrink-0">Payment {target.instalmentSeq} · {target.month}</Badge>
                : <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 text-[10px] shrink-0">No matching payment</Badge>}
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              {([
                ["CIN", merged.fields.cin],
                ["Acknowledgement", merged.fields.acknowledgementNumber],
                ["BSR / Challan", [merged.fields.bsrCode, merged.fields.challanNo].filter(Boolean).join(" / ") || null],
                ["Deposited", merged.fields.dateOfDeposit],
                ["Tax", merged.fields.amountDeducted !== null ? formatInr(merged.fields.amountDeducted) : null],
                ["Interest + fee", merged.fields.interest !== null ? `${formatInr(merged.fields.interest)} + ${formatInr(merged.fields.fee)}` : null],
              ] as [string, string | null][]).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-2 min-w-0">
                  <dt className="text-muted-foreground shrink-0">{label}</dt>
                  <dd className="font-mono truncate">{value ?? "—"}</dd>
                </div>
              ))}
            </dl>

            {!target && period && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                This challan is for {period.month || "an unstated period"} in {period.taxYear || "an unstated Tax Year"},
                which does not match any payment recorded above. Check the payment dates, or that the right challan
                was uploaded.
              </p>
            )}

            {findings.length === 0 && target && (
              <p className="text-xs flex items-start gap-1.5 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 size={13} className="shrink-0 mt-0.5" />
                Everything on the challan matches the computation — identifiers, head codes, period and every amount.
              </p>
            )}

            <ul className="space-y-1.5">
              {findings.map((f, i) => (
                <li key={`${f.code}-${i}`} className="flex items-start gap-1.5 text-xs">
                  {f.severity === "blocking"
                    ? <AlertCircle size={13} className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                    : <AlertTriangle size={13} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />}
                  <span className={cn(f.severity === "blocking" && "text-foreground")}>{f.message}</span>
                </li>
              ))}
            </ul>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={!target || blocking.length > 0}
                onClick={() => {
                  if (!target) return;
                  onAttach(target.instalmentSeq, merged.fields);
                  setMerged(null);
                  setFileNames([]);
                  toast.success(`Challan attached to payment ${target.instalmentSeq}.`);
                }}
              >
                Attach to payment {target?.instalmentSeq ?? ""}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setMerged(null); setFileNames([]); }}>
                Discard
              </Button>
              {blocking.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  Resolve the {blocking.length} blocking finding{blocking.length === 1 ? "" : "s"} first.
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
