// 3CA/3CB+3CD Uploaded By — the files behind the name.
//
// Every scanned audit report and every filed Form 3CA/3CB+3CD is kept in the
// `audit-3ca-uploads` storage bucket and indexed in audit_status_uploads,
// linked to the audit_status row it belongs to. Mirrors the retention
// pattern in src/lib/msme43b/attachments.ts.
//
// A replace (re-upload of the same kind) is a NEW row, not an overwrite —
// nothing is deleted, listUploads() simply returns the latest per kind.

import { supabase } from '@/integrations/supabase/client';

export type UploadKind = 'scanned_report' | 'filed_form';

const BUCKET = 'audit-3ca-uploads';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => (supabase as any).from('audit_status_uploads');

export interface StoredUpload {
  id: string;
  kind: UploadKind;
  file_name: string;
  storage_path: string;
  size_bytes: number | null;
  uploaded_by_name: string | null;
  created_at: string;
}

export interface StoreUploadInput {
  auditStatusId: string;
  firmId: string;
  userId?: string | null;
  userName?: string | null;
  kind: UploadKind;
  file: File;
}

export interface UploadResult {
  stored: StoredUpload | null;
  error: string | null;
}

function objectPath(firmId: string, auditStatusId: string, kind: UploadKind, fileName: string): string {
  const safe = fileName.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120);
  return `${firmId}/${auditStatusId}/${kind}/${Date.now()}-${safe}`;
}

export async function storeUpload(input: StoreUploadInput): Promise<UploadResult> {
  const path = objectPath(input.firmId, input.auditStatusId, input.kind, input.file.name);

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, input.file, {
    upsert: false,
    contentType: input.file.type || 'application/octet-stream',
  });
  if (upErr) return { stored: null, error: upErr.message };

  const { data, error } = await db()
    .insert({
      audit_status_id: input.auditStatusId,
      firm_id: input.firmId,
      kind: input.kind,
      file_name: input.file.name,
      mime_type: input.file.type || null,
      size_bytes: input.file.size,
      storage_path: path,
      uploaded_by: input.userId ?? null,
      uploaded_by_name: input.userName ?? null,
    })
    .select('id, kind, file_name, storage_path, size_bytes, uploaded_by_name, created_at')
    .single();

  if (error) return { stored: null, error: error.message };
  return { stored: data as StoredUpload, error: null };
}

/** Latest upload per kind for this audit_status row. */
export async function listUploads(auditStatusId: string): Promise<Record<UploadKind, StoredUpload | null>> {
  const { data, error } = await db()
    .select('id, kind, file_name, storage_path, size_bytes, uploaded_by_name, created_at')
    .eq('audit_status_id', auditStatusId)
    .order('created_at', { ascending: false });

  const result: Record<UploadKind, StoredUpload | null> = { scanned_report: null, filed_form: null };
  if (error || !data) return result;
  for (const row of data as StoredUpload[]) {
    if (!result[row.kind]) result[row.kind] = row;
  }
  return result;
}

/** Short-lived signed URL to view/download a retained file. */
export async function uploadFileUrl(storagePath: string, expiresInSeconds = 300): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, expiresInSeconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export interface ExtractedDate {
  date: string | null;
  confidence: 'high' | 'medium' | 'low' | 'unavailable';
}

export interface ExtractedDocInfo extends ExtractedDate {
  /** The assessee/client name AI-read off the document, or null if it couldn't find one. */
  assesseeName: string | null;
}

/**
 * AI-read the filing date (filed-form call) and the assessee name (both
 * calls) off an uploaded document. Fails soft — a missing/unreadable value
 * comes back null, never an exception, so extraction never blocks the
 * upload flow on its own.
 */
export async function extractDocumentInfo(file: File): Promise<ExtractedDocInfo> {
  try {
    const base64 = await fileToBase64(file);
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const payload = isPdf
      ? { pdf_base64: base64, file_name: file.name }
      : { image_base64: base64, image_media_type: file.type || 'image/png', file_name: file.name };

    const { data, error } = await supabase.functions.invoke('audit-3ca-extract-date', { body: payload });
    if (error || !data) return { date: null, confidence: 'unavailable', assesseeName: null };
    return {
      date: data.date ?? null,
      confidence: data.confidence ?? 'unavailable',
      assesseeName: data.assessee_name ?? null,
    };
  } catch {
    return { date: null, confidence: 'unavailable', assesseeName: null };
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
