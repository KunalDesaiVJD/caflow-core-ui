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
import { useRef, useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Upload, FileText, Loader2, CheckCircle2, AlertCircle, HelpCircle, Eye, MinusCircle } from "lucide-react";
import { cn } from "@/lib/utils";

import {
  applyExtraction,
  reassess,
  resolveQuery,
  skipQuery,
  canSkip,
  confirmField,
  openQueries,
  blockingQueries,
  FIELD_LABEL,
  type AgreementExtraction,
  type AppliedExtraction,
  type DroppedRows,
  type ResolvedQuery,
  type FieldProvenance,
} from "./agreementExtraction";
import { sanitizeStorageName } from "@/lib/storagePath";
import { pdfPageCount } from "@/lib/msme43b/pdfText";
import { mergeChunkReadings, planChunks, type ChunkReading } from "@/lib/tds/mergeExtraction";
import { useAuth } from "@/hooks/useAuth";
import type { PropertyDealBundle } from "./propertyDeal";

/** What the module needs to persist a tds_property_documents row on save. */
export interface StoredDocument {
  fileUrl: string;
  fileName: string;
  mimeType: string;
  docKind: "sale_agreement" | "index_ii";
  extractionJson: unknown;
}

/** Where the file landed, once it has. */
interface StoredAgreement {
  path: string;
  publicUrl: string | null;
}

/**
 * Turn a storage rejection into something a preparer can act on.
 *
 * Supabase reports these as an opaque object and this module used to discard
 * it entirely, so a size rejection, a permission denial and a dropped
 * connection all reached the user as one sentence with no way to tell them
 * apart. The 19.7 MB registered deed that failed on the first real upload was
 * a size rejection, and nothing on screen said so.
 */
function describeStorageError(err: unknown, file: File): string {
  const raw =
    (err as { message?: string } | null)?.message ?? (typeof err === "string" ? err : "");
  const mb = (file.size / 1024 / 1024).toFixed(1);

  if (/exceeded the maximum allowed size|payload too large|entity too large|\b413\b/i.test(raw)) {
    return `${file.name} is ${mb} MB, which storage refused as too large. Upload just the pages carrying the parties, the consideration and the stamp duty value.`;
  }
  if (/row-level security|not authorized|unauthorized|\b403\b/i.test(raw)) {
    return "You do not have permission to upload documents for this client. Ask an administrator to check your access.";
  }
  if (/bucket not found/i.test(raw)) {
    return "The documents storage bucket is missing on this project. An administrator needs to create it before agreements can be read.";
  }
  if (/already exists|duplicate/i.test(raw)) {
    return "A file of that name was just uploaded. Try again.";
  }
  return raw
    ? `${file.name} could not be uploaded for reading. Storage said: ${raw}`
    : `${file.name} could not be uploaded for reading. Check the connection and try again.`;
}

/**
 * Put the original file in storage.
 *
 * Two callers with opposite needs, so the bound is a parameter and the reason
 * always comes back:
 *
 *   • the short path stores the deed AFTER a successful read, purely so it can
 *     be opened again later. A failure there must not lose a reading the user
 *     has already waited for, so that caller ignores the reason.
 *   • the background path stores the deed BEFORE anything is read, because the
 *     worker reads it FROM storage. A failure there is fatal to the job, and
 *     the reason is the only thing that tells the user what to do about it.
 *
 * A 20 MB scan on an ordinary office upstream link takes well over the 30
 * seconds the short path allows, which is why the background path passes its
 * own, far longer, bound.
 */
async function storeAgreement(
  file: File,
  clientId: string,
  timeoutMs: number,
): Promise<{ stored: StoredAgreement | null; reason: string | null }> {
  const path = `tds-property/${clientId}/${Date.now()}_${sanitizeStorageName(file.name)}`;
  try {
    const upload = supabase.storage.from("documents").upload(path, file);
    const timeout = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), timeoutMs),
    );
    const result = await Promise.race([upload, timeout]);

    if (result === "timeout") {
      return {
        stored: null,
        reason: `Uploading ${file.name} took longer than ${Math.round(timeoutMs / 1000)} seconds and was stopped. Check the connection and try again.`,
      };
    }
    const { error } = result as { error?: unknown };
    if (error) return { stored: null, reason: describeStorageError(error, file) };

    return {
      stored: {
        path,
        publicUrl: supabase.storage.from("documents").getPublicUrl(path).data.publicUrl || null,
      },
      reason: null,
    };
  } catch (e: unknown) {
    return { stored: null, reason: describeStorageError(e, file) };
  }
}

/**
 * How long each path waits for the upload.
 *
 * The short path is keeping a copy of a deed it has already read, so 30
 * seconds is generous — losing it costs nothing. The background path is
 * storing the ONLY copy the worker will ever see, and it may be storing
 * 50 MB: at a typical Indian office upstream of 5 Mbps that is roughly 80
 * seconds, and at 2 Mbps it is over three minutes. Five minutes covers the
 * slow case rather than cutting off a transfer that was going to succeed.
 */
const STORE_TIMEOUT_KEEPSAKE_MS = 30_000;
const STORE_TIMEOUT_REQUIRED_MS = 300_000;

/**
 * The size a registered deed is allowed to be.
 *
 * Set to match the documents bucket exactly (migration 20260913120000), and
 * the two must move together: when the guard was 20 MB and the bucket 10 MB,
 * a 19.7 MB deed was accepted here and then silently refused by storage, and
 * all the user saw was "The file could not be uploaded for reading."
 *
 * Equal rather than strictly lower is safe because both tests are inclusive —
 * this rejects on `>`, and storage rejects on `>` — so a file of exactly this
 * size passes both. 50 MB is also Supabase's own default ceiling for a
 * project's Storage, so a higher number here would be clamped there and put
 * the two back out of step.
 *
 * The file never enters Postgres: it goes to object storage, and the reader
 * fetches page ranges from it. Size costs storage, not database.
 */
const MAX_FILE_BYTES = 50 * 1024 * 1024;

/**
 * The guard that matters is PAGES, not bytes.
 *
 * The byte limit above measured the wrong dimension and said the wrong thing.
 * A 202-page registered deed weighing 19.7 MB slipped under it by 0.3 MB and
 * then failed anyway, because a scanned page costs the vision model
 * 1,500-2,500 tokens whatever the file weighs — and a 68-page deed at 6.5 MB
 * failed too. Time was always the constraint; bytes never were.
 *
 * So: a short document goes straight to the model and the user waits a few
 * seconds. Anything longer becomes a background job read in page ranges. The
 * threshold is where a single request reliably finishes inside the 110s the
 * edge function allows itself.
 */
const SYNC_MAX_PAGES = 8;

/** Pages per chunk in a background job. Twelve scanned pages is roughly
 *  24,000 vision tokens, which reads in 30-50 seconds. */
const JOB_CHUNK_PAGES = 12;

/**
 * The longest deed the background reader will take on.
 *
 * 500 pages is 42 chunks of 12, which the worker chains through in roughly a
 * dozen invocations — well inside its own MAX_ATTEMPTS of 40. Past this the
 * facts still live on a handful of pages and the user is better off saying
 * which, rather than paying for 500 pages of vision tokens to find them.
 */
const MAX_PAGES = 500;

/** How often the browser asks the job row how far it has got. */
const POLL_MS = 3000;

/**
 * Supabase kills an edge-function worker at its request idle timeout (150s)
 * and returns a 504 with no body. supabase-js can leave the promise hanging in
 * that case, which is how an upload ends up spinning forever with nothing on
 * screen and no error — the worst possible outcome, because it looks like the
 * app is still working.
 *
 * So the call is BOUNDED here, on the client, at the same 150s. Whatever
 * happens on the far side, the spinner stops and something is said.
 *
 * Mirrors invokeFn() in TdsValidateFinalise.tsx, which already learned this.
 */
const INVOKE_TIMEOUT_MS = 150_000;

async function invokeBounded(name: string, body: unknown) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), INVOKE_TIMEOUT_MS);
  try {
    return await Promise.race([
      // `signal` is passed opportunistically — some supabase-js versions honour
      // it. The race below bounds the UI even when the SDK ignores it.
      supabase.functions.invoke(name, { body, signal: ctrl.signal } as never),
      new Promise<never>((_, reject) => {
        ctrl.signal.addEventListener("abort", () =>
          reject(new Error("READER_TIMEOUT")), { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

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
async function describeInvokeError(e: unknown): Promise<string> {
  const raw = e instanceof Error ? e.message : String(e ?? "");

  if (raw === "READER_TIMEOUT") {
    return "The reader took longer than 150 seconds and the server cut it off. Long registered deeds are usually the cause — upload just the pages carrying the parties, the consideration and the stamp duty value, or set the PROPERTY_EXTRACT_MODEL secret to a faster model.";
  }
  if (/failed to send a request|failed to fetch|not found|404/i.test(raw)) {
    return "The document reader is not deployed on this project yet. Deploy the property-agreement-extract function, then try again. You can enter the details manually in the meantime.";
  }

  // A platform kill (wall-clock timeout or OOM) comes back with NO JSON body
  // and a bare "non-2xx status code". Read the status to say something useful
  // rather than repeating that string at the user.
  try {
    const ctx = (e as { context?: { status?: number; json?: () => Promise<unknown> } }).context;
    const status = ctx?.status ?? 0;
    const body = ctx && typeof ctx.json === "function" ? await ctx.json() : null;
    const fromBody = (body as { error?: string } | null)?.error;
    if (fromBody) return String(fromBody);
    if ([500, 502, 504, 546].includes(status)) {
      return "The server ran out of time or memory reading this document. Upload fewer pages, or set the PROPERTY_EXTRACT_MODEL secret to a faster model.";
    }
  } catch {
    // No parseable body — fall through to the raw message.
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
  /** Applying an answer can amend the transaction itself — see applyAnswer. */
  onBundleChange: (next: PropertyDealBundle) => void;
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

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type UntypedQuery = any;
/** src/integrations/supabase/types.ts is regenerated by the CLI only
 *  (CLAUDE.md §6) and does not know tds_property_extraction_jobs yet. One
 *  named cast rather than one per call site — see TdsPropertyModule's note. */
const jobsTable = () => (supabase as UntypedQuery).from("tds_property_extraction_jobs");

export function TdsPropertyUpload({
  bundle, provenance, queries, onExtracted, onProvenanceChange, onQueriesChange, onBundleChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();
  const [reading, setReading] = useState(false);
  /** A background read in flight: the row id, and the progress last seen. */
  const [job, setJob] = useState<
    { id: string; fileName: string; pages: number; chunksDone: number; chunksTotal: number } | null
  >(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    needsConfirmation: string[];
    withheld: string[];
    unreadable: string[];
    dropped: DroppedRows[];
  } | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});

  /**
   * Answer a question and let the answer take effect.
   *
   * The panel used to store the text and tell the user to "update the fields
   * below to match", which left the form showing a figure the user had just
   * contradicted in writing — and a transaction could be filed carrying both.
   * Now the answer is parsed against the field the question was about and
   * written in, overriding whatever the reader had put there, with the
   * displaced value named out loud rather than replaced in silence.
   */
  /**
   * The bundle as the READER left it, before any answer touched it.
   *
   * Kept so every answer can be replayed against it together — see reassess.
   * Without it, re-answering a question would layer on top of the previous
   * answer instead of replacing it, and the order the user happened to work
   * through the panel would change the result.
   */
  const readerBundle = useRef<PropertyDealBundle | null>(null);
  const readerProvenance = useRef<Record<string, FieldProvenance>>({});

  const answerQuery = (idx: number, answer: string) => {
    // First answer on this reading: remember where the reader left things.
    if (!readerBundle.current) {
      readerBundle.current = bundle;
      readerProvenance.current = provenance;
    }

    const nextQueries = resolveQuery(queries, idx, answer);
    // Every answer replayed together, not just this one. An answer changes
    // more than its own field — a corrected consideration moves the ₹50L
    // threshold and the payments-reconcile check with it — and answers given
    // in any order must land on the same form.
    const out = reassess(nextQueries, readerBundle.current, readerProvenance.current);

    onQueriesChange(nextQueries);
    onBundleChange(out.bundle);
    onProvenanceChange(out.provenance);
    setAnswers((a) => ({ ...a, [idx]: "" }));

    for (const c of out.conflicts) {
      toast.warning(
        `${FIELD_LABEL[c.field] || c.field} was answered more than once (${c.values.join(" / ")}). The latest answer is the one in the form.`,
        { duration: 9000 },
      );
    }
    if (out.amended.length) {
      for (const a of out.amended) {
        toast.info(`${FIELD_LABEL[a.field] || a.field}: ${a.from} → ${a.to}`);
      }
    } else if (out.recordedOnly.includes(queries[idx]?.field)) {
      toast.info("Answer recorded. It needs a change to the rows below that this cannot make for you.");
    }
  };
  const [showEvidence, setShowEvidence] = useState<string | null>(null);

  /**
   * Read a short document in one request, with the user waiting.
   *
   * Right for an Index-II page or a draft agreement of a few pages; hopeless
   * for a scanned registered deed, which goes to readInBackground instead.
   */
  const readNow = async (file: File) => {
    setReading(true);
    setFileName(file.name);
    try {
      const b64 = await toBase64(file);
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      const { data, error } = await invokeBounded("property-agreement-extract", {
        doc_kind: "sale_agreement",
        file_name: file.name,
        ...(isPdf ? { pdf_base64: b64 } : { image_base64: b64, image_media_type: file.type || "image/png" }),
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
      // Reason ignored on purpose: the reading is already done and on screen,
      // and losing the keepsake copy must not turn that into an error.
      const { stored } = await storeAgreement(
        file,
        bundle.transaction.client_id,
        STORE_TIMEOUT_KEEPSAKE_MS,
      );
      onExtracted(
        applied,
        stored
          ? {
              fileUrl: stored.publicUrl || "",
              fileName: file.name,
              mimeType: file.type || (isPdf ? "application/pdf" : "image/png"),
              docKind: "sale_agreement",
              extractionJson: extraction,
            }
          : null,
      );
      setSummary({
        needsConfirmation: applied.needsConfirmation,
        withheld: applied.withheld,
        unreadable: applied.unreadable,
        dropped: applied.dropped,
      });

      const open = openQueries(applied.queries).length;
      toast.success(
        open > 0
          ? `Read ${file.name}. ${open} question${open === 1 ? "" : "s"} to answer below.`
          : `Read ${file.name}. Check the figures against the document before filing.`,
      );
    } catch (e: unknown) {
      toast.error(await describeInvokeError(e));
      setSummary(null);
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  /**
   * Applying a finished job.
   *
   * The chunk readings are merged HERE rather than in the worker, using
   * src/lib/tds/mergeExtraction.ts — the one implementation of the rule, with
   * tests on it. A second copy in Deno is exactly where "highest confidence
   * wins, lists whole, never union" would drift, and a unioned seller list
   * halves each real seller's share of the consideration.
   */
  const applyJob = async (row: {
    id: string;
    chunk_results: ChunkReading[] | null;
    file_path: string;
    file_name: string;
    mime_type: string | null;
  }) => {
    const merged = mergeChunkReadings(Array.isArray(row.chunk_results) ? row.chunk_results : []);

    // Stored back on the job so what was proposed stays readable long after
    // the session, next to the per-page readings it came from.
    await jobsTable().update({ result_json: merged, updated_at: new Date().toISOString() }).eq("id", row.id);

    if (merged.extraction_status === "failed") {
      toast.error(merged.error || "The document could not be read. Enter the details manually.");
      return;
    }
    if (merged.extraction_status === "not_a_property_document") {
      onQueriesChange(applyExtraction(merged, bundle).queries);
      toast.warning("This does not look like a property transfer document. See the question below.");
      return;
    }

    const applied = applyExtraction(merged, bundle);
    const publicUrl = supabase.storage.from("documents").getPublicUrl(row.file_path).data.publicUrl || "";
    onExtracted(applied, {
      fileUrl: publicUrl,
      fileName: row.file_name,
      mimeType: row.mime_type || "application/pdf",
      docKind: "sale_agreement",
      extractionJson: merged,
    });
    setSummary({
      needsConfirmation: applied.needsConfirmation,
      withheld: applied.withheld,
      unreadable: applied.unreadable,
      dropped: applied.dropped,
    });
    const openCount = openQueries(applied.queries).length;
    toast.success(
      openCount > 0
        ? `Read ${row.file_name}. ${openCount} question${openCount === 1 ? "" : "s"} to answer below.`
        : `Read ${row.file_name}. Check the figures against the document before filing.`,
    );
  };

  // Held in a ref so the poll below can depend on the job id ALONE. Depending
  // on `bundle` would restart the interval on every keystroke in the editor.
  const applyJobRef = useRef(applyJob);
  applyJobRef.current = applyJob;

  /**
   * Hand a long document to the background reader.
   *
   * The file goes to storage once and the job row records what has to be read;
   * the worker reads it in page ranges and chains to itself, so the browser is
   * not holding a request open and can be closed without losing the work.
   */
  const readInBackground = async (file: File, pages: number) => {
    setReading(true);
    setFileName(file.name);
    try {
      // The worker reads the deed FROM storage, so this upload is the job:
      // no file in the bucket, no job at all. Reported directly rather than
      // thrown, because describeInvokeError reads a thrown message as an
      // edge-function failure and would blame the wrong thing.
      const { stored, reason } = await storeAgreement(
        file,
        bundle.transaction.client_id,
        STORE_TIMEOUT_REQUIRED_MS,
      );
      if (!stored) {
        toast.error(reason || "The file could not be uploaded for reading.");
        return;
      }

      const chunksTotal = planChunks(pages, JOB_CHUNK_PAGES).length;
      const { data, error } = await jobsTable()
        .insert({
          firm_id: bundle.transaction.firm_id,
          client_id: bundle.transaction.client_id,
          file_path: stored.path,
          file_name: file.name,
          mime_type: file.type || "application/pdf",
          page_count: pages,
          chunk_size: JOB_CHUNK_PAGES,
          chunks_total: chunksTotal,
          created_by: user?.id ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;

      const id = (data as { id: string }).id;
      setJob({ id, fileName: file.name, pages, chunksDone: 0, chunksTotal });

      // Started, not awaited: the worker runs for its own budget and chains.
      // Waiting here would recreate the very timeout this replaces.
      supabase.functions
        .invoke("property-agreement-extract-job", { body: { job_id: id } })
        .catch(() => {
          // The poll below re-kicks a job that never starts moving.
        });

      toast.info(
        `${file.name} is ${pages} pages — too long to read in one go, so it is being read in the background. ` +
          "You can carry on entering details; the figures fill in when it finishes.",
        { duration: 10000 },
      );
    } catch (e: unknown) {
      toast.error(await describeInvokeError(e));
      setJob(null);
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  /**
   * Which path a file takes — decided on PAGES.
   *
   * The old guard measured bytes and got this wrong in both directions: a
   * 202-page deed at 19.7 MB passed a 20 MB limit and then failed on time,
   * while the message it would eventually have shown told the user to split a
   * file they had already been allowed to upload.
   */
  const handleFile = async (file: File) => {
    if (file.size > MAX_FILE_BYTES) {
      toast.error(
        `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB, over the ${MAX_FILE_BYTES / 1024 / 1024} MB upload limit. ` +
          "Upload just the pages carrying the parties, the consideration and the stamp duty value.",
      );
      return;
    }

    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (!isPdf) {
      // An image is one page by definition.
      await readNow(file);
      return;
    }

    let pages = 0;
    try {
      pages = await pdfPageCount(await file.arrayBuffer());
    } catch {
      // A PDF whose page count cannot be read is probably damaged, but the
      // model may still manage it — let the short path try and report.
      await readNow(file);
      return;
    }

    if (pages > MAX_PAGES) {
      toast.error(
        `${file.name} is ${pages} pages. Reading all of it would cost more than it can be worth — ` +
          "upload the pages carrying the parties, the consideration and the Index-II stamp duty value " +
          "(usually the first few pages and the last).",
        { duration: 12000 },
      );
      return;
    }

    if (pages <= SYNC_MAX_PAGES) await readNow(file);
    else await readInBackground(file, pages);
  };

  /**
   * Watch a background read.
   *
   * Keyed on the job id alone — see applyJobRef. Also re-kicks a worker that
   * has stopped making progress: a chain can break (a killed invocation, a
   * network blip), and the row then sits at 'running' with a stale heartbeat
   * until someone asks it to continue. It resumes from the last completed
   * chunk, so nothing is read, or paid for, twice.
   */
  useEffect(() => {
    if (!job?.id) return;
    const jobId = job.id;
    let stopped = false;
    let lastDone = -1;
    let stalledSince = Date.now();
    let consecutivePollFailures = 0;

    const tick = async () => {
      if (stopped) return;
      // Poll only the small status fields. Fetching every accumulated Claude
      // result every three seconds made the response grow throughout a long
      // deed; when that request failed, the old code silently returned and
      // left the spinner alive forever even though the job was already done.
      const { data, error: pollError } = await jobsTable()
        .select("id, status, chunks_done, chunks_total, error")
        .eq("id", jobId)
        .maybeSingle();
      if (stopped) return;
      if (pollError || !data) {
        consecutivePollFailures += 1;
        if (consecutivePollFailures >= 3) {
          stopped = true;
          setJob(null);
          toast.error(
            pollError?.message
              ? `The document finished on the server, but its status could not be loaded: ${pollError.message}`
              : "The document job could not be found. Refresh and upload it again.",
          );
        }
        return;
      }
      consecutivePollFailures = 0;

      const row = data as {
        id: string; status: string; chunks_done: number; chunks_total: number;
        error: string | null;
      };

      setJob((j) => (j && j.id === jobId ? { ...j, chunksDone: row.chunks_done, chunksTotal: row.chunks_total } : j));

      if (row.chunks_done !== lastDone) {
        lastDone = row.chunks_done;
        stalledSince = Date.now();
      } else if (row.status === "running" && Date.now() - stalledSince > 90_000) {
        stalledSince = Date.now();
        supabase.functions.invoke("property-agreement-extract-job", { body: { job_id: jobId } }).catch(() => {});
      }

      if (row.status === "done") {
        stopped = true;
        setJob(null);
        const { data: completed, error: completedError } = await jobsTable()
          .select("id, chunk_results, file_path, file_name, mime_type")
          .eq("id", jobId)
          .single();
        if (completedError || !completed) {
          toast.error(
            completedError?.message
              ? `The document was read, but its result could not be loaded: ${completedError.message}`
              : "The document was read, but its result is unavailable. Refresh and try again.",
          );
          return;
        }
        await applyJobRef.current(completed as {
          id: string; chunk_results: ChunkReading[] | null; file_path: string;
          file_name: string; mime_type: string | null;
        });
      } else if (row.status === "failed" || row.status === "cancelled") {
        stopped = true;
        setJob(null);
        toast.error(row.error || "The document could not be read. Enter the details manually.");
      }
    };

    const timer = setInterval(tick, POLL_MS);
    void tick();
    return () => { stopped = true; clearInterval(timer); };
    // Depends on the job id alone. Everything else the effect touches is
    // either a ref or module-scope, which is why `bundle` — and its
    // every-keystroke identity change — never restarts the interval.
  }, [job?.id]);

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
            size="sm" variant="outline" disabled={reading || Boolean(job)}
            onClick={() => inputRef.current?.click()}
          >
            {reading ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Upload size={14} className="mr-1.5" />}
            {reading ? "Reading…" : "Upload agreement"}
          </Button>
        </div>

        {fileName && !reading && !job && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <FileText size={12} /> {fileName}
          </p>
        )}

        {/* A background read. Shown as pages rather than chunks, because pages
            are what the user can see in the document in front of them. */}
        {job && (
          <div className="rounded-md border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40 p-3 space-y-2">
            <p className="text-xs font-medium flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" />
              Reading {job.fileName} — {Math.min(job.chunksDone * JOB_CHUNK_PAGES, job.pages)} of {job.pages} pages
            </p>
            <div className="h-1.5 w-full rounded-full bg-blue-200 dark:bg-blue-900 overflow-hidden">
              <div
                className="h-full bg-blue-600 dark:bg-blue-400 transition-[width] duration-500"
                style={{ width: `${job.chunksTotal ? Math.round((job.chunksDone / job.chunksTotal) * 100) : 0}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              A scanned deed has no text layer, so every page is read as an image. This keeps going if you
              close the tab — the figures fill in when it finishes.
            </p>
          </div>
        )}

        {/* Returned but unparseable. Loud, because an empty seller list computes
            zero tax and looks exactly like a below-threshold deal. */}
        {summary && summary.unreadable.length > 0 && (
          <div className="rounded-md border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40 p-3">
            <p className="text-xs font-medium mb-1">Read but not understood</p>
            <p className="text-xs text-muted-foreground">
              The reader returned {summary.unreadable.map((k) => FIELD_LABEL[k] || k).join(", ")} in a form
              this app could not use, so {summary.unreadable.length === 1 ? "it is" : "they are"} empty below.
              Enter {summary.unreadable.length === 1 ? "it" : "them"} by hand — and please report this, because
              it is a bug rather than a limit of the document.
            </p>
          </div>
        )}

        {/* Rows that came back but could not be used. Red, not amber: a
            payment schedule silently one row short is not a caution, it is a
            wrong number that looks right. */}
        {summary && summary.dropped.length > 0 && (
          <div className="rounded-md border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40 p-3">
            <p className="text-xs font-medium mb-1">Some rows could not be read</p>
            {summary.dropped.map((d) => (
              <p key={d.field} className="text-xs text-muted-foreground">
                The reader found {d.total} {(FIELD_LABEL[d.field] || d.field).toLowerCase()} but only{" "}
                {d.kept} could be used — {d.total - d.kept} had an amount or a date this app could not
                parse. Check the schedule below against the document and add the missing{" "}
                {d.total - d.kept === 1 ? "one" : "ones"} by hand, because the tax computed from a short
                schedule will be short too.
              </p>
            ))}
          </div>
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
                  {blocking.length} must be answered
                </Badge>
              )}
            </div>
            {queries.map((q, idx) => {
              if (q.resolvedAt || q.skipped) return null;
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
                          onClick={() => answerQuery(idx, opt)}
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
                        onClick={() => answerQuery(idx, answers[idx].trim())}
                      >
                        Answer
                      </Button>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2 pl-6">
                    <p className="text-[10px] text-muted-foreground">
                      Your answer is written into the matching field and recorded on this transaction.
                    </p>
                    {/* Skipping is a NON-CRITICAL affordance. Nobody should
                        be locked out of their own file by a question they
                        cannot answer today — but a critical question is one
                        the statement cannot be correct without, and waving it
                        away would put a wrong filing in front of the
                        department under the buyer's own PAN. So the button is
                        simply not offered, and the reason is said rather than
                        left to be discovered. */}
                    {canSkip(q) ? (
                      <Button
                        size="sm" variant="ghost"
                        className="h-6 text-[11px] px-2 shrink-0 text-muted-foreground"
                        onClick={() => onQueriesChange(skipQuery(queries, idx))}
                      >
                        Skip
                      </Button>
                    ) : (
                      <span className="text-[10px] text-red-700 dark:text-red-300 shrink-0 font-medium">
                        Must be answered
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Answered and skipped questions both stay visible — each is a
            decision the transaction carries, and a skipped question is the one
            most worth being able to find again. */}
        {queries.some((q) => q.resolvedAt || q.skipped) && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              {queries.filter((q) => q.resolvedAt).length} answered
              {queries.some((q) => q.skipped) &&
                `, ${queries.filter((q) => q.skipped && !q.resolvedAt).length} skipped`}
            </summary>
            <ul className="mt-2 space-y-1.5">
              {queries.filter((q) => q.resolvedAt || q.skipped).map((q, i) => (
                <li key={`${q.field}-done-${i}`} className="flex items-start gap-2">
                  {q.resolvedAt ? (
                    <CheckCircle2 size={12} className="text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <MinusCircle size={12} className="text-muted-foreground shrink-0 mt-0.5" />
                  )}
                  <span className="text-muted-foreground">
                    {q.question}{" "}
                    {q.resolvedAt ? (
                      <span className="text-foreground">— {q.answer}</span>
                    ) : (
                      <span className="italic">— skipped, left unanswered</span>
                    )}
                  </span>
                  {!q.resolvedAt && q.skipped && (
                    <Button
                      size="sm" variant="ghost"
                      className="h-5 text-[10px] px-1.5 shrink-0"
                      onClick={() => onQueriesChange(
                        queries.map((x) => (x === q ? { ...x, skipped: false } : x)),
                      )}
                    >
                      Undo
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
