// Shared client for the `tax-document-extract` edge function — reads an
// uploaded tax PDF/image and pulls out structured fields (a filing date +
// assessee name for a 3CA/3CB+3CD, or an ITR acknowledgement number for a
// filed return). Used by both the Audit Tracker and IT Returns upload-
// confirmation dialogs so there is ONE prompt-maintenance surface, not a
// near-identical copy per module.

import { supabase } from '@/integrations/supabase/client';

export type TaxDocType = '3ca_3cd' | 'itr_form';

export interface TaxDocFields {
  date: string | null;
  dateConfidence: 'high' | 'medium' | 'low' | 'unavailable';
  assesseeName: string | null;
  acknowledgmentNo: string | null;
  ackConfidence: 'high' | 'medium' | 'low' | 'unavailable';
}

const EMPTY: TaxDocFields = {
  date: null, dateConfidence: 'unavailable', assesseeName: null,
  acknowledgmentNo: null, ackConfidence: 'unavailable',
};

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

/** AI-read structured fields off an uploaded document. Fails soft — a
 *  missing/unreadable value comes back null, never an exception. */
export async function extractTaxDocFields(file: File, docType: TaxDocType): Promise<TaxDocFields> {
  try {
    const base64 = await fileToBase64(file);
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const payload = isPdf
      ? { doc_type: docType, pdf_base64: base64, file_name: file.name }
      : { doc_type: docType, image_base64: base64, image_media_type: file.type || 'image/png', file_name: file.name };

    const { data, error } = await supabase.functions.invoke('tax-document-extract', { body: payload });
    if (error || !data) return EMPTY;
    return {
      date: data.date ?? null,
      dateConfidence: data.date_confidence ?? 'unavailable',
      assesseeName: data.assessee_name ?? null,
      acknowledgmentNo: data.acknowledgment_no ?? null,
      ackConfidence: data.ack_confidence ?? 'unavailable',
    };
  } catch {
    return EMPTY;
  }
}
