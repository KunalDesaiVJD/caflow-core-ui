/**
 * CorporateSignatureBlock — shared audit-report signature block.
 *
 * Three-column layout used at the bottom of every signed deliverable:
 *   • Notes to Accounts
 *   • Balance Sheet / P&L  (already used inside PipelineFinancialStatements)
 *   • CARO Annexure
 *   • MRL (Management Representation Letter)
 *
 * Auditor side (firm + partner) is read-only and auto-fetched.
 * Director side and Place / Date are editable inline and persisted to
 * localStorage per engagement so a single edit on any page updates them
 * everywhere.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface FirmContext {
  firmName:     string;
  firmRegNo:    string;
  partnerName:  string;
  partnerMemNo: string;
}

interface DirectorContext {
  dir1Name: string;
  dir1Din:  string;
  dir2Name: string;
  dir2Din:  string;
  place:    string;
  date:     string;   // ISO yyyy-mm-dd
}

interface Props {
  engagementId:  string;
  companyName?:  string | null;
  /** When true, render plain text only (no editable inputs). */
  readOnly?:     boolean;
  /** Override the leading line, default = "As per our Audit Report of even date" */
  preface?:      string;
  className?:    string;
}

const DIR_KEY  = (eid: string) => `caflow:fs_sig_directors:${eid}`;
const PLACE_KEY = (eid: string) => `caflow:fs_sig_place:${eid}`;
const DATE_KEY  = (eid: string) => `caflow:fs_sig_date:${eid}`;

const editableCls =
  "bg-background/40 border border-dashed border-muted-foreground/30 rounded px-1 cursor-text " +
  "hover:bg-background hover:border-muted-foreground/60 focus:border-primary focus:bg-background focus:border-solid outline-none";

export function CorporateSignatureBlock({
  engagementId, companyName, readOnly = false, preface, className,
}: Props) {
  const [firm, setFirm] = useState<FirmContext>({
    firmName: "", firmRegNo: "", partnerName: "", partnerMemNo: "",
  });
  const [dir, setDir] = useState<DirectorContext>(() => {
    if (typeof window === "undefined") {
      return { dir1Name: "", dir1Din: "", dir2Name: "", dir2Din: "", place: "Ahmedabad", date: new Date().toISOString().slice(0, 10) };
    }
    try {
      const raw = localStorage.getItem(DIR_KEY(engagementId));
      const parsed = raw ? JSON.parse(raw) : {};
      return {
        dir1Name: parsed.dir1Name ?? "",
        dir1Din:  parsed.dir1Din  ?? "",
        dir2Name: parsed.dir2Name ?? "",
        dir2Din:  parsed.dir2Din  ?? "",
        place:    localStorage.getItem(PLACE_KEY(engagementId)) ?? "Ahmedabad",
        date:     localStorage.getItem(DATE_KEY(engagementId))  ?? new Date().toISOString().slice(0, 10),
      };
    } catch {
      return { dir1Name: "", dir1Din: "", dir2Name: "", dir2Din: "", place: "Ahmedabad", date: new Date().toISOString().slice(0, 10) };
    }
  });

  // Pull audit-firm details (firm name + FRN + partner + membership no.) from the
  // engagement's audit firm record, falling back gracefully to "—" placeholders.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: eng } = await (supabase as any)
          .from("audit_engagements")
          .select("audit_firm_id, signing_partner_name, signing_partner_membership_no")
          .eq("id", engagementId)
          .single();
        const firmId = eng?.audit_firm_id;
        let firmName = "", firmRegNo = "";
        if (firmId) {
          const { data: af } = await (supabase as any)
            .from("audit_firms")
            .select("firm_name, firm_registration_no")
            .eq("id", firmId)
            .single();
          firmName  = af?.firm_name ?? "";
          firmRegNo = af?.firm_registration_no ?? "";
        }
        if (!cancelled) {
          setFirm({
            firmName,
            firmRegNo,
            partnerName:  eng?.signing_partner_name ?? "",
            partnerMemNo: eng?.signing_partner_membership_no ?? "",
          });
        }
      } catch { /* keep blanks */ }
    })();
    return () => { cancelled = true; };
  }, [engagementId]);

  // Persist edits per engagement so all pages stay in sync.
  const updateDir = (patch: Partial<DirectorContext>) => {
    setDir(prev => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(DIR_KEY(engagementId), JSON.stringify({
          dir1Name: next.dir1Name, dir1Din: next.dir1Din,
          dir2Name: next.dir2Name, dir2Din: next.dir2Din,
        }));
        localStorage.setItem(PLACE_KEY(engagementId), next.place);
        localStorage.setItem(DATE_KEY(engagementId),  next.date);
      } catch { /* ignore quota */ }
      return next;
    });
  };

  const RW = (input: JSX.Element, text: string) => (readOnly ? <span>{text || "—"}</span> : input);

  return (
    <div className={cn("mt-4 rounded-lg border bg-card px-4 py-4 text-[11px] space-y-3", className)}>
      <div>{preface ?? "As per our Audit Report of even date"}</div>

      {/* Firm header / Board header */}
      <div className="grid grid-cols-2 gap-x-8">
        <div>
          <div className="font-bold">For {firm.firmName || "[Statutory Auditor Name]"}</div>
          <div>Chartered Accountants</div>
          <div>Firm's Registration No.: {firm.firmRegNo || "[FRN]"}</div>
        </div>
        <div>
          <div>For and on behalf of the Board of Directors of</div>
          <div className="font-bold">{companyName || "[Name of the Company]"}</div>
        </div>
      </div>

      {/* Three signature columns */}
      <div className="grid grid-cols-3 gap-x-6 pt-6">
        {/* Partner */}
        <div className="space-y-0.5">
          <div className="font-bold">{firm.partnerName || "[Signing Partner / Proprietor]"}</div>
          <div>Partner</div>
          <div>Membership No.: {firm.partnerMemNo || "—"}</div>
        </div>
        {/* Director 1 */}
        <div className="space-y-1">
          {RW(
            <input type="text" placeholder="[Director Name]" value={dir.dir1Name}
              onChange={(e) => updateDir({ dir1Name: e.target.value })}
              className={cn(editableCls, "w-full font-bold")} />,
            dir.dir1Name)}
          <div>Director</div>
          <div className="flex items-center gap-1">
            <span className="shrink-0">DIN:</span>
            {RW(
              <input type="text" placeholder="—" value={dir.dir1Din}
                onChange={(e) => updateDir({ dir1Din: e.target.value })}
                className={cn(editableCls, "flex-1")} />,
              dir.dir1Din)}
          </div>
        </div>
        {/* Director 2 */}
        <div className="space-y-1">
          {RW(
            <input type="text" placeholder="[Director Name]" value={dir.dir2Name}
              onChange={(e) => updateDir({ dir2Name: e.target.value })}
              className={cn(editableCls, "w-full font-bold")} />,
            dir.dir2Name)}
          <div>Director</div>
          <div className="flex items-center gap-1">
            <span className="shrink-0">DIN:</span>
            {RW(
              <input type="text" placeholder="—" value={dir.dir2Din}
                onChange={(e) => updateDir({ dir2Din: e.target.value })}
                className={cn(editableCls, "flex-1")} />,
              dir.dir2Din)}
          </div>
        </div>
      </div>

      {/* Place + Date row — repeated under each of the three columns */}
      <div className="grid grid-cols-3 gap-x-6 pt-2">
        {[0, 1, 2].map(i => (
          <div key={i} className="space-y-0.5">
            <div className="flex items-center gap-1">
              <span className="shrink-0">Place:</span>
              {RW(
                <input type="text" value={dir.place}
                  onChange={(e) => updateDir({ place: e.target.value })}
                  className={cn(editableCls, "flex-1")} placeholder="Ahmedabad" />,
                dir.place)}
            </div>
            <div className="flex items-center gap-1">
              <span className="shrink-0">Date:</span>
              {RW(
                <input type="date" value={dir.date}
                  onChange={(e) => updateDir({ date: e.target.value })}
                  className={cn(editableCls, "flex-1")} />,
                dir.date)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
