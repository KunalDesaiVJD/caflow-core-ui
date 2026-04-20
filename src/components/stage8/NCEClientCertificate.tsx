/**
 * NCEClientCertificate — Audit Certificate for Non-Corporate Entities
 * Stage 8 | Tab 5 | NCE only
 *
 * Spec to be provided — component wired; content implementation pending.
 */

interface Props {
  engagementId: string;
}

export function NCEClientCertificate({ engagementId: _engagementId }: Props) {
  return (
    <div className="flex items-center justify-center h-48 rounded-lg border border-dashed border-muted-foreground/40 text-muted-foreground text-sm">
      Client Certificate — implementation pending
    </div>
  );
}
