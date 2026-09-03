// ITR Form / Computation of Income uploads — the files behind a "Filed"
// IT Return. Every filed ITR Form and computation-of-income statement is
// kept in the `itr-filing-uploads` storage bucket and indexed in
// itr_status_uploads, linked to the itr_profiles row it belongs to. Mirrors
// src/lib/auditStatusUploads.ts.
//
// A replace (re-upload of the same kind) is a NEW row, not an overwrite —
// nothing is deleted, listUploads() simply returns the latest per kind.

import { supabase } from '@/integrations/supabase/client';
import { extractTaxDocFields } from '@/lib/taxDocExtract';

export type ItrUploadKind = 'itr_form' | 'computation_of_income';

const BUCKET = 'itr-filing-uploads';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => (supabase as any).from('itr_status_uploads');

export interface StoredItrUpload {
  id: string;
  kind: ItrUploadKind;
  file_name: string;
  storage_path: string;
  size_bytes: number | null;
  uploaded_by_name: string | null;
  created_at: string;
}

export interface StoreItrUploadInput {
  itrProfileId: string;
  firmId: string;
  userId?: string | null;
  userName?: string | null;
  kind: ItrUploadKind;
  file: File;
}

export interface ItrUploadResult {
  stored: StoredItrUpload | null;
  error: string | null;
}

function objectPath(firmId: string, itrProfileId: string, kind: ItrUploadKind, fileName: string): string {
  const safe = fileName.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120);
  return `${firmId}/${itrProfileId}/${kind}/${Date.now()}-${safe}`;
}

export async function storeItrUpload(input: StoreItrUploadInput): Promise<ItrUploadResult> {
  const path = objectPath(input.firmId, input.itrProfileId, input.kind, input.file.name);

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, input.file, {
    upsert: false,
    contentType: input.file.type || 'application/octet-stream',
  });
  if (upErr) return { stored: null, error: upErr.message };

  const { data, error } = await db()
    .insert({
      itr_profile_id: input.itrProfileId,
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
  return { stored: data as StoredItrUpload, error: null };
}

/** Latest upload per kind for this itr_profiles row. */
export async function listItrUploads(itrProfileId: string): Promise<Record<ItrUploadKind, StoredItrUpload | null>> {
  const { data, error } = await db()
    .select('id, kind, file_name, storage_path, size_bytes, uploaded_by_name, created_at')
    .eq('itr_profile_id', itrProfileId)
    .order('created_at', { ascending: false });

  const result: Record<ItrUploadKind, StoredItrUpload | null> = { itr_form: null, computation_of_income: null };
  if (error || !data) return result;
  for (const row of data as StoredItrUpload[]) {
    if (!result[row.kind]) result[row.kind] = row;
  }
  return result;
}

/** Short-lived signed URL to view/download a retained file. */
export async function itrUploadFileUrl(storagePath: string, expiresInSeconds = 300): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, expiresInSeconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/** AI-read the e-filing acknowledgement number off the uploaded ITR Form. Fails soft. */
export async function extractAckNumber(file: File): Promise<{ acknowledgmentNo: string | null; confidence: string }> {
  const fields = await extractTaxDocFields(file, 'itr_form');
  return { acknowledgmentNo: fields.acknowledgmentNo, confidence: fields.ackConfidence };
}
