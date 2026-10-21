/**
 * Document number in a report or ledger. Invoices and credit notes link to the
 * document itself (opened in a new tab, so the report keeps its filters).
 */
export default function DocLink({
  docNo, documentId, entryType, className = "",
}: {
  docNo: string;
  documentId: string | null | undefined;
  entryType: string | null | undefined;
  className?: string;
}) {
  const linkable = !!documentId && (entryType === "invoice" || entryType === "credit_note");
  if (!linkable) return <span className={className}>{docNo}</span>;
  return (
    <a
      href={`/billing/edit/${documentId}`}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${entryType === "credit_note" ? "credit note" : "invoice"} ${docNo}`}
      className={`text-blue-700 hover:underline ${className}`}
      onClick={e => e.stopPropagation()}
    >
      {docNo}
    </a>
  );
}
