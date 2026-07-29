// MSME 43B(h) — permanent retention of everything a run touched.
//
// Every uploaded ledger, every reviewer working paper and every exported
// workpaper is kept in the `msme-43b` storage bucket and indexed in
// msme_43b_attachments, linked to the run it belongs to. Years later a working
// paper can be reproduced from its own sources without anyone hunting for the
// original PDFs.
//
// RE-RUNS ARE EXPRESSLY ALLOWED. Uploading the same ledgers again produces a
// NEW run and a new set of attachment rows; nothing is overwritten and nothing
// is de-duplicated away. A content hash is recorded so identical inputs can be
// RECOGNISED (and the earlier run offered), but never so a re-run is refused —
// re-running the same file under a changed interpretation is a normal and
// important thing to do.
//
// Fails soft: if the bucket or table is missing (migration not applied), the
// analysis still runs and the caller is told retention is off, rather than
// losing the work.

import { supabase } from '@/integrations/supabase/client';

export type AttachmentKind = 'cy_ledger' | 'fy_ledger' | 'reviewer_working' | 'workpaper_export';

const BUCKET = 'msme-43b';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => (supabase as any).from('msme_43b_attachments');

export interface StoredAttachment {
  id: string;
  kind: AttachmentKind;
  file_name: string;
  storage_path: string;
  size_bytes: number | null;
  content_hash: string | null;
  uploaded_by_name: string | null;
  created_at: string;
  run_id: string | null;
}

export interface RetentionResult {
  stored: StoredAttachment[];
  /** true when retention is not deployed yet — the run still worked */
  unavailable: boolean;
  error: string | null;
}

/** SHA-256 of the file contents, hex. Identifies identical re-uploads. */
export async function hashFile(file: File | Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function isMissing(error: { message?: string; status?: number } | null): boolean {
  if (!error) return false;
  const m = error.message || '';
  return /bucket not found/i.test(m) ||
    /relation .*msme_43b_attachments.* does not exist/i.test(m) ||
    /Could not find the table/i.test(m);
}

/** Slugged, collision-proof object key. Tenant first so storage RLS can scope on it. */
function objectPath(firmId: string, clientId: string, kind: AttachmentKind, fileName: string, hash: string): string {
  const safe = fileName.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120);
  return `${firmId}/${clientId}/${kind}/${hash.slice(0, 16)}-${safe}`;
}

export interface StoreFilesInput {
  clientId: string;
  firmId?: string | null;
  userId?: string | null;
  userName?: string | null;
  files: File[];
  kind: AttachmentKind;
  /** set when the run already exists; otherwise link later with linkToRun() */
  runId?: string | null;
}

/**
 * Upload files and index them. Uses upsert on the storage object so re-uploading
 * an identical file reuses the stored bytes (same hash → same path) while still
 * writing a fresh attachment row for this run — retention of the RECORD is what
 * matters, and storing the same bytes twice would just waste space.
 */
export async function storeFiles(input: StoreFilesInput): Promise<RetentionResult> {
  if (!input.files.length) return { stored: [], unavailable: false, error: null };
  if (!input.clientId || !input.firmId) {
    return { stored: [], unavailable: true, error: 'Select a client before uploading — files are retained per client.' };
  }

  const stored: StoredAttachment[] = [];
  for (const file of input.files) {
    const hash = await hashFile(file);
    const path = objectPath(input.firmId, input.clientId, input.kind, file.name, hash);

    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
      upsert: true,
      contentType: file.type || 'application/octet-stream',
    });
    if (upErr) {
      if (isMissing(upErr)) return { stored, unavailable: true, error: null };
      return { stored, unavailable: false, error: upErr.message };
    }

    const { data, error } = await db().insert({
      firm_id: input.firmId,
      client_id: input.clientId,
      run_id: input.runId ?? null,
      kind: input.kind,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      storage_path: path,
      content_hash: hash,
      uploaded_by: input.userId ?? null,
      uploaded_by_name: input.userName ?? null,
    }).select('id, kind, file_name, storage_path, size_bytes, content_hash, uploaded_by_name, created_at, run_id').single();

    if (error) {
      if (isMissing(error)) return { stored, unavailable: true, error: null };
      return { stored, unavailable: false, error: error.message };
    }
    stored.push(data as StoredAttachment);
  }

  return { stored, unavailable: false, error: null };
}

/** Attach already-stored files to the run they produced, once it has an id. */
export async function linkToRun(attachmentIds: string[], runId: string): Promise<{ error: string | null }> {
  if (!attachmentIds.length) return { error: null };
  const { error } = await db().update({ run_id: runId }).in('id', attachmentIds);
  return { error: error && !isMissing(error) ? error.message : null };
}

/** Everything retained for a run, for the "sources" panel. */
export async function listRunAttachments(runId: string): Promise<RetentionResult> {
  const { data, error } = await db()
    .select('id, kind, file_name, storage_path, size_bytes, content_hash, uploaded_by_name, created_at, run_id')
    .eq('run_id', runId)
    .order('created_at', { ascending: true });
  if (error) return { stored: [], unavailable: isMissing(error), error: isMissing(error) ? null : error.message };
  return { stored: (data ?? []) as StoredAttachment[], unavailable: false, error: null };
}

/** Everything retained for a client, newest first. */
export async function listClientAttachments(clientId: string, limit = 200): Promise<RetentionResult> {
  const { data, error } = await db()
    .select('id, kind, file_name, storage_path, size_bytes, content_hash, uploaded_by_name, created_at, run_id')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return { stored: [], unavailable: isMissing(error), error: isMissing(error) ? null : error.message };
  return { stored: (data ?? []) as StoredAttachment[], unavailable: false, error: null };
}

/** Short-lived signed URL to download a retained file. */
export async function attachmentUrl(storagePath: string, expiresInSeconds = 300): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, expiresInSeconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/**
 * Earlier runs built from exactly these files. Used to TELL the user they have
 * analysed this set before — never to block them from doing it again.
 */
export async function findPriorRunsForHashes(clientId: string, hashes: string[]): Promise<string[]> {
  if (!hashes.length) return [];
  const { data, error } = await db()
    .select('run_id')
    .eq('client_id', clientId)
    .in('content_hash', hashes)
    .not('run_id', 'is', null);
  if (error) return [];
  return [...new Set((data ?? []).map((r: { run_id: string }) => r.run_id))];
}
