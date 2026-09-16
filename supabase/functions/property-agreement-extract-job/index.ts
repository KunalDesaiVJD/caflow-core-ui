/**
 * property-agreement-extract-job
 *
 * Reads a registered sale deed that is too large to read in one request.
 *
 * ── The problem this exists for ────────────────────────────────────────────
 *
 * A registered Gujarati દસ્તાવેજ is a scanned image PDF: 68 to 202 pages with
 * ZERO embedded fonts, so there is no text layer and every page has to be
 * OCR'd by the vision model at roughly 1,500-2,500 tokens. A whole deed is
 * 120,000-350,000 tokens of images.
 *
 * Supabase cuts an edge-function request off at a 150-second idle timeout,
 * which is why the synchronous sibling caps itself at 110s. That is right for
 * a 3-page Index-II and hopeless for a 202-page deed: the request died, a
 * toast flashed for a few seconds after a two-minute wait, and the form stayed
 * empty. Bytes were never the constraint — Supabase's gateway accepts a 26 MB
 * body happily — time is.
 *
 * ── How it works ───────────────────────────────────────────────────────────
 *
 * The file is uploaded to storage once. This function reads it in page-range
 * chunks, storing each chunk's reading on the job row as it goes, and chains
 * to itself when its own time budget runs out. Nothing is ever re-read: a
 * worker that dies mid-job resumes at the last completed chunk, because the
 * completed chunks are already durable. Pages cost real money, so re-reading
 * them is not a neutral retry.
 *
 * ── What it deliberately does NOT do ───────────────────────────────────────
 *
 * It does not merge the chunk readings. The merge rule — highest confidence
 * wins, lists are taken whole rather than unioned, an empty reading never
 * displaces a real one — lives in src/lib/tds/mergeExtraction.ts with tests
 * against it. Reimplementing that here in Deno would be a second copy of the
 * one piece of logic where a mistake silently halves a seller's share. The
 * client merges the stored chunks with the tested implementation.
 *
 * It also never writes to a transaction. Like its sibling, this function
 * proposes; every figure still passes form141Validate.ts before it can be
 * filed.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import { callModel, isProviderError, type Part } from "../_shared/aiProvider.ts";
import {
  MODEL_ENV,
  DEFAULT_MODEL,
  SYSTEM_PROMPT,
  failed,
  parseReply,
  type ExtractionResult,
} from "../_shared/propertyExtract.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * How long this invocation will keep starting new chunks.
 *
 * Supabase's wall clock is 150s. Stopping at 95s leaves room for the chunks
 * already in flight to land and for the row to be written — a chunk whose
 * result is lost is a page range paid for twice.
 */
const BUDGET_MS = 95_000;

/** Per-chunk model timeout. A 12-page scanned range reads in 30-50s; past 70s
 *  it is not coming back inside this invocation's budget. */
const CHUNK_TIMEOUT_MS = 70_000;

/**
 * Persist one chunk at a time. Vercel Sandbox capacity can queue a third
 * concurrent Claude process; Promise.all then withholds the two completed
 * chunks until that queued process finishes, and Supabase may kill the worker
 * first. Sequential reads are slower per invocation but every successful
 * result reaches the job row immediately and can never be lost to a sibling.
 */
const CONCURRENCY = 1;

/**
 * The browser re-kicks after 90 seconds without progress. Keep this below that
 * threshold so its first retry resumes the job instead of returning
 * "already running" and waiting another 90 seconds.
 */
const STALE_MS = 75_000;

/**
 * Guards against a chain that never terminates.
 *
 * The ceiling the uploader enforces is 500 pages, which at 12 per chunk is 42
 * chunks. Sequential persistence may complete only one slow chunk per
 * invocation; forty leaves room for ordinary long deeds and a run of chunks
 * that each time out at 70s without rejecting the uploader's 500-page ceiling.
 * Sixty still prevents a genuinely stuck job from chaining forever.
 */
const MAX_ATTEMPTS = 60;

interface JobRow {
  id: string;
  firm_id: string;
  file_path: string;
  file_name: string;
  page_count: number;
  chunk_size: number;
  chunks_total: number;
  chunks_done: number;
  status: string;
  chunk_results: ChunkResult[] | null;
  attempts: number;
  heartbeat_at: string | null;
}

interface ChunkResult {
  fromPage: number;
  toPage: number;
  extraction: ExtractionResult;
}

const chunkKey = (c: { fromPage: number; toPage: number }) => `${c.fromPage}-${c.toPage}`;

/** Even page ranges. Mirrors planChunks() in src/lib/tds/mergeExtraction.ts —
 *  the facts sit wherever the sub-registrar put them, so guessing which pages
 *  matter risks a deed silently coming back with no sellers. */
function planChunks(pageCount: number, chunkSize: number): Array<{ fromPage: number; toPage: number }> {
  const out: Array<{ fromPage: number; toPage: number }> = [];
  for (let from = 1; from <= pageCount; from += chunkSize) {
    out.push({ fromPage: from, toPage: Math.min(from + chunkSize - 1, pageCount) });
  }
  return out;
}

/** Bytes → base64 without blowing the stack on a 10 MB slice.
 *  `String.fromCharCode(...bytes)` throws on large inputs; chunking the spread
 *  is the standard fix. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

/** One page range as its own small PDF, so the model sees only those pages. */
async function slicePages(src: PDFDocument, fromPage: number, toPage: number): Promise<string> {
  const out = await PDFDocument.create();
  const indices: number[] = [];
  for (let p = fromPage; p <= toPage; p++) indices.push(p - 1);
  const copied = await out.copyPages(src, indices);
  for (const page of copied) out.addPage(page);
  return toBase64(await out.save());
}

async function readChunk(
  src: PDFDocument,
  range: { fromPage: number; toPage: number },
  fileName: string,
): Promise<ChunkResult> {
  const base64 = await slicePages(src, range.fromPage, range.toPage);

  const parts: Part[] = [
    { kind: "pdf", filename: fileName, base64 },
    {
      kind: "text",
      // The model is told WHICH pages these are so the `page` it cites on
      // every field is the page number in the WHOLE deed, not in the slice.
      // A citation of "page 3" that actually means page 147 is worse than no
      // citation, because a reviewer would check the wrong page and pass it.
      text:
        `These are pages ${range.fromPage} to ${range.toPage} of ${fileName}, an excerpt from a larger ` +
        `registered deed. Report the "page" of every field as its page number in the WHOLE document ` +
        `(this excerpt starts at page ${range.fromPage}). Most of these pages will carry none of the ` +
        `fields — that is expected and correct: return null for anything not on THESE pages, with ` +
        `confidence "low", and do not guess from context. Raise a query only about something visible here.`,
    },
  ];

  const reply = await callModel(
    SYSTEM_PROMPT,
    parts,
    {
      modelEnv: MODEL_ENV,
      defaultModel: DEFAULT_MODEL,
      appTitle: "CAFlow Property TDS (chunked)",
      maxTokens: 16000,
      effort: "low",
    },
    CHUNK_TIMEOUT_MS,
  );

  if (isProviderError(reply)) {
    return { ...range, extraction: failed(reply.error) };
  }
  if (reply.truncated) {
    return {
      ...range,
      extraction: failed(`Pages ${range.fromPage}-${range.toPage} produced a reply that was cut off.`),
    };
  }
  return { ...range, extraction: parseReply(reply.text) };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const started = Date.now();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  let requestJobId = "";

  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    if (!token) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const jobId = String(body?.job_id ?? "");
    requestJobId = jobId;
    if (!jobId) return json({ error: "Provide `job_id`." }, 400);

    const admin = createClient(supabaseUrl, serviceKey);
    const updateJob = async (values: Record<string, unknown>): Promise<void> => {
      const { error } = await admin.from("tds_property_extraction_jobs").update(values).eq("id", jobId);
      if (error) throw new Error(`Could not save extraction progress: ${error.message}`);
    };

    // A chained call carries the service-role key: it is this function calling
    // itself to continue a job it already authorised. Anything else must be a
    // signed-in user, and the job is fetched through THEIR client so RLS
    // decides whether it is theirs to run.
    const isChained = token === serviceKey;
    if (!isChained) {
      const asUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: visible, error: rlsErr } = await asUser
        .from("tds_property_extraction_jobs")
        .select("id")
        .eq("id", jobId)
        .maybeSingle();
      if (rlsErr || !visible) return json({ error: "Unauthorized" }, 401);
    }

    const { data: job, error: jobErr } = await admin
      .from("tds_property_extraction_jobs")
      .select("*")
      .eq("id", jobId)
      .maybeSingle<JobRow>();
    if (jobErr || !job) return json({ error: "That extraction job no longer exists." }, 404);

    if (job.status === "done" || job.status === "failed" || job.status === "cancelled") {
      return json({ status: job.status, chunks_done: job.chunks_done, chunks_total: job.chunks_total });
    }

    // Someone else is already on it. Reporting rather than racing keeps two
    // workers from paying for the same pages.
    const beat = job.heartbeat_at ? Date.parse(job.heartbeat_at) : 0;
    if (job.status === "running" && Date.now() - beat < STALE_MS && !isChained) {
      return json({ status: "running", chunks_done: job.chunks_done, chunks_total: job.chunks_total, note: "already running" });
    }

    if (job.attempts >= MAX_ATTEMPTS) {
      await updateJob({ status: "failed", error: "The document needed more passes than allowed. Upload the pages carrying the parties, consideration and stamp duty value.", updated_at: new Date().toISOString() });
      return json({ status: "failed" });
    }

    await updateJob({ status: "running", attempts: job.attempts + 1, heartbeat_at: new Date().toISOString(), updated_at: new Date().toISOString() });

    // ── The document ───────────────────────────────────────────────────────
    const { data: blob, error: dlErr } = await admin.storage.from("documents").download(job.file_path);
    if (dlErr || !blob) {
      await updateJob({ status: "failed", error: "The uploaded file could not be read back from storage.", updated_at: new Date().toISOString() });
      return json({ status: "failed" });
    }
    const srcDoc = await PDFDocument.load(await blob.arrayBuffer());

    // ── What is left ───────────────────────────────────────────────────────
    const done: ChunkResult[] = Array.isArray(job.chunk_results) ? job.chunk_results : [];
    const doneKeys = new Set(done.map(chunkKey));
    const remaining = planChunks(job.page_count, job.chunk_size).filter((c) => !doneKeys.has(chunkKey(c)));

    const results: ChunkResult[] = [...done];
    let index = 0;

    while (index < remaining.length && Date.now() - started < BUDGET_MS) {
      const batch = remaining.slice(index, index + CONCURRENCY);
      index += batch.length;

      const settled = await Promise.all(
        batch.map((range) =>
          readChunk(srcDoc, range, job.file_name).catch((e): ChunkResult => ({
            ...range,
            extraction: failed(`Pages ${range.fromPage}-${range.toPage} could not be read: ${(e as Error)?.message ?? "unknown error"}`),
          })),
        ),
      );
      results.push(...settled);

      // Written after EVERY batch, not at the end: an invocation killed at the
      // wall clock must not lose the pages it already paid to read.
      await updateJob({
        chunk_results: results,
        chunks_done: results.length,
        heartbeat_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    const finished = results.length >= job.chunks_total;

    if (finished) {
      // Every chunk failing is a failure, not an empty success — an extraction
      // with no parties and no consideration looks exactly like a
      // below-threshold deal on screen.
      const anyRead = results.some((r) => r.extraction?.extraction_status === "extracted");
      await updateJob({
        status: anyRead ? "done" : "failed",
        error: anyRead ? null : "None of the pages could be read. Try a clearer scan, or enter the details manually.",
        heartbeat_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      return json({ status: anyRead ? "done" : "failed", chunks_done: results.length, chunks_total: job.chunks_total });
    }

    // More to do. Chain with the service key so the job keeps moving even if
    // the browser that started it is closed — the whole point of doing this in
    // the background rather than in the upload request.
    fetch(`${supabaseUrl}/functions/v1/property-agreement-extract-job`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: jobId }),
    }).catch(() => {
      // A failed chain is not fatal: the row stays 'running' with a heartbeat
      // that goes stale, and the next caller picks it up from the last
      // completed chunk.
    });

    return json({ status: "running", chunks_done: results.length, chunks_total: job.chunks_total });
  } catch (e) {
    console.error("property-agreement-extract-job:", (e as Error)?.message);
    // A thrown error used to leave the row in `running` forever. The browser
    // then kept polling and re-kicking the same broken job, so the upload UI
    // never reached a terminal state. Persist the failure whenever the request
    // got far enough to identify a job.
    try {
      if (requestJobId) {
        const admin = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        await admin.from("tds_property_extraction_jobs")
          .update({
            status: "failed",
            error: "The document reader stopped unexpectedly. Please try again or enter the details manually.",
            updated_at: new Date().toISOString(),
          })
          .eq("id", requestJobId);
      }
    } catch {
      // The original error remains the useful server-side diagnostic.
    }
    return json({ error: "Something went wrong reading the document." }, 500);
  }
});
