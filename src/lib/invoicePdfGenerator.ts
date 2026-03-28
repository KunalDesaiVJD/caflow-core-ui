/**
 * Standalone invoice PDF generator — generates PDF Blob from an invoice DB record.
 * Used by bulk ZIP download and month-wise download features.
 */
import { format } from "date-fns";

function numberToWords(num: number): string {
  if (num === 0) return "Zero Only";
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const scales = ["", "Thousand", "Lakh", "Crore"];

  function convertGroup(n: number): string {
    if (n === 0) return "";
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "");
    return ones[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " and " + convertGroup(n % 100) : "");
  }

  const groups: number[] = [];
  groups.push(num % 1000);
  num = Math.floor(num / 1000);
  while (num > 0) {
    groups.push(num % 100);
    num = Math.floor(num / 100);
  }

  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] > 0) {
      parts.push(convertGroup(groups[i]) + (scales[i] ? " " + scales[i] : ""));
    }
  }
  return (parts.join(" ") + " Only").replace(/\s+/g, " ").trim();
}

const fmtINR = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface InvoiceRecord {
  invoice_no?: string | null;
  invoice_date?: string | null;
  document_type?: string | null;
  from_firm_name?: string | null;
  from_gstin?: string | null;
  from_pan?: string | null;
  from_address?: string | null;
  from_email?: string | null;
  from_phone?: string | null;
  to_name?: string | null;
  to_gstin?: string | null;
  to_address?: string | null;
  place_of_supply?: string | null;
  is_intra_state?: boolean | null;
  line_items?: any[] | null;
  amount?: number | null;
  gst_amount?: number | null;
  total_amount?: number | null;
  subtotal?: number | null;
  total_cgst?: number | null;
  total_sgst?: number | null;
  total_igst?: number | null;
  reference_no?: string | null;
  remarks_conditions?: string | null;
  bank_details_snapshot?: any | null;
  signatory_name?: string | null;
  [key: string]: any;
}

const DOC_HEADINGS: Record<string, string> = {
  invoice: "TAX INVOICE",
  credit_note: "CREDIT NOTE",
  quotation: "QUOTATION",
  proforma: "PROFORMA INVOICE",
};

function generateInvoiceHtmlFromRecord(inv: InvoiceRecord): string {
  const docType = inv.document_type || "invoice";
  const heading = DOC_HEADINGS[docType] || "TAX INVOICE";
  const firmName = inv.from_firm_name || "Firm";
  const firmGstin = inv.from_gstin || "";
  const firmPan = inv.from_pan || "";
  const firmAddr = inv.from_address || "";
  const firmEmail = inv.from_email || "";
  const firmPhone = inv.from_phone || "";
  const toName = inv.to_name || "";
  const toGstin = inv.to_gstin || "";
  const toAddress = inv.to_address || "";
  const invoiceNo = inv.invoice_no || "";
  const invoiceDate = inv.invoice_date;
  const referenceNo = inv.reference_no || "";
  const placeOfSupply = inv.place_of_supply || "";
  const isIntraState = inv.is_intra_state !== false;
  const remarksConditions = inv.remarks_conditions || "";
  const bankDetails = inv.bank_details_snapshot || {};

  const items: any[] = Array.isArray(inv.line_items) ? inv.line_items : [];
  const hasGst = !!firmGstin;

  const totalTaxable = inv.subtotal || inv.amount || items.reduce((s: number, li: any) => s + (li.taxable_value || li.rate || 0), 0);
  const totalGst = inv.gst_amount || 0;
  const grandTotal = inv.total_amount || totalTaxable + totalGst;

  const thGst = hasGst ? `<th style="border:1px solid #bbb;padding:7px;font-size:10px;vertical-align:middle">GST %</th>` : "";

  const itemRows = items.map((item: any, i: number) => {
    const gstCol = hasGst
      ? `<td style="border:1px solid #bbb;padding:6px 8px;text-align:center;vertical-align:middle;font-size:11px">${item.gst_percent || 0}%</td>`
      : "";
    const itemTotal = hasGst ? (item.total || item.taxable_value || 0) : (item.taxable_value || item.rate || 0);
    return `<tr>
      <td style="border:1px solid #bbb;padding:6px 8px;text-align:center;vertical-align:middle;font-size:11px">${i + 1}.</td>
      <td style="border:1px solid #bbb;padding:6px 8px;vertical-align:middle;font-size:11px">
        ${item.description || ""}
        ${item.description_details ? `<div style="font-size:10px;color:#555;margin-top:2px;white-space:pre-line">${item.description_details}</div>` : ""}
      </td>
      <td style="border:1px solid #bbb;padding:6px 8px;text-align:center;vertical-align:middle;font-size:11px">${item.hsn_sac_code || ""}</td>
      <td style="border:1px solid #bbb;padding:6px 8px;text-align:right;vertical-align:middle;font-size:11px">${Number(item.quantity || 1).toFixed(2)}</td>
      <td style="border:1px solid #bbb;padding:6px 8px;text-align:right;vertical-align:middle;font-size:11px">${fmtINR(item.rate || 0)}</td>
      <td style="border:1px solid #bbb;padding:6px 8px;text-align:right;vertical-align:middle;font-size:11px">${fmtINR(item.taxable_value || 0)}</td>
      ${gstCol}
      <td style="border:1px solid #bbb;padding:6px 8px;text-align:right;vertical-align:middle;font-size:11px;font-weight:600">${fmtINR(itemTotal)}</td>
    </tr>`;
  }).join("");

  const colSpan = hasGst ? 5 : 4;
  const totalRow = `<tr style="background:#f0f0f0;font-weight:700">
    <td style="border:1px solid #bbb;padding:8px;vertical-align:middle" colspan="${colSpan}">Total</td>
    <td style="border:1px solid #bbb;padding:8px;text-align:right;vertical-align:middle;font-size:11px">${fmtINR(totalTaxable)}</td>
    ${hasGst ? `<td style="border:1px solid #bbb;padding:8px;vertical-align:middle"></td>` : ""}
    <td style="border:1px solid #bbb;padding:8px;text-align:right;vertical-align:middle;font-size:12px">${fmtINR(grandTotal)}</td>
  </tr>`;

  const halfGst = totalGst / 2;
  let totalsSummary = `<tr><td style="padding:3px 8px;vertical-align:middle">Taxable Amount</td><td style="padding:3px 8px;text-align:right;font-weight:600;vertical-align:middle">\u20B9${fmtINR(totalTaxable)}</td></tr>`;
  if (hasGst) {
    if (isIntraState) {
      totalsSummary += `
        <tr><td style="padding:3px 8px;vertical-align:middle">CGST</td><td style="padding:3px 8px;text-align:right;vertical-align:middle">\u20B9${fmtINR(halfGst)}</td></tr>
        <tr><td style="padding:3px 8px;vertical-align:middle">SGST</td><td style="padding:3px 8px;text-align:right;vertical-align:middle">\u20B9${fmtINR(halfGst)}</td></tr>`;
    } else {
      totalsSummary += `<tr><td style="padding:3px 8px;vertical-align:middle">IGST</td><td style="padding:3px 8px;text-align:right;vertical-align:middle">\u20B9${fmtINR(totalGst)}</td></tr>`;
    }
    totalsSummary += `<tr><td style="padding:3px 8px;vertical-align:middle">Round Off</td><td style="padding:3px 8px;text-align:right;vertical-align:middle">${(Math.round(grandTotal) - grandTotal) >= 0 ? "+" : ""}\u20B9${(Math.round(grandTotal) - grandTotal).toFixed(2)}</td></tr>`;
  }
  totalsSummary += `<tr style="font-weight:700;font-size:13px;border-top:2px solid #333"><td style="padding:6px 8px;vertical-align:middle">Grand Total</td><td style="padding:6px 8px;text-align:right;vertical-align:middle">\u20B9${Math.round(grandTotal).toLocaleString("en-IN")}</td></tr>`;

  const docLabel = heading === "TAX INVOICE" ? "Invoice" : heading.charAt(0) + heading.slice(1).toLowerCase();

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${heading} ${invoiceNo}</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; font-size: 12px; }
      table { width: 100%; border-collapse: collapse; }
      td, th { vertical-align: middle !important; }
    </style></head><body>
    <div style="border:2px solid #7ba4d9;padding:16px;margin:0">

    <div style="text-align:center;margin-bottom:16px;border:1.5px solid #7ba4d9;padding:4px 0;line-height:1.2">
      <h1 style="font-size:20px;font-weight:700;color:#8B4513;letter-spacing:1.5px;margin:0;padding:0">${heading}</h1>
    </div>

    <div style="display:flex;justify-content:space-between;margin-bottom:14px">
      <div style="flex:1;max-width:55%">
        <p style="font-weight:800;font-size:14px;margin:0 0 4px">${firmName.toUpperCase()}</p>
        ${firmAddr ? `<p style="margin:1px 0;font-size:11px;line-height:1.5">${firmAddr}</p>` : ""}
        ${placeOfSupply ? `<p style="margin:6px 0 0;font-size:11px"><strong>Place of Supply:</strong> ${placeOfSupply}</p>` : ""}
      </div>
      <div style="text-align:right;font-size:11px;min-width:280px">
        <div style="display:flex;justify-content:space-between;gap:20px">
          <div style="text-align:left">
            ${firmGstin ? `<p style="margin:2px 0"><strong>GSTIN:</strong> ${firmGstin}</p>` : ""}
            ${firmPan ? `<p style="margin:2px 0"><strong>PAN:</strong> ${firmPan}</p>` : ""}
            ${firmEmail ? `<p style="margin:2px 0"><strong>Email:</strong> ${firmEmail}</p>` : ""}
            ${firmPhone ? `<p style="margin:2px 0"><strong>Contact No:</strong> ${firmPhone}</p>` : ""}
          </div>
          <div style="text-align:right">
            <p style="margin:2px 0"><strong>${docLabel} Date:</strong> ${invoiceDate ? format(new Date(invoiceDate), "dd/MM/yyyy") : "\u2014"}</p>
            <p style="margin:2px 0"><strong>${docLabel} No:</strong> ${invoiceNo}</p>
            ${referenceNo ? `<p style="margin:2px 0"><strong>Ref No:</strong> ${referenceNo}</p>` : ""}
          </div>
        </div>
      </div>
    </div>

    <div style="border:1px solid #bbb;margin-bottom:12px;padding:10px">
      <p style="font-size:10px;font-weight:700;color:#666;text-transform:uppercase;margin:0 0 4px">Bill To</p>
      <p style="font-weight:600;margin:0;font-size:13px">${toName}</p>
      ${toAddress ? `<p style="margin:2px 0;font-size:11px">${toAddress}</p>` : ""}
      ${toGstin ? `<p style="margin:4px 0;font-size:11px"><strong>GSTIN:</strong> ${toGstin}</p>` : ""}
    </div>

    <table>
      <thead>
        <tr style="background:#e2e8f0">
          <th style="border:1px solid #bbb;padding:7px;font-size:10px;width:30px;vertical-align:middle">#</th>
          <th style="border:1px solid #bbb;padding:7px;font-size:10px;text-align:left;vertical-align:middle">Item</th>
          <th style="border:1px solid #bbb;padding:7px;font-size:10px;vertical-align:middle">HSN/SAC</th>
          <th style="border:1px solid #bbb;padding:7px;font-size:10px;vertical-align:middle">Quantity</th>
          <th style="border:1px solid #bbb;padding:7px;font-size:10px;vertical-align:middle">Rate / Item (\u20B9)</th>
          <th style="border:1px solid #bbb;padding:7px;font-size:10px;vertical-align:middle">Taxable Value (\u20B9)</th>
          ${thGst}
          <th style="border:1px solid #bbb;padding:7px;font-size:10px;vertical-align:middle">Total (\u20B9)</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
        ${totalRow}
      </tbody>
    </table>

    <div style="display:flex;justify-content:flex-end;margin-top:10px">
      <table style="width:320px;font-size:12px">${totalsSummary}</table>
    </div>

    <div style="margin:8px 0;padding:6px 8px;background:#f9f9f9;border:1px solid #ddd;font-size:11px">
      <strong>Amount in words:</strong> ${numberToWords(Math.round(grandTotal))}
    </div>

    ${remarksConditions ? `<div style="margin:8px 0;padding:6px 8px;font-size:11px;border:1px solid #ddd;page-break-inside:avoid;overflow:hidden">
      <strong>Remarks / Terms & Conditions:</strong><br/>
      <span style="white-space:pre-line;word-wrap:break-word;overflow-wrap:break-word">${remarksConditions}</span>
    </div>` : ""}

    <div style="display:flex;justify-content:space-between;margin-top:16px">
      <div style="border:1px solid #bbb;padding:10px;font-size:11px;min-width:300px">
        <p style="font-weight:700;margin:0 0 4px;font-size:12px">Bank Details:</p>
        ${bankDetails?.account_number || bankDetails?.account_no ? `<p style="margin:2px 0"><strong>Account No:</strong> ${bankDetails.account_number || bankDetails.account_no}</p>` : ""}
        ${bankDetails?.ifsc ? `<p style="margin:2px 0"><strong>IFSC:</strong> ${bankDetails.ifsc}</p>` : ""}
        ${bankDetails?.bank_name ? `<p style="margin:2px 0"><strong>Bank:</strong> ${bankDetails.bank_name}</p>` : ""}
        ${bankDetails?.branch ? `<p style="margin:2px 0"><strong>Branch:</strong> ${bankDetails.branch}</p>` : ""}
      </div>
      <div style="text-align:right;padding-top:8px">
        <p style="margin:0;font-size:12px;font-weight:600">For ${firmName.toUpperCase()}</p>
        <div style="height:50px"></div>
        <p style="margin:0;font-size:11px;border-top:1px solid #333;padding-top:4px">Authorised Signatory</p>
      </div>
    </div>

    <div style="margin-top:16px;padding-top:8px;padding-bottom:10px;border-top:1px solid #ddd;font-size:10px;color:#555">
      <p style="font-weight:700;margin:0 0 4px">Terms & Conditions:</p>
      <p style="margin:0;font-weight:700;letter-spacing:0.5px">PAYMENT TERMS: PAYMENT IS DUE WITHIN 45 DAYS FROM THE INVOICE DATE</p>
    </div>

    </div>
  </body></html>`;
}

/**
 * Generate a PDF Blob from an invoice database record
 */
export async function generateInvoicePdfBlob(inv: InvoiceRecord): Promise<Blob> {
  const html = generateInvoiceHtmlFromRecord(inv);
  const container = document.createElement("div");
  container.innerHTML = html;
  container.style.position = "absolute";
  container.style.left = "-9999px";
  container.style.top = "0";
  document.body.appendChild(container);

  try {
    const html2pdf = (await import("html2pdf.js")).default;
    const blob: Blob = await html2pdf().set({
      margin: [10, 10, 20, 10],
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
    }).from(container).outputPdf('blob');
    return blob;
  } finally {
    document.body.removeChild(container);
  }
}

/**
 * Safe filename from invoice no and client name
 */
export function invoicePdfFilename(invoiceNo: string | null, clientName: string): string {
  const safeNo = (invoiceNo || "doc").replace(/\//g, "-");
  const safeName = clientName.replace(/[^a-zA-Z0-9]/g, "_");
  return `${safeNo}_${safeName}.pdf`;
}
