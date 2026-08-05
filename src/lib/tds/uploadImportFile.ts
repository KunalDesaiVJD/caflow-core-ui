/**
 * Upload the ORIGINAL file a user picked for a TDS Validate & Finalise import
 * stage (Stage 1 client data, Stage 2 TRACES PAN export, Stage 3 Tally ledger)
 * to the existing public 'documents' Storage bucket, so it can be downloaded
 * back later — every stage's import handler previously parsed the file
 * in-browser and discarded the bytes, keeping only the extracted rows, which
 * meant "download the file I imported" was never possible at any stage.
 *
 * Best-effort and non-blocking by design: this always resolves (never
 * throws), returning null on any failure. A storage hiccup must never abort
 * the import itself — the parsed rows are the primary value; the ability to
 * download the original file back is a secondary convenience.
 */
import { supabase } from "@/integrations/supabase/client";
import { sanitizeStorageName } from "@/lib/storagePath";

export type TdsImportStageFolder = "recon" | "pan-verification" | "tally" | "challan-csi";

export async function uploadTdsImportFile(file: File, filingId: string, stage: TdsImportStageFolder): Promise<string | null> {
  try {
    const safeName = sanitizeStorageName(file.name);
    const path = `tds-import/${stage}/${filingId}_${Date.now()}_${safeName}`;
    const { error } = await supabase.storage.from("documents").upload(path, file);
    if (error) return null;
    const { data } = supabase.storage.from("documents").getPublicUrl(path);
    return data.publicUrl || null;
  } catch {
    return null;
  }
}
