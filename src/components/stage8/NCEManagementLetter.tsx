/**
 * NCEManagementLetter — Management Representation Letter for Non-Corporate Entities
 * Stage 8 | Tab 6 | NCE only
 *
 * Spec to be provided — component wired; content implementation pending.
 */

interface Props {
  engagementId: string;
}

export function NCEManagementLetter({ engagementId: _engagementId }: Props) {
  return (
    <div className="flex items-center justify-center h-48 rounded-lg border border-dashed border-muted-foreground/40 text-muted-foreground text-sm">
      Management Letter — implementation pending
    </div>
  );
}
