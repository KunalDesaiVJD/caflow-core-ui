/**
 * Upload a sale agreement, get a proposed transaction.
 *
 * The panel that makes the property module worth using: a registered or draft
 * deed goes in, and the editor below it comes back pre-filled. What it
 * deliberately does NOT do is commit anything — every figure it proposes
 * lands in the same fields a manual entry uses and passes the same validation
 * gate, and the panel's real job is to show its working so a preparer can
 * check it rather than trust it.
 *
 * Three things are on screen after a read, and each answers a question a CA
 * would otherwise have to ask by hand:
 *
 *   • What did it read, and from where — each figure carries the page and the
 *     source snippet it came from, so confirming means glancing at the deed
 *     rather than re-keying it.
 *   • What is it unsure about — medium-confidence readings are pre-filled but
 *     flagged; low-confidence readings of a figure that drives tax are left
 *     out entirely, because an empty box gets noticed and a plausible wrong
 *     number does not.
 *   • What does it need answered — the model's own questions, as a checklist
 *     beside the evidence that raised them. Not a chat: an unresolved blocking
 *     question is just another blocking finding in the panel below.
 */
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Upload, FileText, Loader2, CheckCircle2, AlertCircle, HelpCircle, Eye } from "lucide-react";
import { cn } from "@/lib/utils";

import {
  applyExtraction,
  resolveQuery,
  confirmField,
  openQueries,
  blockingQueries,
  FIELD_LABEL,
  type AgreementExtraction,
  type AppliedExtraction,
  type ResolvedQuery,
  type FieldProvenance,
} from "./agreementExtraction";
import { sanitizeStorageName } from "@/lib/storagePath";
import type { PropertyDealBundle } from "./propertyDeal";

/** What the module needs to persist a tds_property_documents row on save. */
export interface StoredDocument {
  fileUrl: string;
  fileName: string;
  mimeType: string;
  docKind: "sale_agreement" | "index_ii";
  extractionJson: unknown;
}

/**
 * Keep the original file, best-effort.
 *
 * Non-blocking by design, exactly like uploadTdsImportFile: a storage hiccup
 * must never lose an extraction the user already waited for. The reading is
 * the primary value; being able to open the deed again later is the
 * secondary one.
 */
async function storeAgreement(file: File, clientId: string): Promise<string | null> {
  try {
    const path = `tds-property/${clientId}/${Date.now()}_${sanitizeStorageName(file.name)}`;
    const { error } = await supabase.storage.from("documents").upload(path, file);
    if (error) return null;
    return supabase.storage.from("documents").getPublicUrl(path).data.publicUrl || null;
  } catch {
    return null;
  }
}

/** Base64 inflates a file by a third, and the API caps a request at 32 MB.
 *  Refusing early with a clear reason beats a 413 the user cannot interpret. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/**
 * Say what actually went wrong with the invoke.
 *
 * The failure that matters most here is the function not being DEPLOYED. The
 * Supabase client reports that as a generic transport error ("Failed to send a
 * request to the Edge Function"), which reads like a network problem and sends
 * whoever hits it looking in the wrong place entirely — the code is fine, the
 * key is fine, the function simply is not on the project yet.
 *
 * Every other case reaches here already worded by the function itself (no
 * credits, key rejected, model withdrawn, scan unreadable), so it is passed
 * through rather than re-summarised.
 */
function describeInvokeError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  if (/failed to send a request|failed to fetch|not found|404/i.test(raw)) {
    return "The document reader is not deployed on this project yet. Run `npx supabase functions deploy property-agreement-extract` from a local session, then try again. You can enter the details manually in the meantime.";
  }
  return raw || "The document could not be read.";
}

interface Props {
  bundle: PropertyDealBundle;
  provenance: Record<string, FieldProvenance>;
  queries: ResolvedQuery[];
  onExtracted: (applied: AppliedExtraction, doc: StoredDocument | null) => void;
  onProvenanceChange: (next: Record<string, FieldProvenance>) => void;
  onQueriesChange: (next: ResolvedQuery[]) => void;
}

/** File → base64 payload, without the data: prefix the API rejects. */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("The file could not be read from disk."));
    reader.readAsDataURL(file);
  });
}

export function TdsPropertyUpload({
  bundle, provenance, queries, onExtracted, onProvenanceChange, onQueriesChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ needsConfirmation: string[]; withheld: string[] } | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [showEvidence, setShowEvidence] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    if (file.size > MAX_FILE_BYTES) {
      toast.error(`${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. The reader accepts files up to 20 MB — split the document or upload just the pages with the consideration, parties and stamp duty value.`);
      return;
    }
    setReading(true);
    setFileName(file.name);
    try {
      const b64 = await toBase64(file);
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      const { data, error } = await supabase.functions.invoke("property-agreement-extract", {
        body: {
          doc_kind: "sale_agreement",
          file_name: file.name,
          ...(isPdf ? { pdf_base64: b64 } : { image_base64: b64, image_media_type: file.type || "image/png" }),
        },
      });
      if (error) throw error;

      const extraction = data as AgreementExtraction;
      if (extraction.extraction_status === "failed") {
        toast.error(extraction.error || "The document could not be read. Enter the details manually.");
        setSummary(null);
        return;
      }
      if (extraction.extraction_status === "not_a_property_document") {
        // Stop before extracting anything. A rent agreement half-read into a
        // property transaction is worse than no reading at all.
        onQueriesChange(applyExtraction(extraction, bundle).queries);
        toast.warning(
          extraction.document_kind === "unreadable"
            ? "This scan is too poor to read. Try a clearer copy, or enter the details manually."
            : "This does not look like a property transfer document. See the question below.",
        );
        setSummary(null);
        return;
      }

      const applied = applyExtraction(extraction, bundle);
      const fileUrl = await storeAgreement(file, bundle.transaction.client_id);
      onExtracted(
        applied,
        fileUrl
          ? {
              fileUrl,
              fileName: file.name,
              mimeType: file.type || (isPdf ? "application/pdf" : "image/png"),
              docKind: "sale_agreement",
              extractionJson: extraction,
            }
          : null,
      );
      setSummary({ needsConfirmation: applied.needsConfirmation, withheld: applied.withheld });

      const open = openQueries(applied.queries).length;
      toast.success(
        open > 0
          ? `Read ${file.name}. ${open} question${open === 1 ? "" : "s"} to answer below.`
          : `Read ${file.name}. Check the figures against the document before filing.`,
      );
    } catch (e: unknown) {
      toast.error(describeInvokeError(e));
      setSummary(null);
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const open = openQueries(queries);
  const blocking = blockingQueries(queries);
  const unconfirmed = Object.entries(provenance).filter(([, p]) => p.needsConfirmation);

  return (
    <Card>
      <CardContent className="pt-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">Read from the agreement</h3>
            <p className="text-xs text-muted-foreground">
              Upload the registered or draft sale agreement. Every figure it reads is checked against the
              same rules a typed one is — nothing is filed on the reading alone.
            </p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
          <Button
            size="sm" variant="outline" disabled={reading}
            onClick={() => inputRef.current?.click()}
          >
            {reading ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Upload size={14} className="mr-1.5" />}
            {reading ? "Reading…" : "Upload agreement"}
          </Button>
        </div>

        {fileName && !reading && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <FileText size={12} /> {fileName}
          </p>
        )}

        {/* What it withheld, and why — the empty boxes explained. */}
        {summary && summary.withheld.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 p-3">
            <p className="text-xs font-medium mb-1">Left blank deliberately</p>
            <p className="text-xs text-muted-foreground">
              {summary.withheld.map((k) => FIELD_LABEL[k] || k).join(", ")} could not be read confidently
              enough to fill in. These drive the tax, so an empty box you notice beats a wrong number you
              don&apos;t — enter them from the document.
            </p>
          </div>
        )}

        {/* Medium-confidence readings awaiting a human's eye. */}
        {unconfirmed.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium">Confirm these against the document</p>
            {unconfirmed.map(([key, p]) => (
              <div key={key} className="rounded-md border p-2.5 text-xs space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{FIELD_LABEL[key] || key}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="outline" className="text-[10px]">{p.confidence}</Badge>
                    {p.page !== null && <span className="text-muted-foreground text-[10px]">p.{p.page}</span>}
                    {p.snippet && (
                      <Button
                        size="icon" variant="ghost" className="h-6 w-6"
                        onClick={() => setShowEvidence(showEvidence === key ? null : key)}
                        aria-label={`Show source text for ${FIELD_LABEL[key] || key}`}
                      >
                        <Eye size={12} />
                      </Button>
                    )}
                    <Button
                      size="sm" variant="outline" className="h-6 text-[11px] px-2"
                      onClick={() => onProvenanceChange(confirmField(provenance, key))}
                    >
                      Confirm
                    </Button>
                  </div>
                </div>
                {showEvidence === key && p.snippet && (
                  <p className="text-[11px] text-muted-foreground font-mono bg-muted/50 rounded p-2 break-words">
                    “{p.snippet}”
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* The resolution queue. */}
        {open.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium">Questions to answer</p>
              {blocking.length > 0 && (
                <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 text-[10px]">
                  {blocking.length} blocking
                </Badge>
              )}
            </div>
            {queries.map((q, idx) => {
              if (q.resolvedAt) return null;
              return (
                <div
                  key={`${q.field}-${idx}`}
                  className={cn(
                    "rounded-md border p-3 text-xs space-y-2",
                    q.blocking
                      ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30"
                      : "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30",
                  )}
                >
                  <div className="flex items-start gap-2">
                    {q.blocking
                      ? <AlertCircle size={14} className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                      : <HelpCircle size={14} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />}
                    <div className="min-w-0">
                      <p className="font-medium">{q.question}</p>
                      <p className="text-muted-foreground mt-0.5">{q.why}</p>
                      {q.evidence?.snippet && (
                        <p className="text-[11px] text-muted-foreground font-mono bg-background/60 rounded p-1.5 mt-1.5 break-words">
                          {q.evidence.page !== null && <span className="opacity-60">p.{q.evidence.page} </span>}
                          “{q.evidence.snippet}”
                        </p>
                      )}
                    </div>
                  </div>

                  {q.options && q.options.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 pl-6">
                      {q.options.map((opt) => (
                        <Button
                          key={opt} size="sm" variant="outline" className="h-6 text-[11px] px-2"
                          onClick={() => onQueriesChange(resolveQuery(queries, idx, opt))}
                        >
                          {opt}
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex gap-2 pl-6">
                      <Input
                        className="h-7 text-xs"
                        placeholder="Your answer"
                        value={answers[idx] ?? ""}
                        onChange={(e) => setAnswers((a) => ({ ...a, [idx]: e.target.value }))}
                      />
                      <Button
                        size="sm" className="h-7 text-[11px]"
                        disabled={!(answers[idx] ?? "").trim()}
                        onClick={() => {
                          onQueriesChange(resolveQuery(queries, idx, answers[idx].trim()));
                          setAnswers((a) => ({ ...a, [idx]: "" }));
                        }}
                      >
                        Answer
                      </Button>
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground pl-6">
                    Answering records the question and your answer on this transaction. Update the fields
                    below to match.
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {/* Answered questions stay visible — the decision is part of the record. */}
        {queries.some((q) => q.resolvedAt) && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              {queries.filter((q) => q.resolvedAt).length} answered
            </summary>
            <ul className="mt-2 space-y-1.5">
              {queries.filter((q) => q.resolvedAt).map((q, i) => (
                <li key={`${q.field}-answered-${i}`} className="flex items-start gap-2">
                  <CheckCircle2 size={12} className="text-emerald-600 shrink-0 mt-0.5" />
                  <span className="text-muted-foreground">
                    {q.question} <span className="text-foreground">— {q.answer}</span>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
