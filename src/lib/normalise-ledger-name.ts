export function normaliseLedgerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/@\s*\d+(\.\d+)?%?/g, "")
    .replace(/(a\/c|ac|account|accounts)/gi, "")
    .replace(/(exp|expence|expences|expense|expenses)/gi, "")
    .replace(/(pvt|ltd|llp|co|private|limited|and|&)/gi, "")
    .replace(/(cgst|sgst|igst|gst|tds|tcs)/gi, "")
    .replace(/\d{4,}/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
