/**
 * ItrFiledConfirmDialog
 *
 * Gates the "Filed" (and "Sent to CPC") status transition for every IT
 * Returns sub-tab except Non-ITR. Nothing is saved to the row until all
 * four are present together:
 *  1. ITR Acknowledgement (ITR-V) — PDF only, rejected client-side otherwise
 *  2. Computation of Income — PDF or Word, rejected client-side otherwise
 *  3. Acknowledgement Number — AI-read off the Acknowledgement, always editable
 *  4. Filed By — defaults to the logged-in user, always editable
 *
 * Mirrors src/components/audit-tracker/audit-status/UploadConfirmDialog.tsx.
 * Re-openable afterward (existing files/ack-no/name prefill) so a mistake
 * can be corrected later. Internally the upload `kind` stays "itr_form"
 * (DB/storage identifier, invisible to the user) — only the user-facing
 * label changed to match what auditors actually call this document.
 */
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input }  from "@/components/ui/input";
import { Label }  from "@/components/ui/label";
import { FileText, Calculator, Loader2, CheckCircle2, AlertCircle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { UserCombobox, type ComboUser } from "@/components/shared/UserCombobox";
import {
  storeItrUpload, listItrUploads, itrUploadFileUrl, extractAckNumber,
  type ItrUploadKind, type StoredItrUpload,
} from "@/lib/itrStatusUploads";

interface ItrProfileLike {
  id: string;
  client_id: string | null;
  firm_id: string | null;
  client_name?: string;
  acknowledgment_no: string | null;
  upload_by?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  profile: ItrProfileLike;
  pendingStatus: string;
  staffUsers: ComboUser[];
  currentUserId: string | null;
  currentUserName: string | null;
  firmId: string | null;
  /** Resolves (creating if necessary) a real itr_profiles row and returns its id. */
  ensureRealProfileId: (profile: ItrProfileLike) => Promise<string>;
  /** Commits { acknowledgment_no, upload_by } + the pending status via the row's normal update path. */
  onConfirm: (realProfileId: string, patch: { acknowledgment_no: string; upload_by: string }) => Promise<void>;
}

const WORD_TYPES = [
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

/** PDF or Word (.doc/.docx) — Computation of Income accepts either. */
function isPdfOrWord(file: File): boolean {
  return isPdf(file) || WORD_TYPES.includes(file.type) || /\.docx?$/i.test(file.name);
}

function FilePickerRow({
  label, icon, existing, picked, onPick, checking, typeError, accept, typeHint,
}: {
  label: string;
  icon: React.ReactNode;
  existing: StoredItrUpload | null;
  picked: File | null;
  onPick: (f: File | null) => void;
  checking?: boolean;
  typeError?: string | null;
  accept: string;
  typeHint: string;
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (existing && !picked) {
      itrUploadFileUrl(existing.storage_path).then(url => { if (active) setSignedUrl(url); });
    } else {
      setSignedUrl(null);
    }
    return () => { active = false; };
  }, [existing?.storage_path, picked]);

  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium flex items-center gap-1.5">{icon}{label} <span className="text-muted-foreground font-normal">({typeHint})</span></Label>
      <div className="flex items-center gap-2">
        <Input
          type="file"
          accept={accept}
          onChange={e => onPick(e.target.files?.[0] ?? null)}
          className="h-8 text-[11px] file:h-full file:mr-2 file:border-0 file:bg-indigo-50 file:text-indigo-700 file:text-[11px] file:px-2 file:rounded"
        />
        {checking && <Loader2 size={14} className="animate-spin text-indigo-500 shrink-0" />}
      </div>
      {typeError ? (
        <p className="text-[10px] text-red-600 flex items-center gap-1"><AlertCircle size={11} className="shrink-0" /> {typeError}</p>
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

export default function ItrFiledConfirmDialog({
  open, onClose, profile, pendingStatus, staffUsers,
  currentUserId, currentUserName, firmId, ensureRealProfileId, onConfirm,
}: Props) {
  const [existing, setExisting]                 = useState<Record<ItrUploadKind, StoredItrUpload | null>>({ itr_form: null, computation_of_income: null });
  const [loadingExisting, setLoadingExisting]    = useState(false);
  const [itrFormFile, setItrFormFile]            = useState<File | null>(null);
  const [computationFile, setComputationFile]    = useState<File | null>(null);
  const [itrFormTypeError, setItrFormTypeError]  = useState<string | null>(null);
  const [computationTypeError, setComputationTypeError] = useState<string | null>(null);
  const [ackChecking, setAckChecking]            = useState(false);
  const [ackNo, setAckNo]                        = useState("");
  const [filedByName, setFiledByName]            = useState("");
  const [submitting, setSubmitting]              = useState(false);
  const [error, setError]                        = useState<string | null>(null);

  const isRealProfile = !profile.id.startsWith("virtual_") && !profile.id.startsWith("new_");

  useEffect(() => {
    if (!open) return;
    setItrFormFile(null);
    setComputationFile(null);
    setItrFormTypeError(null);
    setComputationTypeError(null);
    setError(null);
    setAckNo(profile.acknowledgment_no || "");
    // upload_by is a user-id FK — resolve it to a name for display; fall
    // back to the logged-in user's name when the row hasn't been filed yet.
    const existingFilerName = staffUsers.find(u => u.id === profile.upload_by)?.name;
    setFiledByName(existingFilerName || currentUserName || "");
    if (isRealProfile) {
      setLoadingExisting(true);
      listItrUploads(profile.id).then(u => {
        setExisting(u);
        setLoadingExisting(false);
      });
    } else {
      setExisting({ itr_form: null, computation_of_income: null });
    }
  }, [open, profile.id]); // eslint-disable-line

  function handleItrFormPick(file: File | null) {
    setItrFormFile(file);
    setItrFormTypeError(null);
    if (!file) return;
    if (!isPdf(file)) {
      setItrFormTypeError("Only PDF files are allowed for the ITR Acknowledgement.");
      setItrFormFile(null);
      return;
    }
    setAckChecking(true);
    extractAckNumber(file).then(result => {
      if (result.acknowledgmentNo) setAckNo(result.acknowledgmentNo);
      else toast.info("Couldn't auto-read the acknowledgement number — please enter it manually.");
    }).finally(() => setAckChecking(false));
  }

  function handleComputationPick(file: File | null) {
    setComputationFile(file);
    setComputationTypeError(null);
    if (!file) return;
    if (!isPdfOrWord(file)) {
      setComputationTypeError("Only PDF or Word files are allowed for Computation of Income.");
      setComputationFile(null);
    }
  }

  const hasItrForm     = !!itrFormFile || !!existing.itr_form;
  const hasComputation = !!computationFile || !!existing.computation_of_income;
  const canConfirm =
    hasItrForm && hasComputation &&
    ackNo.trim() !== "" && filedByName.trim() !== "" &&
    !itrFormTypeError && !computationTypeError &&
    !ackChecking && !submitting;

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      // itr_profiles.upload_by is a user-id FK (unlike Audit Tracker's plain-
      // text uploaded_by) — resolve the picked NAME back to its id. The
      // UserCombobox only ever commits a name that's actually in `staffUsers`,
      // so this should always resolve; erroring instead of silently sending
      // a blank id guards against a stale/duplicate-name edge case.
      const filedById = staffUsers.find(u => u.name === filedByName)?.id;
      if (!filedById) throw new Error("Selected name not found in staff list — pick it again.");

      const realId = await ensureRealProfileId(profile);
      const resolvedFirmId = profile.firm_id || firmId;
      if (!resolvedFirmId) throw new Error("This row has no firm assigned — cannot attach files.");

      if (itrFormFile) {
        const r = await storeItrUpload({
          itrProfileId: realId, firmId: resolvedFirmId, kind: "itr_form",
          file: itrFormFile, userId: currentUserId, userName: currentUserName,
        });
        if (r.error) throw new Error(`ITR Acknowledgement upload failed: ${r.error}`);
      }
      if (computationFile) {
        const r = await storeItrUpload({
          itrProfileId: realId, firmId: resolvedFirmId, kind: "computation_of_income",
          file: computationFile, userId: currentUserId, userName: currentUserName,
        });
        if (r.error) throw new Error(`Computation of Income upload failed: ${r.error}`);
      }
      await onConfirm(realId, { acknowledgment_no: ackNo.trim(), upload_by: filedById });
      toast.success(`Marked as ${pendingStatus}`);
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
          <DialogTitle className="text-base">Confirm ITR Filed</DialogTitle>
          <p className="text-xs text-muted-foreground">{profile.client_name || "This client"} — marking as "{pendingStatus}"</p>
        </DialogHeader>

        {loadingExisting ? (
          <div className="py-6 flex items-center justify-center text-muted-foreground text-xs gap-2">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-4">
            <FilePickerRow
              label="ITR Acknowledgement"
              icon={<FileText size={13} className="text-slate-500" />}
              existing={existing.itr_form}
              picked={itrFormFile}
              onPick={handleItrFormPick}
              checking={ackChecking}
              typeError={itrFormTypeError}
              accept="application/pdf,.pdf"
              typeHint="PDF only"
            />
            <FilePickerRow
              label="Computation of Income"
              icon={<Calculator size={13} className="text-slate-500" />}
              existing={existing.computation_of_income}
              picked={computationFile}
              onPick={handleComputationPick}
              typeError={computationTypeError}
              accept="application/pdf,.pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              typeHint="PDF or Word"
            />

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                Acknowledgement Number {ackChecking && <span className="text-indigo-500 font-normal">(reading from ITR Acknowledgement…)</span>}
              </Label>
              <Input
                value={ackNo}
                onChange={e => setAckNo(e.target.value)}
                placeholder="e.g. 801238220260826"
                className="h-8 text-xs font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Filed By</Label>
              <UserCombobox value={filedByName} onChange={setFiledByName} users={staffUsers} placeholder="Select name…" />
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
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
