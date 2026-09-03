/**
 * UploadConfirmDialog
 *
 * Gates the "3CA/3CB+3CD Uploaded By" column. Nothing is saved to the row
 * until all four are present together:
 *  1. Scanned Audit Report file — AI-checked against the client's name
 *  2. Filed Form 3CA/3CB + 3CD file — AI-checked against the client's name
 *  3. Upload Date — AI-read off the filed form, always editable
 *  4. Uploaded By — defaults to the logged-in user, always editable
 *
 * Either file is REJECTED (Confirm stays disabled) if the AI reads a
 * different assessee name off it than this row's client — using the same
 * hardened name-comparison engine the TDS module uses (src/lib/tds/match.ts),
 * not a fresh ad-hoc string compare. A name the AI can't read at all never
 * blocks the upload — only a name it CAN read and that clearly disagrees.
 *
 * Re-openable after completion (existing files/date/name prefill) so a
 * mistake can be corrected later — each confirm still goes through the
 * row's normal autosave path (useAuditStatus.updateRow), which already
 * writes audit_status_history on every change.
 */
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input }  from "@/components/ui/input";
import { Label }  from "@/components/ui/label";
import { FileText, ScanLine, Loader2, CheckCircle2, AlertCircle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { UserCombobox } from "./AuditStatusRow";
import { nameCompare } from "@/lib/tds/match";
import type { UserOption } from "../hooks/useUsers";
import type { StatusEntry } from "../hooks/useAuditStatus";
import {
  storeUpload, listUploads, uploadFileUrl, extractDocumentInfo,
  type UploadKind, type StoredUpload,
} from "@/lib/auditStatusUploads";

interface Props {
  open: boolean;
  onClose: () => void;
  row: StatusEntry;
  users: UserOption[];
  currentUserId: string | null;
  currentUserName: string | null;
  /** Persist { uploaded_by, upload_date } via the row's normal autosave path. */
  onConfirm: (patch: { uploaded_by: string; upload_date: string }) => Promise<void>;
}

function FilePickerRow({
  label, icon, existing, picked, onPick, checking, nameIssue,
}: {
  label: string;
  icon: React.ReactNode;
  existing: StoredUpload | null;
  picked: File | null;
  onPick: (f: File | null) => void;
  checking?: boolean;
  nameIssue?: string | null;
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (existing && !picked) {
      uploadFileUrl(existing.storage_path).then(url => { if (active) setSignedUrl(url); });
    } else {
      setSignedUrl(null);
    }
    return () => { active = false; };
  }, [existing?.storage_path, picked]);

  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium flex items-center gap-1.5">{icon}{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          type="file"
          accept=".pdf,image/*"
          onChange={e => onPick(e.target.files?.[0] ?? null)}
          className="h-8 text-[11px] file:h-full file:mr-2 file:border-0 file:bg-indigo-50 file:text-indigo-700 file:text-[11px] file:px-2 file:rounded"
        />
        {checking && <Loader2 size={14} className="animate-spin text-indigo-500 shrink-0" />}
      </div>
      {nameIssue ? (
        <p className="text-[10px] text-red-600 flex items-center gap-1"><AlertCircle size={11} className="shrink-0" /> {nameIssue}</p>
      ) : picked ? (
        <p className="text-[10px] text-emerald-600 flex items-center gap-1">
          <CheckCircle2 size={11} /> {picked.name} — will replace{existing ? " existing file" : ""}
        </p>
      ) : existing ? (
        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
          On file: {existing.file_name}
          {signedUrl && (
            <a href={signedUrl} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline inline-flex items-center gap-0.5">
              view <ExternalLink size={9} />
            </a>
          )}
        </p>
      ) : (
        <p className="text-[10px] text-amber-600 flex items-center gap-1"><AlertCircle size={11} /> Required</p>
      )}
    </div>
  );
}

export default function UploadConfirmDialog({
  open, onClose, row, users, currentUserId, currentUserName, onConfirm,
}: Props) {
  const [existing, setExisting]           = useState<Record<UploadKind, StoredUpload | null>>({ scanned_report: null, filed_form: null });
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [scannedFile, setScannedFile]     = useState<File | null>(null);
  const [filedFormFile, setFiledFormFile] = useState<File | null>(null);
  const [scannedChecking, setScannedChecking] = useState(false);
  const [filedChecking, setFiledChecking]     = useState(false);
  const [scannedNameIssue, setScannedNameIssue] = useState<string | null>(null);
  const [filedNameIssue, setFiledNameIssue]     = useState<string | null>(null);
  const [uploadDate, setUploadDate]       = useState("");
  const [uploaderName, setUploaderName]   = useState("");
  const [submitting, setSubmitting]       = useState(false);
  const [error, setError]                 = useState<string | null>(null);

  // Reset + prefill every time the dialog is opened for a (possibly different) row.
  useEffect(() => {
    if (!open) return;
    setScannedFile(null);
    setFiledFormFile(null);
    setScannedNameIssue(null);
    setFiledNameIssue(null);
    setError(null);
    setUploadDate(row.upload_date || "");
    setUploaderName(row.uploaded_by || currentUserName || "");
    setLoadingExisting(true);
    listUploads(row.id).then(u => {
      setExisting(u);
      setLoadingExisting(false);
    });
  }, [open, row.id]); // eslint-disable-line

  function mismatchMessage(extractedName: string) {
    return `This file appears to be for "${extractedName}", not "${row.party_name || "this client"}". Upload blocked — please attach the correct file.`;
  }

  async function handleScannedPick(file: File | null) {
    setScannedFile(file);
    setScannedNameIssue(null);
    if (!file) return;
    setScannedChecking(true);
    try {
      const info = await extractDocumentInfo(file);
      if (info.assesseeName) {
        const cmp = nameCompare(info.assesseeName, row.party_name);
        if (cmp === "different" || cmp === "mismatch") setScannedNameIssue(mismatchMessage(info.assesseeName));
      }
    } finally {
      setScannedChecking(false);
    }
  }

  async function handleFiledFormPick(file: File | null) {
    setFiledFormFile(file);
    setFiledNameIssue(null);
    if (!file) return;
    setFiledChecking(true);
    try {
      const info = await extractDocumentInfo(file);
      if (info.date) setUploadDate(info.date);
      else if (info.confidence === "unavailable") {
        toast.info("Couldn't auto-read the filing date — please enter it manually.");
      }
      if (info.assesseeName) {
        const cmp = nameCompare(info.assesseeName, row.party_name);
        if (cmp === "different" || cmp === "mismatch") setFiledNameIssue(mismatchMessage(info.assesseeName));
      }
    } finally {
      setFiledChecking(false);
    }
  }

  const hasScanned  = !!scannedFile || !!existing.scanned_report;
  const hasFiled    = !!filedFormFile || !!existing.filed_form;
  const canConfirm  =
    hasScanned && hasFiled &&
    uploadDate.trim() !== "" && uploaderName.trim() !== "" &&
    !scannedNameIssue && !filedNameIssue &&
    !scannedChecking && !filedChecking &&
    !submitting;

  async function handleConfirm() {
    if (!row.firm_id) {
      setError("This row has no firm assigned — cannot attach files.");
      return;
    }
    if (scannedNameIssue || filedNameIssue) {
      setError("Resolve the name mismatch before confirming.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (scannedFile) {
        const r = await storeUpload({
          auditStatusId: row.id, firmId: row.firm_id, kind: "scanned_report",
          file: scannedFile, userId: currentUserId, userName: currentUserName,
        });
        if (r.error) throw new Error(`Scanned report upload failed: ${r.error}`);
      }
      if (filedFormFile) {
        const r = await storeUpload({
          auditStatusId: row.id, firmId: row.firm_id, kind: "filed_form",
          file: filedFormFile, userId: currentUserId, userName: currentUserName,
        });
        if (r.error) throw new Error(`Filed form upload failed: ${r.error}`);
      }
      await onConfirm({ uploaded_by: uploaderName, upload_date: uploadDate });
      toast.success("Upload confirmed");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Confirm 3CA/3CB+3CD Upload</DialogTitle>
          <p className="text-xs text-muted-foreground">{row.party_name || "This client"}</p>
        </DialogHeader>

        {loadingExisting ? (
          <div className="py-6 flex items-center justify-center text-muted-foreground text-xs gap-2">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-4">
            <FilePickerRow
              label="Scanned Audit Report"
              icon={<ScanLine size={13} className="text-slate-500" />}
              existing={existing.scanned_report}
              picked={scannedFile}
              onPick={handleScannedPick}
              checking={scannedChecking}
              nameIssue={scannedNameIssue}
            />
            <FilePickerRow
              label="Filed Form 3CA/3CB + 3CD"
              icon={<FileText size={13} className="text-slate-500" />}
              existing={existing.filed_form}
              picked={filedFormFile}
              onPick={handleFiledFormPick}
              checking={filedChecking}
              nameIssue={filedNameIssue}
            />

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                Upload Date {filedChecking && <span className="text-indigo-500 font-normal">(reading from filed form…)</span>}
              </Label>
              <Input
                type="date"
                value={uploadDate}
                onChange={e => setUploadDate(e.target.value)}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Uploaded By</Label>
              <UserCombobox value={uploaderName} onChange={setUploaderName} users={users} placeholder="Select name…" />
            </div>

            {error && (
              <p className="text-[11px] text-red-600 flex items-center gap-1"><AlertCircle size={12} /> {error}</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button
            size="sm"
            className={cn("bg-emerald-600 hover:bg-emerald-700", !canConfirm && "opacity-50")}
            onClick={handleConfirm}
            disabled={!canConfirm}
          >
            {submitting ? <Loader2 size={13} className="animate-spin mr-1.5" /> : <CheckCircle2 size={13} className="mr-1.5" />}
            Confirm Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
