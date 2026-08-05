/**
 * Tds194QTurnoverGateModal  (Stage 6)
 *
 * Blocking yes/no question shown once before Run Reconciliation, only
 * when the engagement has confirmed/pending mappings under Section 194Q
 * AND no answer is stored yet. Section 194Q's applicability hinges on
 * the BUYER's turnover in the immediately preceding FY exceeding ₹10
 * crore — a fact the Trial Balance can't answer, so the auditor must.
 *
 * "No" still lets reconciliation proceed for every OTHER section; only
 * 194Q flag creation is skipped inside runReconEngine when the stored
 * answer is false.
 */
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface Props {
  open:          boolean;
  onOpenChange:  (open: boolean) => void;
  onAnswer:      (exceeds10Cr: boolean) => void;
  saving:        boolean;
}

export function Tds194QTurnoverGateModal({ open, onOpenChange, onAnswer, saving }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-600" />
            Section 194Q applicability
          </DialogTitle>
        </DialogHeader>
        <div className="text-sm space-y-2 py-2">
          <p>
            This engagement has one or more parties whose combined goods purchases
            exceed the <strong>₹50 lakh</strong> threshold for Section 194Q.
          </p>
          <p>
            194Q only applies when the <strong>buyer's turnover in the immediately
            preceding financial year exceeded ₹10 crore</strong>. This can't be
            determined from the Trial Balance alone.
          </p>
          <p className="font-medium">
            Did the client's turnover in the immediately preceding financial year
            exceed ₹10 crore?
          </p>
          <p className="text-xs text-muted-foreground">
            Answering "No" skips Section 194Q reconciliation entirely for this run —
            every other section (194C, 194J, etc.) is unaffected. You can change this
            answer later from the Reconciliation tab.
          </p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onAnswer(false)} disabled={saving}>
            No — skip 194Q
          </Button>
          <Button onClick={() => onAnswer(true)} disabled={saving}>
            Yes — turnover exceeded ₹10 Cr
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
