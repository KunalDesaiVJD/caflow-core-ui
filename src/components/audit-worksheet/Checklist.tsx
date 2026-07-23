/**
 * Checklist — Sheet 6 "AUDIT DOCUMENTATION"
 *
 * 20 fixed document items with Page Number FROM / TO tracking.
 * Additional rows can be added dynamically via the "Add Row" button.
 *
 * All Particulars are editable; pre-populated rows show their static
 * text as the default but allow override.
 *
 * Items 8, 10, 12 contain "{fyEndYear}" which is replaced at render
 * with the actual year derived from data.fyEndDate (Req #4).
 *
 * Each row supports MULTIPLE document uploads (PDF, image, Excel, Word, CSV).
 * Files up to 10 MB each. Excel files use application/octet-stream to bypass
 * Supabase bucket MIME restrictions.
 */
import { useRef, useState } from "react";
import { Button }  from "@/components/ui/button";
import { Input }   from "@/components/ui/input";
import { Save, Loader2, ClipboardCheck, Plus, Paperclip, Eye, Trash2, Ban } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useChecklistSheetStorage } from "./hooks/useChecklistSheetStorage";
import type { ChecklistFile } from "./hooks/useChecklistSheetStorage";
import type { AuditWorksheetData }  from "./hooks/useAuditWorksheetData";

// ─── Static row definitions ───────────────────────────────────────────────────

interface ChecklistDef {
  id:          string;
  sr:          number;
  particulars: string;   // may contain "{fyEndYear}" placeholder
  isCustom?:   boolean;  // dynamically added rows: user-editable particulars
}

const CHECKLIST_DEFS: ChecklistDef[] = [
  { id: "p_and_l",          sr: 1,  particulars: "Profit and Loss" },
  { id: "balance_sheet",    sr: 2,  particulars: "Balance Sheet" },
  { id: "trial_balance",    sr: 3,  particulars: "Trial Balance" },
  {
    id: "form_26as",        sr: 4,
    particulars: "26AS — Attached Compulsory even though IF NIL",
  },
  {
    id: "tis_ais",          sr: 5,
    particulars: "TIS/AIS — Attached Compulsory even though IF NIL",
  },
  { id: "form_26q_24q",     sr: 6,  particulars: "26Q/24Q" },
  { id: "form_27eq",        sr: 7,  particulars: "27EQ" },
  {
    id: "tds_challan",      sr: 8,
    particulars:
      "Challan of TDS/TCS paid after 31st March {fyEndYear} " +
      "duly matched with books closing balance",
  },
  { id: "tds_ack",          sr: 9,  particulars: "TDS Ackw Receipt" },
  {
    id: "gst_challan",      sr: 10,
    particulars:
      "Challan of GST paid after 31st March {fyEndYear} " +
      "duly matched with books closing balance",
  },
  {
    id: "ecl_ecash",        sr: 11,
    particulars: "Electronic Credit/Cash ledger matched with books & Reco.",
  },
  {
    id: "pf_esic_challan",  sr: 12,
    particulars:
      "Challan of PF/ESIC/PT paid after 31st March {fyEndYear} " +
      "duly matched with books closing balance",
  },
  {
    id: "bank_last_page",   sr: 13,
    particulars: "Bank/FD Last Page reflecting balance matched with books",
  },
  {
    id: "bank_recon",       sr: 14,
    particulars: "Bank Reconciliation Statement (If any)",
  },
  {
    id: "sec_loan_last",    sr: 15,
    particulars: "Secured Loan Last Page reflecting balance matched with books",
  },
  { id: "sec_loan_letter",  sr: 16, particulars: "Secured Loan Sanction Letter" },
  {
    id: "chapter_via",      sr: 17,
    particulars: "Chapter-VIA deduction Details & receipt of 80G (if applicable)",
  },
  { id: "unsec_loan_pan",   sr: 18, particulars: "Address and PAN of Unsecured Loan" },
  { id: "member_deposit",   sr: 19, particulars: "Address and PAN of Member Deposit" },
  {
    id: "stock_qty",        sr: 20,
    particulars: "Quantitative Details of Stock (if apply)",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fyEndYearFromDate(fyEndDate: string): string {
  if (!fyEndDate) return "____";
  const m = fyEndDate.match(/^(\d{4})/);
  return m ? m[1] : "____";
}

function injectYear(text: string, year: string): string {
  return text.replace(/\{fyEndYear\}/g, year);
}

/**
 * Determine content-type for upload.
 * Excel files must use application/octet-stream to bypass Supabase bucket
 * MIME-type allow-lists that don't include spreadsheet types.
 */
function resolveContentType(file: File): string {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "xlsx" || ext === "xls") return "application/octet-stream";
  if (ext === "doc" || ext === "docx") return "application/octet-stream";
  return file.type || "application/octet-stream";
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  data:         AuditWorksheetData;
  engagementId: string;
  onSaved?:     () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Checklist({ data, engagementId, onSaved }: Props) {
  const {
    data: checklistData,
    getRow,
    setRowField,
    addFileToRow,
    removeFileFromRow,
    toggleNA,
    addRow,
    manualSave,
    flushSave,
    saving,
  } = useChecklistSheetStorage(engagementId, data.engagement?.firm_id);

  const fyEndYear = fyEndYearFromDate(data.fyEndDate);

  // All rows = static defs + dynamic rows added by user
  const dynamicDefs: ChecklistDef[] = (checklistData.dynamicRowIds || []).map((id, i) => ({
    id,
    sr:          CHECKLIST_DEFS.length + i + 1,
    particulars: "",
    isCustom:    true,
  }));
  const allDefs = [...CHECKLIST_DEFS, ...dynamicDefs];

  // Count rows that have at least one document OR are marked N/A
  const filledCount = allDefs.filter(def => {
    const row = getRow(def.id);
    return row.files.length > 0 || row.is_na;
  }).length;

  // ── Document upload state ──────────────────────────────────────────────────
  const fileInputRef  = useRef<HTMLInputElement>(null);
  const [pendingRowId, setPendingRowId] = useState<string | null>(null);
  // uploadingRows: rowId → count of in-progress uploads
  const [uploadingRows, setUploadingRows] = useState<Record<string, number>>({});
  const [deletingFiles, setDeletingFiles] = useState<Record<string, boolean>>({});
  // Failed uploads — surfaced as a persistent banner. Each entry holds the
  // user-visible filename + a short error so the auditor sees exactly which
  // files were dropped and can retry. Closes the previously-silent loophole
  // where a toast scroll-off was the only indication of an upload failure.
  const [failedUploads, setFailedUploads] = useState<{ rowId: string; fileName: string; reason: string }[]>([]);
  const dismissFailure = (i: number) => setFailedUploads(prev => prev.filter((_, ix) => ix !== i));

  const openFilePicker = (rowId: string) => {
    setPendingRowId(rowId);
    if (fileInputRef.current) fileInputRef.current.value = "";
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length || !pendingRowId) return;

    const rowId = pendingRowId;
    setPendingRowId(null);

    for (const file of files) {
      // 10 MB guard
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`"${file.name}" exceeds 10 MB limit — skipped`);
        continue;
      }

      const def    = allDefs.find(d => d.id === rowId);
      const srNo   = def?.sr ?? 0;
      const safeName = file.name.replace(/\s+/g, "_");
      // Use a UUID instead of a timestamp so two near-simultaneous uploads
      // (multi-tab / two users) of files with the same name cannot collide
      // and silently overwrite each other in Storage. Combined with
      // upsert:false below, the bucket physically refuses an accidental
      // overwrite. Path format: `checklist/<engId>/<sr>_<uuid>_<name>`.
      const uid = (crypto as any)?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const filePath = `checklist/${engagementId}/${srNo}_${uid}_${safeName}`;
      const contentType = resolveContentType(file);

      setUploadingRows(prev => ({ ...prev, [rowId]: (prev[rowId] ?? 0) + 1 }));

      const { error } = await supabase.storage
        .from("documents")
        .upload(filePath, file, { upsert: false, contentType });

      setUploadingRows(prev => {
        const next = { ...prev, [rowId]: (prev[rowId] ?? 1) - 1 };
        if (next[rowId] <= 0) delete next[rowId];
        return next;
      });

      if (error) {
        toast.error(`Upload failed: "${file.name}" — ${error.message}`);
        // Persistent banner so the user sees the failure even after the
        // toast disappears, and can decide to retry.
        setFailedUploads(prev => [...prev, { rowId, fileName: file.name, reason: error.message }]);
        continue;
      }

      // addFileToRow is now async + flushes the save synchronously, so the
      // DB JSON reference lands together with the Storage object. No more
      // "uploaded but reference lost on tab-close" orphans. Uploader id +
      // timestamp are stamped inside the hook from useAuth().
      try {
        await addFileToRow(rowId, { file_path: filePath, file_name: file.name });
        toast.success(`"${file.name}" uploaded`);
      } catch (err: any) {
        // Save failed AFTER the upload succeeded — the file is in Storage
        // but unlinked. Roll back the Storage object so we never leave an
        // untraceable orphan in the bucket, and surface to the user.
        try { await supabase.storage.from("documents").remove([filePath]); } catch { /* best effort */ }
        toast.error(`Upload saved but database link failed: "${file.name}" — rolling back. Please retry.`);
        setFailedUploads(prev => [...prev, { rowId, fileName: file.name, reason: err?.message || "DB save failed" }]);
      }
    }
  };

  const handlePreview = (file: ChecklistFile) => {
    if (!file.file_path) return;
    // The "documents" bucket is public, so getPublicUrl() works for all users
    // with no auth round-trip needed.
    const { data } = supabase.storage.from("documents").getPublicUrl(file.file_path);
    const url = data?.publicUrl;
    if (!url) {
      toast.error("Could not generate preview link — please try again");
      return;
    }
    // Open via a synthesized <a target="_blank"> click, NOT window.open().
    // window.open("_blank") is silently blocked by ad-blocker extensions and
    // strict browser popup settings on some PCs — nothing opens and no error is
    // shown (the blocked call just returns null). A real anchor click is a direct
    // user-gesture navigation that popup blockers allow, so the document opens
    // reliably on every machine.
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleDeleteFile = async (rowId: string, file: ChecklistFile) => {
    const key = `${rowId}__${file.file_path}`;
    setDeletingFiles(prev => ({ ...prev, [key]: true }));

    // Order matters. Previously this called Storage.remove FIRST then
    // removeFileFromRow (debounced) — if the tab closed in between, the
    // JSON still pointed at a deleted blob and Preview would 404 silently
    // (getPublicUrl never validates object existence, it just composes a
    // URL). Now: drop the JSON reference + flush save FIRST, then Storage
    // delete. If Storage delete fails the JSON is already clean — only
    // the bucket holds an orphan, which the auditor can retry to purge.
    try {
      await removeFileFromRow(rowId, file.file_path);
    } catch (err: any) {
      setDeletingFiles(prev => { const n = { ...prev }; delete n[key]; return n; });
      toast.error(`Save failed before delete: ${err?.message || "unknown"}`);
      return;
    }

    const { error } = await supabase.storage
      .from("documents")
      .remove([file.file_path]);

    setDeletingFiles(prev => { const n = { ...prev }; delete n[key]; return n; });

    if (error) {
      // JSON pointer already removed — surface the storage residue without
      // restoring the link (the user clearly wanted the row clean of it).
      toast.error(`Reference removed but Storage delete failed: ${error.message}`);
      return;
    }
    toast.success("Document removed");
  };

  return (
    <div className="space-y-0 bg-card border rounded-lg overflow-hidden">

      {/* Hidden file input — shared by all rows, multiple selection enabled */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.xlsx,.xls,.doc,.docx,.csv,.txt"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* ══════════ PAGE HEADER ══════════ */}
      <div className="bg-violet-700 text-white px-6 py-4 space-y-0.5">
        <div className="flex items-center gap-2">
          <ClipboardCheck size={18} />
          <span className="text-base font-semibold tracking-wide">
            {data.firmName || "CA Firm"}
          </span>
        </div>
        <p className="text-[13px] font-bold opacity-95 tracking-widest uppercase">
          Audit Documentation
          {data.clientName ? ` — ${data.clientName}` : ""}
        </p>
      </div>

      {/* ══════════ FAILED-UPLOAD BANNER ══════════ */}
      {/* Persistent surface for every upload error so the auditor never has
          to wonder whether a file actually attached. Replaces the previous
          toast-only feedback (which could scroll off-screen before being
          noticed). Each row is dismissible after the user has triaged. */}
      {failedUploads.length > 0 && (
        <div className="border-b bg-red-50 border-red-300 px-4 py-2.5 space-y-1.5">
          <div className="text-xs font-semibold text-red-800">
            ⚠ {failedUploads.length} document upload{failedUploads.length === 1 ? "" : "s"} failed — please retry
          </div>
          {failedUploads.map((f, i) => (
            <div key={i} className="flex items-center justify-between text-xs bg-white border border-red-200 rounded px-2 py-1">
              <span className="truncate">
                <span className="font-medium">{f.fileName}</span>
                <span className="text-muted-foreground"> — {f.reason}</span>
              </span>
              <button
                type="button"
                onClick={() => dismissFailure(i)}
                className="text-red-700 hover:text-red-900 ml-2 text-[11px] underline"
              >Dismiss</button>
            </div>
          ))}
        </div>
      )}

      {/* ══════════ TOOLBAR ══════════ */}
      <div className="border-b bg-muted/30 px-4 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              className="gap-1 h-7 text-xs border-violet-300 text-violet-700 hover:bg-violet-50"
              onClick={addRow}
            >
              <Plus size={12} /> Add Row
            </Button>
          </div>
          <Button
            size="sm"
            className="gap-1 h-7 text-xs bg-violet-700 hover:bg-violet-800"
            onClick={async () => { await manualSave(); onSaved?.(); }}
            disabled={saving}
          >
            {saving
              ? <Loader2 size={12} className="animate-spin" />
              : <Save    size={12} />
            }
            Save
          </Button>
        </div>
      </div>

      {/* ══════════ TABLE ══════════ */}
      <div className="overflow-auto">
        <table className="w-full text-sm border-collapse min-w-[540px]">
          <thead>
            <tr className="bg-violet-700 text-white text-[11px] uppercase tracking-wide">
              <th className="border border-violet-600 px-2 py-2.5 text-center w-10">Sr.</th>
              <th className="border border-violet-600 px-3 py-2.5 text-left w-full min-w-[380px]">Particulars</th>
              <th className="border border-violet-600 px-2 py-2.5 text-center w-52 min-w-[208px]">Documents</th>
            </tr>
          </thead>
          <tbody>
            {allDefs.map(def => {
              const row = getRow(def.id);
              const defaultText = def.isCustom
                ? ""
                : injectYear(def.particulars, fyEndYear);
              const displayValue = row.particulars !== "" ? row.particulars : defaultText;
              const isUploading = (uploadingRows[def.id] ?? 0) > 0;

              const isNA = !!row.is_na;

              return (
                <tr
                  key={def.id}
                  className={`align-top transition-colors ${isNA ? "bg-amber-50/40 dark:bg-amber-950/10" : "hover:bg-muted/10"}`}
                >
                  {/* Sr No */}
                  <td className="border border-border px-2 py-2 text-center">
                    <span className={`text-xs font-mono ${isNA ? "text-foreground/70" : "text-muted-foreground"}`}>
                      {def.sr}
                    </span>
                  </td>

                  {/* Particulars
                      N/A styling: previously combined `opacity-60` on the row
                      with `line-through text-muted-foreground` on the input —
                      stacked together they made the text effectively
                      unreadable. New treatment keeps the text at FULL contrast
                      so the auditor can still see what was marked N/A; only
                      the row background gets a subtle amber tint plus a
                      strike-through on the input so the N/A state stays
                      visually distinct without losing legibility. */}
                  <td className="border border-border px-3 py-2 w-full">
                    <Input
                      className={`h-7 text-xs w-full border-dashed whitespace-normal ${isNA ? "line-through text-foreground italic disabled:opacity-100 disabled:cursor-not-allowed disabled:bg-amber-50/60 dark:disabled:bg-amber-950/20" : ""}`}
                      placeholder={defaultText || "Enter item description…"}
                      value={displayValue}
                      disabled={isNA}
                      onChange={e =>
                        setRowField(def.id, "particulars", e.target.value)
                      }
                    />
                  </td>

                  {/* Documents — shows all uploaded files + upload/NA buttons */}
                  <td className="border border-border px-2 py-2 text-center w-52">
                    <div className="flex flex-col items-center gap-1.5">

                      {isNA ? (
                        /* N/A state */
                        <div className="flex flex-col items-center gap-1">
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 bg-slate-200 rounded px-2 py-0.5">
                            <Ban size={9} /> Not Applicable
                          </span>
                          <button
                            className="text-[9px] text-violet-600 hover:underline"
                            onClick={() => toggleNA(def.id)}
                          >
                            Undo
                          </button>
                        </div>
                      ) : (
                        <>
                          {/* Existing files list */}
                          {row.files.map(file => {
                            const deleteKey = `${def.id}__${file.file_path}`;
                            const isDeleting = !!deletingFiles[deleteKey];
                            return (
                              <div
                                key={file.file_path}
                                className="flex items-center gap-1 w-full max-w-[192px] bg-muted/40 rounded px-1.5 py-0.5"
                              >
                                <span
                                  className="text-[10px] text-muted-foreground flex-1 truncate min-w-0"
                                  title={(() => {
                                    // Show forensic metadata on hover — uploader name +
                                    // ISO timestamp — so the auditor can answer
                                    // "who attached this and when" without leaving the page.
                                    const lines = [file.file_name];
                                    if (file.uploaded_by_name) lines.push(`Uploaded by: ${file.uploaded_by_name}`);
                                    if (file.uploaded_at) {
                                      try { lines.push(`At: ${new Date(file.uploaded_at).toLocaleString()}`); }
                                      catch { /* fallback to raw */ lines.push(`At: ${file.uploaded_at}`); }
                                    }
                                    return lines.join("\n");
                                  })()}
                                >
                                  {file.file_name}
                                </span>
                                <button
                                  className="shrink-0 text-violet-700 hover:text-violet-900 p-0.5 rounded"
                                  title="Preview"
                                  onClick={() => handlePreview(file)}
                                >
                                  <Eye size={10} />
                                </button>
                                <button
                                  className="shrink-0 text-destructive hover:text-destructive/80 p-0.5 rounded disabled:opacity-40"
                                  title="Delete"
                                  disabled={isDeleting}
                                  onClick={() => handleDeleteFile(def.id, file)}
                                >
                                  {isDeleting
                                    ? <Loader2 size={10} className="animate-spin" />
                                    : <Trash2  size={10} />
                                  }
                                </button>
                              </div>
                            );
                          })}

                          <div className="flex items-center gap-1.5">
                            {/* Upload button */}
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-[10px] gap-0.5 px-2 border-violet-300 text-violet-700 hover:bg-violet-50"
                              onClick={() => openFilePicker(def.id)}
                              disabled={isUploading}
                            >
                              {isUploading
                                ? <Loader2 size={10} className="animate-spin" />
                                : <Paperclip size={10} />
                              }
                              {isUploading ? "Uploading…" : row.files.length > 0 ? "+ Add" : "Upload"}
                            </Button>

                            {/* N/A button — only when no files attached */}
                            {row.files.length === 0 && !isUploading && (
                              <button
                                className="h-6 text-[10px] px-1.5 rounded border border-slate-300 text-slate-500 hover:bg-slate-100 flex items-center gap-0.5"
                                title="Mark as Not Applicable"
                                onClick={() => toggleNA(def.id)}
                              >
                                <Ban size={9} /> N/A
                              </button>
                            )}
                          </div>
                        </>
                      )}

                    </div>
                  </td>

                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ══════════ FOOTER ══════════ */}
      <div className="border-t bg-muted/20 px-4 py-2 flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          {filledCount === allDefs.length
            ? `✓ All ${allDefs.length} documents uploaded`
            : `${filledCount} / ${allDefs.length} documents uploaded`}
        </p>
        {saving && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 size={11} className="animate-spin" /> Auto-saving…
          </p>
        )}
      </div>
    </div>
  );
}
