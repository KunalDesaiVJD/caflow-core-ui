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
  logo_url?: string | null;
  show_logo?: boolean | null;
  firm_settings?: {
    logo_url?: string | null;
  } | null;
  [key: string]: any;
}

const DOC_HEADINGS: Record<string, string> = {
  invoice: "TAX INVOICE",
  credit_note: "CREDIT NOTE",
  quotation: "QUOTATION",
  proforma: "PROFORMA INVOICE",
};

function resolveInvoiceLogoUrl(inv: InvoiceRecord): string {
  if (inv.show_logo === false) return "";
  return inv.logo_url || inv.firm_settings?.logo_url || "";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function waitForElementRender(element: HTMLElement, label: string) {
  const doc = element.ownerDocument;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await new Promise(resolve => setTimeout(resolve, 450));

  try {
    if ("fonts" in doc && doc.fonts) {
      await doc.fonts.ready;
    }
  } catch {
    // ignore font readiness issues
  }

  const images = Array.from(element.querySelectorAll("img"));
  await Promise.all(images.map(img => new Promise<void>(resolve => {
    if (img.complete && img.naturalWidth > 0) {
      resolve();
      return;
    }

    const done = () => resolve();
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", () => {
      console.warn(`[PDF] ${label}: image failed to load`, img.getAttribute("src"));
      resolve();
    }, { once: true });
    setTimeout(resolve, 4000);
  })));
}

async function renderElementToCanvas(element: HTMLElement, label: string) {
  const html2canvas = (await import("html2canvas")).default;
  await waitForElementRender(element, label);

  const contentLength = element.innerHTML.trim().length;
  const width = Math.max(element.scrollWidth, element.clientWidth, 794);
  const height = Math.max(element.scrollHeight, element.clientHeight, 1123);

  console.log(`[PDF] ${label}: element found=${!!element}, content=${contentLength}, size=${width}x${height}`);

  if (!contentLength || width <= 0 || height <= 0) {
    throw new Error(`[PDF] ${label}: export target is empty or has invalid dimensions`);
  }

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    allowTaint: true,
    backgroundColor: "#ffffff",
    logging: false,
    width,
    height,
    windowWidth: width,
    windowHeight: height,
    scrollX: 0,
    scrollY: 0,
  });

  console.log(`[PDF] ${label}: canvas=${canvas.width}x${canvas.height}`);

  if (!canvas.width || !canvas.height) {
    throw new Error(`[PDF] ${label}: html2canvas returned an empty canvas`);
  }

  return canvas;
}

async function canvasToPdfBlob(canvas: HTMLCanvasElement, label: string) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const printableWidth = pageWidth - margin * 2;
  const printableHeight = pageHeight - margin * 2;
  const imageHeight = (canvas.height * printableWidth) / canvas.width;
  const imageData = canvas.toDataURL("image/png", 1);

  let heightLeft = imageHeight;
  let position = margin;

  pdf.addImage(imageData, "PNG", margin, position, printableWidth, imageHeight, undefined, "FAST");
  heightLeft -= printableHeight;

  while (heightLeft > 0) {
    position = margin - (imageHeight - heightLeft);
    pdf.addPage();
    pdf.addImage(imageData, "PNG", margin, position, printableWidth, imageHeight, undefined, "FAST");
    heightLeft -= printableHeight;
  }

  const blob = pdf.output("blob");
  console.log(`[PDF] ${label}: blob size=${blob.size}`);

  if (blob.size < 5000) {
    throw new Error(`[PDF] ${label}: generated PDF blob is suspiciously small (${blob.size} bytes)`);
  }

  return blob;
}

async function createRenderIframe(fullHtml: string, label: string) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.setAttribute("sandbox", "allow-same-origin");
  iframe.style.cssText = [
    "position:fixed",
    "right:0",
    "bottom:0",
    "width:794px",
    "height:1123px",
    "border:0",
    "pointer-events:none",
    "opacity:0",
    "background:#ffffff",
  ].join(";");

  document.body.appendChild(iframe);

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(`[PDF] ${label}: iframe load timed out`)), 6000);
    iframe.onload = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    iframe.srcdoc = fullHtml;
  });

  const doc = iframe.contentDocument;
  if (!doc?.body) {
    iframe.remove();
    throw new Error(`[PDF] ${label}: iframe document not available`);
  }

  return { iframe, body: doc.body };
}

export async function generatePdfBlobFromElement(element: HTMLElement, label = "Invoice PDF"): Promise<Blob> {
  const canvas = await renderElementToCanvas(element, label);
  return canvasToPdfBlob(canvas, label);
}

export async function generatePdfBlobFromHtml(fullHtml: string, label = "Invoice PDF"): Promise<Blob> {
  const { iframe, body } = await createRenderIframe(fullHtml, label);

  try {
    return await generatePdfBlobFromElement(body, label);
  } finally {
    iframe.remove();
  }
}

export async function downloadPdfFromHtml(fullHtml: string, filename: string, label = filename) {
  const blob = await generatePdfBlobFromHtml(fullHtml, label);
  downloadBlob(blob, filename);
}

export function downloadPdfBlob(blob: Blob, filename: string) {
  downloadBlob(blob, filename);
}

export function buildInvoiceHtml(inv: InvoiceRecord): string {
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
  const logoUrl = resolveInvoiceLogoUrl(inv);

  const items: any[] = Array.isArray(inv.line_items) ? inv.line_items : [];
  const hasGst = !!firmGstin;

  const totalTaxable = inv.subtotal || inv.amount || items.reduce((s: number, li: any) => s + (li.taxable_value || li.rate || 0), 0);
  const totalGst = inv.gst_amount || 0;
  const grandTotal = inv.total_amount || totalTaxable + totalGst;

  const thGst = hasGst ? `<th style="border:1px solid #bbb;padding:7px;font-size:10px;vertical-align:middle">GST %</th>` : "";

  const identityMarkup = logoUrl
    ? `<img src="${logoUrl}" style="max-height:64px;max-width:200px;object-fit:contain;margin-bottom:2px;display:block" crossorigin="anonymous" />`
    : `<p style="font-weight:800;font-size:14px;margin:0 0 2px">${firmName.toUpperCase()}</p>`;

  const itemRows = items.map((item: any, i: number) => {
    const gstCol = hasGst
      ? `<td style="border:1px solid #bbb;padding:6px 8px;text-align:center;vertical-align:middle;font-size:11px">${item.gst_percent || 0}%</td>`
      : "";
    const itemTotal = hasGst ? (item.total || item.taxable_value || 0) : (item.taxable_value || item.rate || 0);
    return `<tr>
      <td style="border:1px solid #bbb;padding:6px 8px;text-align:center;vertical-align:middle;font-size:11px">${i + 1}.</td>
      <td style="border:1px solid #bbb;padding:0;vertical-align:middle;font-size:11px">
        <div style="display:flex;flex-direction:column;justify-content:center;min-height:38px;padding:8px;line-height:1.4">
          <div>${item.description || ""}</div>
          ${item.description_details ? `<div style="font-size:10px;color:#555;white-space:pre-line">${item.description_details}</div>` : ""}
        </div>
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
      body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; font-size: 12px; background: #ffffff; }
      table { width: 100%; border-collapse: collapse; }
      td, th { vertical-align: middle !important; }
      @media print { @page { size: A4; margin: 20mm 15mm 20mm 15mm; } body { margin: 0; padding: 0; } }
      @media screen { body { padding: 20mm 15mm; max-width: 210mm; margin: 0 auto; } }
    </style></head><body>
      <div style="border:1px solid #bbb;padding:12px 14px">

    <div style="text-align:center;margin-bottom:16px;padding:6px 0;line-height:1.2">
      <h1 style="font-size:20px;font-weight:700;color:#8B4513;letter-spacing:1.5px;margin:0;padding:0;display:inline">${heading}</h1>
    </div>

    <div style="display:flex;justify-content:space-between;margin-bottom:14px">
      <div style="flex:1;max-width:55%">
        ${identityMarkup}
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
  const fullHtml = buildInvoiceHtml(inv);
  return generatePdfBlobFromHtml(fullHtml, `Bulk invoice ${inv.invoice_no || "draft"}`);
}

/**
 * Safe filename from invoice no and client name
 */
export function invoicePdfFilename(invoiceNo: string | null, clientName: string): string {
  const safeNo = (invoiceNo || "doc").replace(/\//g, "-");
  const safeName = clientName.replace(/[^a-zA-Z0-9]/g, "_");
  return `${safeNo}_${safeName}.pdf`;
}
