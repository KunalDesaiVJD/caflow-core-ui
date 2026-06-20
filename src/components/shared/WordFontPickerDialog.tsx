/**
 * WordFontPickerDialog
 * ─────────────────────────────────────────────────────────────────────────────
 * Reusable "Select font for the Word document" picker shown before a docx
 * export. Mirrors the FS export's font picker (PipelineFinancialStatements →
 * showNCEFontDialog / showCorpFontDialog) so the Stage 8 Client Certificate
 * and Management Letter share the same look-and-feel and font list.
 */

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type ExportFont =
  | "Arial"
  | "Calibri"
  | "Cambria"
  | "Times New Roman"
  | "Garamond"
  | "Georgia";

export const EXPORT_FONTS: readonly ExportFont[] = [
  "Arial",
  "Calibri",
  "Cambria",
  "Times New Roman",
  "Garamond",
  "Georgia",
];

interface Props {
  open:        boolean;
  onOpenChange: (open: boolean) => void;
  /** Dialog heading — e.g. "Export Client Certificate" / "Export Management Letter" */
  title:       string;
  selected:    ExportFont;
  onSelect:    (font: ExportFont) => void;
  /** Confirmed font choice; the parent should run its docx generator here. */
  onConfirm:   (font: ExportFont) => void;
  /** Radio-group `name` — must be unique on a page that hosts multiple dialogs. */
  radioName?:  string;
}

export function WordFontPickerDialog({
  open, onOpenChange, title, selected, onSelect, onConfirm, radioName = "wordExportFont",
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">Select font for the Word document:</p>
          <div className="grid grid-cols-1 gap-2">
            {EXPORT_FONTS.map(f => (
              <label
                key={f}
                className="flex items-center gap-2 cursor-pointer rounded border px-3 py-2 hover:bg-muted/50"
                style={{ fontFamily: f }}
              >
                <input
                  type="radio"
                  name={radioName}
                  value={f}
                  checked={selected === f}
                  onChange={() => onSelect(f)}
                  className="accent-primary"
                />
                <span className="text-sm font-medium">{f}</span>
                <span className="ml-auto text-xs text-muted-foreground" style={{ fontFamily: f }}>
                  Aa Bb 1 2 3
                </span>
              </label>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={() => { onOpenChange(false); onConfirm(selected); }}>
            Export Word
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
