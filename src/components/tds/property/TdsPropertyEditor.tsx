/**
 * Form 141 Schedule B — transaction editor.
 *
 * A single scrolling form beside a live computation panel, deliberately NOT a
 * multi-step wizard. A CA entering a property deal wants to see the tax move
 * as they type and to correct the stamp duty value without walking back
 * through three screens; a wizard hides exactly the cross-field relationships
 * this form exists to expose.
 *
 * Every keystroke re-runs the whole engine — computation and validation both.
 * That is affordable because both are pure functions over a small object (see
 * src/lib/tds/form141ScheduleB.ts), and it means the blocking findings are
 * never stale: the Save button reflects the state of the data as it stands,
 * not as it stood when some step was last completed.
 *
 * The findings panel is ONE gate for both entry paths. A figure read out of an
 * uploaded agreement lands in the same fields a typed one does, and the
 * extractor's own unresolved questions and unconfirmed readings become
 * findings of the same shape as the arithmetic checks. Nothing here is
 * manual-entry-specific — which is what makes the extraction safe to trust
 * exactly as far as the gate allows.
 */
import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, AlertTriangle, AlertCircle, CheckCircle2, Info, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

import { validateForm141 } from "@/lib/tds/form141Validate";
import {
  PROPERTY_TYPES_CANDIDATE,
  FORM_141_DISCLAIMER,
  SCHEDULE_B,
  resolveForm141Period,
} from "@/lib/tds/form141";
import {
  toForm141Deal,
  formatInr,
  num,
  type PropertyDealBundle,
  type PropertyPartyRow,
  type PropertyInstalmentRow,
} from "./propertyDeal";
import { TdsPropertyUpload, type StoredDocument } from "./TdsPropertyUpload";
import {
  blockingQueries,
  FIELD_LABEL,
  type AppliedExtraction,
  type ResolvedQuery,
  type FieldProvenance,
} from "./agreementExtraction";

interface Props {
  bundle: PropertyDealBundle;
  onChange: (next: PropertyDealBundle) => void;
  onSave: () => void;
  onCancel: () => void;
  saving?: boolean;
  /** PAN of the client whose file this is, cross-checked against the buyers. */
  selectedClientPan?: string | null;
  /** Tax Year the user has selected in the module header, for period
   *  reconciliation — the document decides the period, this only reports a
   *  disagreement. */
  selectedTaxYear?: string | null;

  // ── Agreement extraction ────────────────────────────────────────────────
  // Held by the module rather than here so it survives a save and can be
  // persisted onto tds_property_documents alongside the file itself.
  provenance: Record<string, FieldProvenance>;
  queries: ResolvedQuery[];
  onExtracted: (applied: AppliedExtraction, doc: StoredDocument | null) => void;
  onProvenanceChange: (next: Record<string, FieldProvenance>) => void;
  onQueriesChange: (next: ResolvedQuery[]) => void;
}

const blankParty = (
  role: "buyer" | "seller",
  seq: number,
  firmId: string,
  txnId: string,
): PropertyPartyRow => ({
  id: `new-${role}-${seq}-${Math.random().toString(36).slice(2, 8)}`,
  firm_id: firmId,
  transaction_id: txnId,
  party_role: role,
  seq,
  pan: null,
  name: "",
  contact: null,
  email: null,
  share_pct: 0,
  residential_status: "resident",
  section_395_certificate_no: null,
  section_395_rate: null,
});

const blankInstalment = (seq: number, firmId: string, txnId: string): PropertyInstalmentRow => {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: `new-inst-${seq}-${Math.random().toString(36).slice(2, 8)}`,
    firm_id: firmId,
    transaction_id: txnId,
    seq,
    amount_paid_by_buyer: 0,
    date_paid_or_credited: today,
    // Deducting on the day of payment is both the norm and the only way to
    // avoid interest, so it is the default rather than left blank.
    date_of_deduction: today,
    date_of_deposit: null,
    date_of_filing: null,
  };
};

export function TdsPropertyEditor({
  bundle, onChange, onSave, onCancel, saving, selectedClientPan, selectedTaxYear,
  provenance, queries, onExtracted, onProvenanceChange, onQueriesChange,
}: Props) {
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const t = bundle.transaction;

  const buyers = bundle.parties.filter((p) => p.party_role === "buyer").sort((a, b) => a.seq - b.seq);
  const sellers = bundle.parties.filter((p) => p.party_role === "seller").sort((a, b) => a.seq - b.seq);

  const patchTxn = (patch: Partial<PropertyDealBundle["transaction"]>) =>
    onChange({ ...bundle, transaction: { ...t, ...patch } });

  const patchParty = (id: string, patch: Partial<PropertyPartyRow>) =>
    onChange({ ...bundle, parties: bundle.parties.map((p) => (p.id === id ? { ...p, ...patch } : p)) });

  const addParty = (role: "buyer" | "seller") => {
    const existing = bundle.parties.filter((p) => p.party_role === role);
    const seq = Math.max(0, ...existing.map((p) => p.seq)) + 1;
    onChange({ ...bundle, parties: [...bundle.parties, blankParty(role, seq, t.firm_id, t.id)] });
  };

  const removeParty = (id: string) =>
    onChange({ ...bundle, parties: bundle.parties.filter((p) => p.id !== id) });

  const patchInstalment = (id: string, patch: Partial<PropertyInstalmentRow>) =>
    onChange({ ...bundle, instalments: bundle.instalments.map((i) => (i.id === id ? { ...i, ...patch } : i)) });

  const addInstalment = () => {
    const seq = Math.max(0, ...bundle.instalments.map((i) => i.seq)) + 1;
    onChange({ ...bundle, instalments: [...bundle.instalments, blankInstalment(seq, t.firm_id, t.id)] });
  };

  const removeInstalment = (id: string) =>
    onChange({ ...bundle, instalments: bundle.instalments.filter((i) => i.id !== id) });

  // ── The engine, live ─────────────────────────────────────────────────────
  const deal = useMemo(() => toForm141Deal(bundle), [bundle]);
  const filingPan = t.filing_buyer_pan || buyers[0]?.pan || "";
  const result = useMemo(
    () => validateForm141(deal, filingPan, { selectedClientPan }),
    [deal, filingPan, selectedClientPan],
  );

  // Period reconciliation against whatever Tax Year the module header shows.
  // The FIRST instalment settles the transaction's home year; later ones can
  // legitimately fall elsewhere and are reported per statement below.
  const period = useMemo(() => {
    const first = deal.instalments[0];
    if (!first) return null;
    return resolveForm141Period(first.datePaidOrCredited, first.dateOfDeduction, selectedTaxYear || null);
  }, [deal.instalments, selectedTaxYear]);

  /**
   * ONE gate, not two.
   *
   * An unresolved blocking question from the extractor, and a
   * medium-confidence reading nobody has confirmed, are turned into findings
   * of exactly the same shape the engine produces. They sort and render
   * beside the arithmetic checks, and they block filing on the same terms —
   * which is the whole reason extraction was built on top of a working manual
   * path rather than beside it.
   */
  const extractionFindings = useMemo(() => {
    const out: { code: string; severity: "blocking" | "warning"; field: string; message: string; ref?: string }[] = [];

    for (const q of blockingQueries(queries)) {
      out.push({
        code: "extraction_query_unresolved",
        severity: "blocking",
        field: q.field,
        ref: FIELD_LABEL[q.field] || q.field,
        message: `Unanswered question about ${FIELD_LABEL[q.field] || q.field}: ${q.question}`,
      });
    }

    for (const [key, p] of Object.entries(provenance)) {
      if (!p.needsConfirmation) continue;
      out.push({
        code: "extraction_unconfirmed",
        severity: "warning",
        field: key,
        ref: FIELD_LABEL[key] || key,
        message: `${FIELD_LABEL[key] || key} was read from the document at ${p.confidence} confidence and has not been confirmed${p.page !== null ? ` (page ${p.page})` : ""}. Check it against the source before filing.`,
      });
    }

    return out;
  }, [queries, provenance]);

  const allFindings = useMemo(
    () => [
      ...result.blocking,
      ...extractionFindings.filter((f) => f.severity === "blocking"),
      ...result.warnings,
      ...extractionFindings.filter((f) => f.severity === "warning"),
    ],
    [result.blocking, result.warnings, extractionFindings],
  );
  const blockingCount = result.blocking.length + extractionFindings.filter((f) => f.severity === "blocking").length;
  const warningCount = result.warnings.length + extractionFindings.filter((f) => f.severity === "warning").length;

  const canSave = Boolean(t.property_address.trim()) && !saving;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] items-start">
      {/* ── Form ─────────────────────────────────────────────────────────── */}
      <div className="space-y-5 min-w-0">
        <TdsPropertyUpload
          bundle={bundle}
          provenance={provenance}
          queries={queries}
          onExtracted={onExtracted}
          onProvenanceChange={onProvenanceChange}
          onQueriesChange={onQueriesChange}
        />

        {/* Property */}
        <Card>
          <CardContent className="pt-5 space-y-4">
            <h3 className="text-sm font-semibold">Property</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Type of immovable property</Label>
                <Select value={t.property_type} onValueChange={(v) => patchTxn({ property_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROPERTY_TYPES_CANDIDATE.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Date of agreement</Label>
                <Input
                  type="date"
                  value={t.date_of_agreement}
                  onChange={(e) => patchTxn({ date_of_agreement: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Address of property transferred / to be transferred</Label>
              <Textarea
                rows={2}
                value={t.property_address}
                placeholder="Survey / khata / block number, village, taluka, district, state"
                onChange={(e) => patchTxn({ property_address: e.target.value })}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Total sale consideration</Label>
                <Input
                  type="number" inputMode="numeric" value={num(t.total_sale_consideration) || ""}
                  onChange={(e) => patchTxn({ total_sale_consideration: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Total stamp duty value</Label>
                <Input
                  type="number" inputMode="numeric"
                  value={t.total_stamp_duty_value === null ? "" : num(t.total_stamp_duty_value) || ""}
                  placeholder="Usually on Index-II"
                  onChange={(e) => patchTxn({ total_stamp_duty_value: e.target.value === "" ? null : Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Payment</Label>
                <Select
                  value={t.payment_mode}
                  onValueChange={(v: "lumpsum" | "instalments") => patchTxn({ payment_mode: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lumpsum">Lumpsum</SelectItem>
                    <SelectItem value="instalments">Instalments</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Buyers */}
        <Card>
          <CardContent className="pt-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Buyers</h3>
                <p className="text-xs text-muted-foreground">
                  Every buyer on the agreement, even those who are not your client — the shares must total 100%.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => addParty("buyer")}>
                <Plus size={14} className="mr-1" /> Add buyer
              </Button>
            </div>
            {buyers.map((b) => (
              <div key={b.id} className="grid gap-3 sm:grid-cols-[1fr_150px_110px_auto] items-end border-t pt-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Name</Label>
                  <Input value={b.name} onChange={(e) => patchParty(b.id, { name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">PAN</Label>
                  <Input
                    value={b.pan || ""} maxLength={10} className="uppercase font-mono"
                    onChange={(e) => patchParty(b.id, { pan: e.target.value.toUpperCase() || null })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Share %</Label>
                  <Input
                    type="number" value={num(b.share_pct) || ""}
                    onChange={(e) => patchParty(b.id, { share_pct: Number(e.target.value) })}
                  />
                </div>
                <Button size="icon" variant="ghost" onClick={() => removeParty(b.id)} aria-label={`Remove buyer ${b.name || b.seq}`}>
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
            {buyers.length > 1 && (
              <div className="space-y-1.5 border-t pt-3">
                <Label className="text-xs">Filing under</Label>
                <Select value={filingPan} onValueChange={(v) => patchTxn({ filing_buyer_pan: v })}>
                  <SelectTrigger><SelectValue placeholder="Which buyer is filing this statement?" /></SelectTrigger>
                  <SelectContent>
                    {buyers.filter((b) => b.pan).map((b) => (
                      <SelectItem key={b.id} value={b.pan!}>{b.name || b.pan} — {b.pan}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Each buyer files their own statement under their own PAN. This one covers only their share.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Sellers */}
        <Card>
          <CardContent className="pt-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Sellers (deductees)</h3>
                <p className="text-xs text-muted-foreground">
                  One deductee row per seller on the statement. Shares must total 100%.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => addParty("seller")}>
                <Plus size={14} className="mr-1" /> Add seller
              </Button>
            </div>
            {sellers.map((s) => (
              <div key={s.id} className="space-y-3 border-t pt-3">
                <div className="grid gap-3 sm:grid-cols-[1fr_150px_110px_auto] items-end">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Name</Label>
                    <Input value={s.name} onChange={(e) => patchParty(s.id, { name: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">PAN</Label>
                    <Input
                      value={s.pan || ""} maxLength={10} className="uppercase font-mono"
                      placeholder="Blank → 20%"
                      onChange={(e) => patchParty(s.id, { pan: e.target.value.toUpperCase() || null })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Share %</Label>
                    <Input
                      type="number" value={num(s.share_pct) || ""}
                      onChange={(e) => patchParty(s.id, { share_pct: Number(e.target.value) })}
                    />
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => removeParty(s.id)} aria-label={`Remove seller ${s.name || s.seq}`}>
                    <Trash2 size={14} />
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Residential status</Label>
                    <Select
                      value={s.residential_status}
                      onValueChange={(v: "resident" | "non_resident") => patchParty(s.id, { residential_status: v })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="resident">Resident</SelectItem>
                        <SelectItem value="non_resident">Non-resident</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Contact</Label>
                    <Input value={s.contact || ""} onChange={(e) => patchParty(s.id, { contact: e.target.value || null })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Email</Label>
                    <Input value={s.email || ""} onChange={(e) => patchParty(s.id, { email: e.target.value || null })} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">s.395(1) cert.</Label>
                      <Input
                        value={s.section_395_certificate_no || ""}
                        onChange={(e) => patchParty(s.id, { section_395_certificate_no: e.target.value || null })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Cert. rate %</Label>
                      <Input
                        type="number" step="0.01"
                        value={s.section_395_rate === null ? "" : String(s.section_395_rate)}
                        onChange={(e) => patchParty(s.id, { section_395_rate: e.target.value === "" ? null : Number(e.target.value) })}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Payments */}
        <Card>
          <CardContent className="pt-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Payments</h3>
                <p className="text-xs text-muted-foreground">
                  What this buyer paid, across all sellers. Each payment becomes its own statement.
                </p>
              </div>
              <Button
                size="sm" variant="outline" onClick={addInstalment}
                disabled={t.payment_mode === "lumpsum" && bundle.instalments.length >= 1}
              >
                <Plus size={14} className="mr-1" /> Add payment
              </Button>
            </div>
            {bundle.instalments.sort((a, b) => a.seq - b.seq).map((i) => (
              <div key={i.id} className="grid gap-3 sm:grid-cols-[140px_1fr_1fr_1fr_auto] items-end border-t pt-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Amount</Label>
                  <Input
                    type="number" inputMode="numeric" value={num(i.amount_paid_by_buyer) || ""}
                    onChange={(e) => patchInstalment(i.id, { amount_paid_by_buyer: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Paid / credited</Label>
                  <Input
                    type="date" value={i.date_paid_or_credited}
                    onChange={(e) => patchInstalment(i.id, { date_paid_or_credited: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Tax deducted</Label>
                  <Input
                    type="date" value={i.date_of_deduction}
                    onChange={(e) => patchInstalment(i.id, { date_of_deduction: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Challan deposited</Label>
                  <Input
                    type="date" value={i.date_of_deposit || ""}
                    onChange={(e) => patchInstalment(i.id, { date_of_deposit: e.target.value || null, date_of_filing: e.target.value || null })}
                  />
                </div>
                <Button size="icon" variant="ghost" onClick={() => removeInstalment(i.id)} aria-label={`Remove payment ${i.seq}`}>
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
            {bundle.instalments.length === 0 && (
              <p className="text-sm text-muted-foreground border-t pt-3">
                No payment recorded yet. Add one to compute the deduction.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="flex items-center gap-2">
          <Button onClick={onSave} disabled={!canSave}>
            {saving && <Loader2 size={14} className="mr-1.5 animate-spin" />}
            Save transaction
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
          {blockingCount > 0 && (
            <span className="text-xs text-muted-foreground">
              Saving is allowed with findings open — filing is not.
            </span>
          )}
        </div>
      </div>

      {/* ── Live computation ─────────────────────────────────────────────── */}
      <div className="space-y-4 lg:sticky lg:top-4">
        <Card>
          <CardContent className="pt-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Computation</h3>
              <Badge variant="outline" className="text-[10px] font-mono">Form 141 · Sch. B</Badge>
            </div>

            <div className={cn(
              "rounded-md border p-3 text-xs",
              result.computation.threshold.liable
                ? "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40"
                : "border-muted bg-muted/40",
            )}>
              <p className="font-medium mb-1">
                {result.computation.threshold.liable ? "TDS applies" : "Below threshold"}
              </p>
              <p className="text-muted-foreground">{result.computation.threshold.explanation}</p>
            </div>

            {period && period.verdict !== "in_context" && (
              <div className={cn(
                "rounded-md border p-3 text-xs",
                period.verdict === "pre_regime"
                  ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
                  : "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40",
              )}>
                <p className="font-medium mb-1">
                  {period.verdict === "pre_regime" ? "Outside this module" : "Different Tax Year"}
                </p>
                <p className="text-muted-foreground">{period.message}</p>
              </div>
            )}

            {result.computation.statements.map((s) => (
              <div key={s.instalmentSeq} className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">
                    {result.computation.statements.length > 1 ? `Payment ${s.instalmentSeq} · ` : ""}{s.month}
                  </span>
                  <span className="text-muted-foreground font-mono">{s.taxYear}</span>
                </div>
                <table className="w-full text-xs tabular-nums">
                  <tbody>
                    {s.rows.map((r) => (
                      <tr key={r.sellerPan || r.sellerName} className="text-muted-foreground">
                        <td className="py-0.5 truncate max-w-[150px]">{r.sellerName || r.sellerPan}</td>
                        <td className="py-0.5 text-right">{r.ratePct}%</td>
                        <td className="py-0.5 text-right font-medium text-foreground">{formatInr(r.tdsAmount)}</td>
                      </tr>
                    ))}
                    <tr className="border-t">
                      <td className="pt-1.5">Tax deducted</td>
                      <td />
                      <td className="pt-1.5 text-right font-semibold">{formatInr(s.totalTds)}</td>
                    </tr>
                    {s.interest > 0 && (
                      <tr className="text-amber-700 dark:text-amber-400">
                        <td className="py-0.5">
                          Interest
                          <span className="text-[10px] ml-1 opacity-70">
                            {s.interestBreakdown.lateDeductionMonths > 0 && `${s.interestBreakdown.lateDeductionMonths}m late deduction`}
                            {s.interestBreakdown.lateDeductionMonths > 0 && s.interestBreakdown.lateDepositMonths > 0 && " + "}
                            {s.interestBreakdown.lateDepositMonths > 0 && `${s.interestBreakdown.lateDepositMonths}m late deposit`}
                          </span>
                        </td>
                        <td />
                        <td className="py-0.5 text-right">{formatInr(s.interest)}</td>
                      </tr>
                    )}
                    {s.fee > 0 && (
                      <tr className="text-amber-700 dark:text-amber-400">
                        <td className="py-0.5">Fee <span className="text-[10px] opacity-70">{s.feeDays} days</span></td>
                        <td />
                        <td className="py-0.5 text-right">{formatInr(s.fee)}</td>
                      </tr>
                    )}
                    <tr className="border-t">
                      <td className="pt-1.5 font-medium">Total payable</td>
                      <td />
                      <td className="pt-1.5 text-right font-semibold">{formatInr(s.totalPayable)}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="text-[11px] text-muted-foreground">Due {s.dueDate}</p>
              </div>
            ))}

            {result.computation.statements.length === 0 && result.computation.threshold.liable && (
              <p className="text-xs text-muted-foreground">
                No statement can be produced yet — resolve the findings below.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Findings */}
        <Card>
          <CardContent className="pt-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Checks</h3>
              {allFindings.length === 0 ? (
                <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 text-[10px]">
                  All clear
                </Badge>
              ) : (
                <div className="flex gap-1.5">
                  {blockingCount > 0 && (
                    <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 text-[10px]">
                      {blockingCount} blocking
                    </Badge>
                  )}
                  {warningCount > 0 && (
                    <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 text-[10px]">
                      {warningCount} to review
                    </Badge>
                  )}
                </div>
              )}
            </div>

            {allFindings.length === 0 && (
              <p className="text-xs text-muted-foreground flex items-start gap-2">
                <CheckCircle2 size={14} className="text-emerald-600 shrink-0 mt-0.5" />
                Every cross-field check passes. This transaction is ready to file.
              </p>
            )}

            <ul className="space-y-2.5">
              {allFindings.map((f, idx) => (
                <li key={`${f.code}-${f.ref ?? ""}-${idx}`} className="flex items-start gap-2 text-xs">
                  {f.severity === "blocking"
                    ? <AlertCircle size={14} className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                    : <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />}
                  <div className="min-w-0">
                    <p className="text-foreground">{f.message}</p>
                    {f.ref && <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{f.ref}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <button
          type="button"
          onClick={() => setShowDisclaimer((v) => !v)}
          className="flex items-start gap-2 text-left text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full"
        >
          <Info size={12} className="shrink-0 mt-0.5" />
          <span>
            {showDisclaimer ? FORM_141_DISCLAIMER : `${SCHEDULE_B.title.split(" under ")[0]} — about this form and its citations`}
          </span>
        </button>
        <Separator />
      </div>
    </div>
  );
}
