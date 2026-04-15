import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { toast } from "sonner";
import { Save, Loader2, ClipboardList, CheckSquare } from "lucide-react";

// ─── 25 standard SA 580 MRL clauses ───────────────────────────────────────────
const MRL_CLAUSES: { number: number; title: string; text: string }[] = [
  {
    number: 1,
    title: "Fair Presentation of Financial Statements",
    text: "We confirm that the financial statements give a true and fair view of the financial position of the Company as at the balance sheet date and of its profit/loss for the year then ended in conformity with generally accepted accounting principles in India.",
  },
  {
    number: 2,
    title: "Significant Accounting Policies",
    text: "All significant accounting policies adopted in the preparation of the financial statements have been properly applied and disclosed. There have been no changes in accounting policies during the year except as disclosed in the financial statements.",
  },
  {
    number: 3,
    title: "Completeness and Accuracy of Information",
    text: "We have provided you with access to all information of which we are aware that is relevant to the preparation of the financial statements, such as records, documentation, and other matters. We have provided you with additional information that you have requested from us for the purpose of the audit. We have provided you with unrestricted access to persons within the entity from whom you determined it necessary to obtain audit evidence.",
  },
  {
    number: 4,
    title: "Related Party Relationships and Transactions",
    text: "We have disclosed to you the identity of all related parties and all the related party relationships and transactions of which we are aware. All related party transactions have been properly accounted for and disclosed in the financial statements in accordance with the requirements of the applicable financial reporting framework.",
  },
  {
    number: 5,
    title: "Litigation and Claims",
    text: "We have disclosed to you all known actual or possible litigation and claims, both settled and pending, whose effects should be considered when preparing the financial statements. Adequate provision has been made in the financial statements for all pending legal proceedings and claims.",
  },
  {
    number: 6,
    title: "Uncorrected Misstatements",
    text: "We believe that the effects of uncorrected misstatements (if any) are immaterial, both individually and in aggregate, to the financial statements as a whole.",
  },
  {
    number: 7,
    title: "Compliance with Contractual Obligations",
    text: "The Company has complied with all aspects of contractual agreements that could have a material effect on the financial statements in the event of non-compliance. There has been no non-compliance with requirements of regulatory authorities that could have a material effect on the financial statements.",
  },
  {
    number: 8,
    title: "Subsequent Events — Adjusting",
    text: "All events occurring subsequent to the date of the financial statements that require adjustment to the financial statements have been adjusted. We are not aware of any material subsequent events that would require adjustment to the financial statements other than those already disclosed.",
  },
  {
    number: 9,
    title: "Subsequent Events — Disclosure",
    text: "All events occurring subsequent to the date of the financial statements that require disclosure in the financial statements have been properly disclosed. No material developments have occurred after the balance sheet date that require disclosure but have not been disclosed.",
  },
  {
    number: 10,
    title: "Fraud — Management's Responsibility",
    text: "We acknowledge our responsibility for the design, implementation, and maintenance of internal controls to prevent and detect fraud and error. We have disclosed to you the results of our assessment of the risk that the financial statements may be materially misstated as a result of fraud.",
  },
  {
    number: 11,
    title: "Fraud — Knowledge of Instances",
    text: "We have disclosed to you all information in relation to fraud or suspected fraud that we are aware of and that affects the entity and involves management, employees who have significant roles in internal controls, or others where the fraud could have a material effect on the financial statements.",
  },
  {
    number: 12,
    title: "Allegations of Fraud",
    text: "We have disclosed to you all information in relation to any allegations of fraud, or suspected fraud, affecting the entity's financial statements communicated by employees, former employees, analysts, regulators, or others.",
  },
  {
    number: 13,
    title: "Non-Compliance with Laws and Regulations",
    text: "We have disclosed to you all known instances of non-compliance or suspected non-compliance with laws and regulations whose effects should be considered when preparing the financial statements. The Company is in compliance with all applicable laws and regulations, except as disclosed in the financial statements.",
  },
  {
    number: 14,
    title: "Going Concern",
    text: "We confirm that the Company has no plans or intentions that may materially alter the carrying value or classification of assets and liabilities reflected in the financial statements and that it is appropriate to prepare the financial statements on a going concern basis.",
  },
  {
    number: 15,
    title: "Title to Assets",
    text: "The Company has satisfactory title to all assets and there are no liens or encumbrances on the Company's assets, other than those disclosed in the financial statements. There are no assets that have been pledged as security other than those disclosed.",
  },
  {
    number: 16,
    title: "Completeness of Liabilities",
    text: "All liabilities, both actual and contingent, have been recorded or disclosed in the financial statements. There are no unrecorded liabilities or commitments as at the balance sheet date, other than those disclosed.",
  },
  {
    number: 17,
    title: "Provisions and Contingencies",
    text: "Adequate provision has been made for all known losses and liabilities, including all contingent liabilities. We have disclosed all information regarding contingent liabilities and commitments, including off-balance-sheet arrangements, that is required to be disclosed.",
  },
  {
    number: 18,
    title: "Revenue Recognition",
    text: "Revenue has been recognised in accordance with the applicable accounting standards. We confirm that all revenue transactions have been properly recorded and that there are no side agreements, undisclosed terms, or conditions that would alter the terms of the recorded transactions.",
  },
  {
    number: 19,
    title: "Long-term Contracts",
    text: "All long-term contracts, commitments, and purchase obligations have been disclosed in the financial statements. We have identified all contracts that involve possible losses and adequate provision has been made therefor in the financial statements.",
  },
  {
    number: 20,
    title: "Impairment of Assets",
    text: "We have assessed whether any assets (other than inventories) are impaired. The impairment assessment and resulting impairment losses (if any) are in accordance with the applicable financial reporting framework and have been properly reflected in the financial statements.",
  },
  {
    number: 21,
    title: "Accounting Estimates",
    text: "The significant assumptions used in making accounting estimates are reasonable and appropriate. All estimates of the effects of uncertainties affecting the entity's ability to continue as a going concern are disclosed in the financial statements.",
  },
  {
    number: 22,
    title: "Capital Commitments",
    text: "All capital commitments and material financial commitments, as at the balance sheet date, have been properly disclosed in the financial statements. There are no other material commitments or contingent liabilities that have not been disclosed.",
  },
  {
    number: 23,
    title: "Statutory Dues",
    text: "All statutory dues payable as at the balance sheet date have been duly deposited with the appropriate authorities or adequately provided for. There are no arrears of outstanding dues on account of income tax, sales tax, service tax, goods and services tax, customs duty, excise duty, value added tax, or cess.",
  },
  {
    number: 24,
    title: "Cash and Bank Balances",
    text: "The cash and bank balances shown in the balance sheet represent actual cash on hand and amounts held by the Company's bankers. The balances are available for use in day-to-day operations and are free from any encumbrances, except as disclosed.",
  },
  {
    number: 25,
    title: "Adequacy of Disclosures in Financial Statements",
    text: "The disclosures in the notes to financial statements are complete, accurate, and sufficient for a proper understanding of the financial statements. All material information required to be disclosed under the applicable financial reporting framework and the Companies Act, 2013 has been properly disclosed.",
  },
];

interface MrlRow {
  id?: string;
  clause_number: number;
  clause_title: string;
  clause_text: string;
  is_selected: boolean;
  custom_remarks: string;
}

interface Props {
  engagementId: string;
  engagement: any;
}

export function EngagementMRL({ engagementId, engagement }: Props) {
  const { user } = useAuth();
  const [rows, setRows] = useState<MrlRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // ─── Load saved rows from DB, falling back to defaults ────────────────────
  const loadRows = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("audit_mrl")
      .select("*")
      .eq("engagement_id", engagementId)
      .order("clause_number");

    if (error && error.code !== "PGRST116") {
      toast.error("Failed to load MRL: " + error.message);
    }

    if (data && data.length > 0) {
      // Merge DB rows with master clause text (in case master text was updated)
      const dbMap = new Map<number, any>(data.map((r: any) => [r.clause_number, r]));
      setRows(
        MRL_CLAUSES.map((c) => {
          const saved = dbMap.get(c.number);
          return {
            id: saved?.id,
            clause_number: c.number,
            clause_title: c.title,
            clause_text: saved?.clause_text ?? c.text,
            is_selected: saved?.is_selected ?? true,
            custom_remarks: saved?.custom_remarks ?? "",
          };
        })
      );
    } else {
      // First load — use defaults (all selected)
      setRows(
        MRL_CLAUSES.map((c) => ({
          clause_number: c.number,
          clause_title: c.title,
          clause_text: c.text,
          is_selected: true,
          custom_remarks: "",
        }))
      );
    }
    setLoading(false);
  }, [engagementId]);

  useEffect(() => { loadRows(); }, [loadRows]);

  // ─── Field updaters ────────────────────────────────────────────────────────
  const toggleSelected = (clauseNumber: number) => {
    setRows((prev) =>
      prev.map((r) =>
        r.clause_number === clauseNumber ? { ...r, is_selected: !r.is_selected } : r
      )
    );
  };

  const updateText = (clauseNumber: number, value: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.clause_number === clauseNumber ? { ...r, clause_text: value } : r
      )
    );
  };

  const updateRemarks = (clauseNumber: number, value: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.clause_number === clauseNumber ? { ...r, custom_remarks: value } : r
      )
    );
  };

  // ─── Save all rows to DB ───────────────────────────────────────────────────
  const saveAll = async () => {
    setSaving(true);
    const upsertPayload = rows.map((r) => ({
      ...(r.id ? { id: r.id } : {}),
      engagement_id: engagementId,
      clause_number: r.clause_number,
      clause_title: r.clause_title,
      clause_text: r.clause_text,
      is_selected: r.is_selected,
      custom_remarks: r.custom_remarks || null,
      last_updated_at: new Date().toISOString(),
      last_updated_by: user?.id ?? null,
    }));

    const { error } = await (supabase as any)
      .from("audit_mrl")
      .upsert(upsertPayload, { onConflict: "engagement_id,clause_number" });

    setSaving(false);
    if (error) {
      toast.error("Failed to save MRL: " + error.message);
    } else {
      toast.success("Management Representation Letter saved");
      loadRows(); // refresh to get ids for newly inserted rows
    }
  };

  const selectedCount = rows.filter((r) => r.is_selected).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-primary" />
          <span className="font-semibold text-base">Management Representation Letter</span>
          <Badge variant="secondary" className="gap-1">
            <CheckSquare className="w-3 h-3" />
            {selectedCount} / {rows.length} clauses included
          </Badge>
        </div>
        <Button onClick={saveAll} disabled={saving} size="sm" className="gap-1">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save MRL
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Select the clauses to include in the letter. You can edit clause text and add remarks as needed. Deselected clauses will be excluded from the final letter.
      </p>

      {/* Clause list */}
      <Accordion type="multiple" className="space-y-2">
        {rows.map((row) => (
          <AccordionItem
            key={row.clause_number}
            value={String(row.clause_number)}
            className={`border rounded-lg px-0 ${!row.is_selected ? "opacity-50" : ""}`}
          >
            <AccordionTrigger className="px-4 py-3 hover:no-underline">
              <div className="flex items-center gap-3 w-full text-left">
                {/* Checkbox — stop propagation so clicking it doesn't toggle accordion */}
                <span
                  onClick={(e) => { e.stopPropagation(); toggleSelected(row.clause_number); }}
                  className="flex-shrink-0"
                >
                  <Checkbox
                    checked={row.is_selected}
                    onCheckedChange={() => toggleSelected(row.clause_number)}
                    id={`mrl-${row.clause_number}`}
                  />
                </span>
                <Label
                  htmlFor={`mrl-${row.clause_number}`}
                  className="cursor-pointer flex-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="text-muted-foreground text-xs mr-2">
                    {String(row.clause_number).padStart(2, "0")}.
                  </span>
                  <span className="font-medium text-sm">{row.clause_title}</span>
                </Label>
                {!row.is_selected && (
                  <Badge variant="outline" className="text-xs">Excluded</Badge>
                )}
              </div>
            </AccordionTrigger>

            <AccordionContent className="px-4 pb-4 pt-0 space-y-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Clause Text</Label>
                <Textarea
                  value={row.clause_text}
                  onChange={(e) => updateText(row.clause_number, e.target.value)}
                  rows={4}
                  className="text-sm resize-y"
                  disabled={!row.is_selected}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Auditor Remarks (optional)</Label>
                <Textarea
                  value={row.custom_remarks}
                  onChange={(e) => updateRemarks(row.clause_number, e.target.value)}
                  rows={2}
                  placeholder="Add any observations or notes for this clause..."
                  className="text-sm resize-y"
                  disabled={!row.is_selected}
                />
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      {/* Footer save */}
      <div className="flex justify-end pt-2">
        <Button onClick={saveAll} disabled={saving} className="gap-1">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Management Representation Letter
        </Button>
      </div>
    </div>
  );
}
