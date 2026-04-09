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
 * Each row has a Document upload column (PDF / image, 5 MB max).
 */
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Button }  from "@/components/ui/button";
import { Input }   from "@/components/ui/input";
import { Save, Loader2, ClipboardCheck, Plus, Paperclip, Eye, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useChecklistSheetStorage } from "./hooks/useChecklistSheetStorage";
import type { AuditWorksheetData }  from "./hooks/useAuditWorksheetData";

// ─── Static row definitions ───────────────────────────────────────────────────

interface ChecklistDef {
  id:          string;
  sr:          number;
  particulars: string;   // may contain "{fyEndYear}" placeholder
  isCustom?:   boolean;  // rows 21-22: user-editable particulars
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

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  data:         AuditWorksheetData;
  engagementId: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Checklist({ data, engagementId }: Props) {
  const { data: checklistData, getRow, setRowField, patchRowFields, addRow, manualSave, saving } =
    useChecklistSheetStorage(engagementId, data.engagement?.firm_id);

  const fyEndYear = fyEndYearFromDate(data.fyEndDate);

  // All rows = static defs + dynamic rows added by user
  const dynamicDefs: ChecklistDef[] = (checklistData.dynamicRowIds || []).map((id, i) => ({
    id,
    sr:          CHECKLIST_DEFS.length + i + 1,
    particulars: "",
    isCustom:    true,
  }));
  const allDefs = [...CHECKLIST_DEFS, ...dynamicDefs];

  // Count rows where at least one page number is filled
  const filledCount = allDefs.filter(def => {
    const row = getRow(def.id);
    return row.page_from.trim() !== "" || row.page_to.trim() !== "";
  }).length;
  const pct = Math.round((filledCount / allDefs.length) * 100);

  // ── Document upload state ──────────────────────────────────────────────────
  const fileInputRef  = useRef<HTMLInputElement>(null);
  const [pendingRowId, setPendingRowId] = useState<string | null>(null);
  const [uploadingRows, setUploadingRows] = useState<Record<string, boolean>>({});
  const [deletingRows,  setDeletingRows]  = useState<Record<string, boolean>>({});

  const openFilePicker = (rowId: string) => {
    setPendingRowId(rowId);
    if (fileInputRef.current) fileInputRef.current.value = "";
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !pendingRowId) return;

    // 5 MB guard
    if (file.size > 5 * 1024 * 1024) {
      toast.error("File exceeds 5MB limit");
      setPendingRowId(null);
      return;
    }

    const def    = allDefs.find(d => d.id === pendingRowId);
    const srNo   = def?.sr ?? 0;
    // Sanitise filename: replace spaces with underscores
    const safeName = file.name.replace(/\s+/g, "_");
    const filePath = `checklist/${engagementId}/${srNo}_${safeName}`;

    setUploadingRows(prev => ({ ...prev, [pendingRowId]: true }));

    const { error } = await supabase.storage
      .from("documents")
      .upload(filePath, file, { upsert: true });

    setUploadingRows(prev => ({ ...prev, [pendingRowId]: false }));

    if (error) {
      toast.error(`Upload failed: ${error.message}`);
      setPendingRowId(null);
      return;
    }

    patchRowFields(pendingRowId, { file_path: filePath, file_name: file.name });
    toast.success(`"${file.name}" uploaded`);
    setPendingRowId(null);
  };

  const handlePreview = (rowId: string) => {
    const row = getRow(rowId);
    if (!row.file_path) return;
    const { data: urlData } = supabase.storage
      .from("documents")
      .getPublicUrl(row.file_path);
    window.open(urlData.publicUrl, "_blank", "noreferrer");
  };

  const handleDelete = async (rowId: string) => {
    const row = getRow(rowId);
    if (!row.file_path) return;

    setDeletingRows(prev => ({ ...prev, [rowId]: true }));

    const { error } = await supabase.storage
      .from("documents")
      .remove([row.file_path]);

    setDeletingRows(prev => ({ ...prev, [rowId]: false }));

    if (error) {
      toast.error(`Delete failed: ${error.message}`);
      return;
    }

    patchRowFields(rowId, { file_path: "", file_name: "" });
    toast.success("Document removed");
  };

  return (
    <div className="space-y-0 bg-card border rounded-lg overflow-hidden">

      {/* Hidden file input — shared by all rows */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.xlsx,.xls,.doc,.docx,.csv"
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
            onClick={manualSave}
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
        <table className="w-full text-sm border-collapse min-w-[820px]">
          <thead>
            <tr className="bg-violet-700 text-white text-[11px] uppercase tracking-wide">
              <th className="border border-violet-600 px-2 py-2.5 text-center w-12">Sr.</th>
              <th className="border border-violet-600 px-3 py-2.5 text-left">Particulars</th>
              <th className="border border-violet-600 px-2 py-2.5 text-center min-w-[180px]">Document</th>
              <th className="border border-violet-600 px-2 py-2.5 text-center w-36">
                Page Number From
              </th>
              <th className="border border-violet-600 px-2 py-2.5 text-center w-36">
                Page Number To
              </th>
            </tr>
          </thead>
          <tbody>
            {allDefs.map(def => {
              const row = getRow(def.id);
              const hasBoth   = row.page_from.trim() !== "" && row.page_to.trim() !== "";
              const defaultText = def.isCustom
                ? ""
                : injectYear(def.particulars, fyEndYear);
              const displayValue = row.particulars !== "" ? row.particulars : defaultText;

              return (
                <tr
                  key={def.id}
                  className={cn(
                    "align-middle hover:bg-muted/10 transition-colors",
                    hasBoth && "bg-green-50/50"
                  )}
                >
                  {/* Sr No */}
                  <td className="border border-border px-2 py-2 text-center">
                    <span className="text-xs font-mono text-muted-foreground">
                      {def.sr}
                    </span>
                  </td>

                  {/* Particulars */}
                  <td className="border border-border px-3 py-2">
                    <Input
                      className="h-7 text-xs w-full border-dashed"
                      placeholder={defaultText || "Enter item description…"}
                      value={displayValue}
                      onChange={e =>
                        setRowField(def.id, "particulars", e.target.value)
                      }
                    />
                  </td>

                  {/* Document */}
                  <td className="border border-border px-2 py-2 text-center">
                    {row.file_name ? (
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-[10px] text-muted-foreground max-w-[160px] truncate" title={row.file_name}>
                          {row.file_name}
                        </span>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] gap-0.5 px-2 border-violet-300 text-violet-700 hover:bg-violet-50"
                            onClick={() => handlePreview(def.id)}
                          >
                            <Eye size={10} /> Preview
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-[10px] gap-0.5 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => handleDelete(def.id)}
                            disabled={deletingRows[def.id]}
                          >
                            {deletingRows[def.id]
                              ? <Loader2 size={10} className="animate-spin" />
                              : <Trash2 size={10} />
                            }
                            Delete
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] gap-0.5 px-2 border-violet-300 text-violet-700 hover:bg-violet-50"
                        onClick={() => openFilePicker(def.id)}
                        disabled={uploadingRows[def.id]}
                      >
                        {uploadingRows[def.id]
                          ? <Loader2 size={10} className="animate-spin" />
                          : <Paperclip size={10} />
                        }
                        {uploadingRows[def.id] ? "Uploading…" : "Upload"}
                      </Button>
                    )}
                  </td>

                  {/* Page From */}
                  <td className="border border-border px-2 py-2 text-center">
                    <Input
                      type="number"
                      min="1"
                      className="h-7 text-xs text-center w-full"
                      placeholder="—"
                      value={row.page_from}
                      onChange={e =>
                        setRowField(def.id, "page_from", e.target.value)
                      }
                    />
                  </td>

                  {/* Page To */}
                  <td className="border border-border px-2 py-2 text-center">
                    <Input
                      type="number"
                      min="1"
                      className="h-7 text-xs text-center w-full"
                      placeholder="—"
                      value={row.page_to}
                      onChange={e =>
                        setRowField(def.id, "page_to", e.target.value)
                      }
                    />
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
          {pct === 100
            ? `✓ All ${allDefs.length} documents page-numbered`
            : `${allDefs.length - filledCount} document(s) without page numbers`}
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
