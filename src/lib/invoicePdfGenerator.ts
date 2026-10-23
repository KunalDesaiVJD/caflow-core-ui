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
  from_msme?: string | null;
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
  payment_due_days?: number | null;
  invoice_type?: string | null;
  export_currency?: string | null;
  exchange_rate?: number | null;
  lut_number?: string | null;
  [key: string]: any;
}

const DOC_HEADINGS: Record<string, string> = {
  invoice: "TAX INVOICE",
  credit_note: "CREDIT NOTE",
  quotation: "QUOTATION",
  proforma: "PROFORMA INVOICE",
};

function resolveInvoiceLogoUrl(_inv: InvoiceRecord): string {
  // Logo removed from invoices per user request — always show firm name text instead
  return "";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normaliseAddressSegments(address: string): string[] {
  return address
    .replace(/<br\s*\/?/gi, ",")
    .replace(/[\n\r]+/g, ",")
    .split(",")
    .map(segment => segment.trim())
    .filter(Boolean)
    .filter((segment, index, arr) => index === 0 || segment.toLowerCase() !== arr[index - 1].toLowerCase());
}

function formatFirmAddressHtml(address: string): string {
  const segments = normaliseAddressSegments(address);
  if (segments.length === 0) return "";

  const looksLikeVjDesaiAddress = ["ratnakar nine square", "itc narmada", "satellite", "380015"]
    .every(token => segments.some(segment => segment.toLowerCase().includes(token)));

  let lines: string[];
  if (looksLikeVjDesaiAddress) {
    lines = [
      [segments[0], segments[1]].filter(Boolean).join(", "),
      [segments[2], segments[3]].filter(Boolean).join(", "),
      segments.slice(4).join(", "),
    ].filter(Boolean);
  } else if (segments.length >= 5) {
    lines = [
      segments.slice(0, 2).join(", "),
      segments.slice(2, 4).join(", "),
      segments.slice(4).join(", "),
    ].filter(Boolean);
  } else {
    lines = [segments.join(", ")];
  }

  return lines
    .map((line, index) => {
      const cleanLine = escapeHtml(line.replace(/\s+,/g, ",").replace(/,{2,}/g, ",").replace(/\s*[–—]\s*/g, " - ").trim());
      const suffix = index < lines.length - 1 && !cleanLine.endsWith(",") ? "," : "";
      return `<span>${cleanLine}${suffix}</span>`;
    })
    .join("<br/>");
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

function validateCanvasContent(canvas: HTMLCanvasElement, label: string) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error(`[PDF] ${label}: canvas context unavailable for validation`);
  }

  const step = Math.max(8, Math.floor(Math.min(canvas.width, canvas.height) / 80));
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let sampleCount = 0;
  let nonWhiteCount = 0;

  for (let y = 0; y < canvas.height; y += step) {
    for (let x = 0; x < canvas.width; x += step) {
      const offset = (y * canvas.width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const a = data[offset + 3];
      sampleCount += 1;
      if (a > 0 && (r < 245 || g < 245 || b < 245)) {
        nonWhiteCount += 1;
      }
    }
  }

  const nonWhiteRatio = sampleCount > 0 ? nonWhiteCount / sampleCount : 0;
  console.log(`[PDF] ${label}: non-white ratio=${nonWhiteRatio.toFixed(4)}`);

  if (nonWhiteRatio < 0.003) {
    throw new Error(`[PDF] ${label}: rendered canvas appears blank`);
  }
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

  // Render at full 1:1 scale — preserves the original sizes of TAX INVOICE
  // title, firm name, line-item table etc. Single-page invoices stay single
  // page thanks to the HTML compaction (tighter section spacing, 42px
  // signature). Genuinely long invoices paginate naturally.
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
  console.log(`[PDF] ${label}: pages=${pdf.getNumberOfPages()} blob=${blob.size}`);

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
    "position:absolute",
    "left:0",
    "top:0",
    "width:794px",
    "height:1123px",
    "border:0",
    "pointer-events:none",
    "opacity:1",
    "z-index:-1",
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
  validateCanvasContent(canvas, label);
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

/**
 * Builds the printable HTML for an invoice / quotation / proforma.
 *
 * FORMATTING IS LOCKED. Every padding, margin, font-size, header height,
 * signature spacer and page margin in this template is a fixed literal.
 * Nothing scales with line_items.length, totals, or any other dynamic
 * value — when items are added or removed only the line-item table itself
 * grows or shrinks; the rest of the layout (TAX INVOICE title, firm name,
 * bill-to box, totals summary, bank/signature/terms block) renders at the
 * same dimensions every time. Do NOT introduce conditional sizing based
 * on item count or total amount — invoices are expected to look visually
 * identical save for the number of table rows.
 *
 * The single exception is the title block's bottom margin (8px for export
 * invoices vs 16px for domestic) which is a one-off design difference,
 * not a content-driven adjustment.
 */
export function buildInvoiceHtml(inv: InvoiceRecord): string {
  const docType = inv.document_type || "invoice";

  // \u2500\u2500 Export invoice detection \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const isExportWithIGST   = inv.invoice_type === "export_with_igst";
  const isExportWithoutIGST = inv.invoice_type === "export_without_igst";
  const isExport = isExportWithIGST || isExportWithoutIGST;
  const currency  = (isExport && inv.export_currency) ? inv.export_currency : null;
  const exRate    = (isExport && inv.exchange_rate) ? Number(inv.exchange_rate) : 1;
  const lutNumber = inv.lut_number || "";

  // Heading: export without IGST uses "EXPORT INVOICE"; others follow doc type
  let heading = isExportWithoutIGST ? "EXPORT INVOICE" : (DOC_HEADINGS[docType] || "TAX INVOICE");

  // Amount formatters: FC for export, INR otherwise
  const fmtAmt = (n: number) =>
    isExport
      ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : fmtINR(n);
  const currSym = isExport ? (currency + " ") : "\u20B9";

  const firmName = inv.from_firm_name || "Firm";
  const firmGstin = inv.from_gstin || "";
  const firmPan = inv.from_pan || "";
  const firmMsme = inv.from_msme || "";
  const paymentDueDays = (typeof inv.payment_due_days === "number" && inv.payment_due_days > 0)
    ? inv.payment_due_days
    : 45;
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
  const firmAddressHtml = formatFirmAddressHtml(firmAddr);

  const items: any[] = Array.isArray(inv.line_items) ? inv.line_items : [];
  const hasGst = !!firmGstin;

  // FC totals (from line items \u2014 stored as FC for export invoices, INR for domestic)
  const fcTotalTaxable = items.reduce((s: number, li: any) => s + (li.taxable_value || 0), 0);
  const fcTotalGst     = items.reduce((s: number, li: any) => s + (li.gst_amount || 0), 0);
  const fcGrandTotal   = fcTotalTaxable + fcTotalGst;

  // Display totals: FC for export, INR otherwise
  const totalTaxable = isExport
    ? fcTotalTaxable
    : (inv.subtotal || inv.amount || fcTotalTaxable);
  const totalGst = isExport
    ? (isExportWithoutIGST ? 0 : fcTotalGst)
    : (inv.gst_amount || 0);
  const grandTotal = totalTaxable + totalGst;

  // INR grand total for export (for "Amount in words" row in INR)
  const inrGrandTotal = isExport
    ? (inv.total_amount || Math.round(grandTotal * exRate))
    : (inv.total_amount || grandTotal);

  const thGst = hasGst ? `<th style="border:1px solid #bbb;padding:5px 6px;font-size:10px;vertical-align:middle">GST %</th>` : "";

  const identityMarkup = logoUrl
    ? `<img src="${logoUrl}" style="max-height:64px;max-width:200px;object-fit:contain;margin-bottom:0;display:block" crossorigin="anonymous" />`
    : `<p style="font-weight:800;font-size:14px;margin:0 0 2px">${firmName.toUpperCase()}</p>`;

  const itemRows = items.map((item: any, i: number) => {
    const gstCol = hasGst
      ? `<td style="border:1px solid #bbb;padding:3px 6px;text-align:center;vertical-align:middle;font-size:11px">${item.gst_percent || 0}%</td>`
      : "";
    const itemTotal = hasGst ? (item.total || item.taxable_value || 0) : (item.taxable_value || item.rate || 0);
    return `<tr>
      <td style="border:1px solid #bbb;padding:3px 6px;text-align:center;vertical-align:middle;font-size:11px">${i + 1}.</td>
      <td style="border:1px solid #bbb;padding:0;vertical-align:middle;font-size:11px">
        <div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:center;min-height:26px;padding:4px 6px;line-height:1.35">
          <div>${item.description || ""}</div>
          ${item.description_details ? `<div style="font-size:10px;color:#555;white-space:pre-line">${item.description_details}</div>` : ""}
        </div>
      </td>
      <td style="border:1px solid #bbb;padding:3px 6px;text-align:center;vertical-align:middle;font-size:11px">${item.hsn_sac_code || ""}</td>
      <td style="border:1px solid #bbb;padding:3px 6px;text-align:right;vertical-align:middle;font-size:11px">${Number(item.quantity || 1).toFixed(2)}</td>
      <td style="border:1px solid #bbb;padding:3px 6px;text-align:right;vertical-align:middle;font-size:11px">${currSym}${fmtAmt(item.rate || 0)}</td>
      <td style="border:1px solid #bbb;padding:3px 6px;text-align:right;vertical-align:middle;font-size:11px">${currSym}${fmtAmt(item.taxable_value || 0)}</td>
      ${gstCol}
      <td style="border:1px solid #bbb;padding:3px 6px;text-align:right;vertical-align:middle;font-size:11px;font-weight:600">${currSym}${fmtAmt(itemTotal)}</td>
    </tr>`;
  }).join("");

  const colSpan = hasGst ? 5 : 4;
  const totalRow = `<tr style="background:#f0f0f0;font-weight:700">
    <td style="border:1px solid #bbb;padding:5px 6px;vertical-align:middle" colspan="${colSpan}">Total</td>
    <td style="border:1px solid #bbb;padding:8px;text-align:right;vertical-align:middle;font-size:11px">${currSym}${fmtAmt(totalTaxable)}</td>
    ${hasGst ? `<td style="border:1px solid #bbb;padding:5px 6px;vertical-align:middle"></td>` : ""}
    <td style="border:1px solid #bbb;padding:8px;text-align:right;vertical-align:middle;font-size:12px">${currSym}${fmtAmt(grandTotal)}</td>
  </tr>`;

  const halfGst = totalGst / 2;
  let totalsSummary = `<tr><td style="padding:3px 8px;vertical-align:middle">Taxable Amount</td><td style="padding:3px 8px;text-align:right;font-weight:600;vertical-align:middle">${currSym}${fmtAmt(totalTaxable)}</td></tr>`;
  if (hasGst && !isExportWithoutIGST) {
    if (!isExport && isIntraState) {
      totalsSummary += `
        <tr><td style="padding:3px 8px;vertical-align:middle">CGST</td><td style="padding:3px 8px;text-align:right;vertical-align:middle">\u20B9${fmtINR(halfGst)}</td></tr>
        <tr><td style="padding:3px 8px;vertical-align:middle">SGST</td><td style="padding:3px 8px;text-align:right;vertical-align:middle">\u20B9${fmtINR(halfGst)}</td></tr>`;
    } else {
      // inter-state or export with IGST
      totalsSummary += `<tr><td style="padding:3px 8px;vertical-align:middle">IGST</td><td style="padding:3px 8px;text-align:right;vertical-align:middle">${currSym}${fmtAmt(totalGst)}</td></tr>`;
    }
    totalsSummary += `<tr><td style="padding:3px 8px;vertical-align:middle">Round Off</td><td style="padding:3px 8px;text-align:right;vertical-align:middle">${(Math.round(grandTotal) - grandTotal) >= 0 ? "+" : ""}${currSym}${Math.abs(Math.round(grandTotal) - grandTotal).toFixed(2)}</td></tr>`;
  }
  totalsSummary += `<tr style="font-weight:700;font-size:13px;border-top:2px solid #333"><td style="padding:6px 8px;vertical-align:middle">Grand Total</td><td style="padding:6px 8px;text-align:right;vertical-align:middle">${currSym}${fmtAmt(Math.round(grandTotal))}</td></tr>`;

  // For export: add exchange rate and INR equivalent rows
  if (isExport) {
    totalsSummary += `
      <tr style="border-top:1px solid #ccc"><td style="padding:4px 8px;font-size:10px;color:#555">Exchange Rate</td><td style="padding:4px 8px;text-align:right;font-size:10px;color:#555">1 ${currency} = \u20B9${exRate.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td></tr>
      <tr style="font-weight:700;font-size:12px;background:#f0f4ff"><td style="padding:5px 8px;vertical-align:middle">INR Equivalent</td><td style="padding:5px 8px;text-align:right;vertical-align:middle">\u20B9${Math.round(inrGrandTotal).toLocaleString("en-IN")}</td></tr>`;
  }

  const docLabel = (heading === "TAX INVOICE" || heading === "EXPORT INVOICE") ? "Invoice" : heading.charAt(0) + heading.slice(1).toLowerCase();

  // Export declaration text (mandatory per GST Rules)
  const exportDeclaration = isExportWithIGST
    ? `<div style="text-align:center;margin-bottom:10px;font-size:10.5px;font-style:italic;color:#444;border:1px solid #e0b060;background:#fffbf0;padding:5px 10px;border-radius:3px">
        Supply meant for Export under Bond or Letter of Undertaking with payment of IGST
      </div>`
    : isExportWithoutIGST
    ? `<div style="text-align:center;margin-bottom:10px;font-size:10.5px;font-style:italic;color:#444;border:1px solid #e0b060;background:#fffbf0;padding:5px 10px;border-radius:3px">
        Supply meant for Export under Bond or Letter of Undertaking without payment of IGST
      </div>`
    : "";

  // Amount-in-words section
  const amountInWords = isExport
    ? `<strong>Amount in Foreign Currency (${currency}):</strong> ${numberToWords(Math.round(grandTotal))} <span style="font-size:10px;color:#555">&nbsp;|&nbsp; <strong>INR Equivalent:</strong> ${numberToWords(Math.round(inrGrandTotal))}</span>`
    : `<strong>Amount in words:</strong> ${numberToWords(Math.round(grandTotal))}`;

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

    <div style="text-align:center;margin-bottom:${isExport ? "8px" : "16px"};padding:6px 0;line-height:1.2">
      <h1 style="font-size:20px;font-weight:700;color:#8B4513;letter-spacing:1.5px;margin:0;padding:0;display:inline">${heading}</h1>
    </div>

    ${inv.status === "voided" ? `<div style="text-align:center;margin:-8px 0 12px;padding:4px 0;border:2px solid #b91c1c;color:#b91c1c;font-size:14px;font-weight:700;letter-spacing:3px">CANCELLED${inv.voided_reason ? ` <span style="font-size:10px;font-weight:400;letter-spacing:0">— ${String(inv.voided_reason).replace(/[<>&]/g, "")}</span>` : ""}</div>` : ""}

    ${exportDeclaration}

    <div style="display:flex;justify-content:space-between;margin-bottom:14px">
      <div style="flex:1;max-width:55%">
        ${identityMarkup}
        ${firmAddressHtml ? `<p style="margin:1px 0;font-size:11px;line-height:1.5;max-width:340px">${firmAddressHtml}</p>` : ""}
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
            ${lutNumber ? `<p style="margin:2px 0"><strong>LUT No:</strong> ${lutNumber}</p>` : ""}
            ${referenceNo ? `<p style="margin:2px 0"><strong>Ref No:</strong> ${referenceNo}</p>` : ""}
            ${isExport ? `<p style="margin:2px 0"><strong>Currency:</strong> ${currency}</p>` : ""}
          </div>
        </div>
      </div>
    </div>

    <div style="border:1px solid #bbb;margin-bottom:8px;padding:6px 9px">
      <p style="font-size:10px;font-weight:700;color:#666;text-transform:uppercase;margin:0 0 4px">Bill To</p>
      <p style="font-weight:600;margin:0;font-size:13px">${toName}</p>
      ${toAddress ? `<p style="margin:2px 0;font-size:11px">${toAddress}</p>` : ""}
      ${toGstin ? `<p style="margin:4px 0;font-size:11px"><strong>GSTIN:</strong> ${toGstin}</p>` : ""}
      ${placeOfSupply && !isExport ? `<p style="margin:4px 0;font-size:11px"><strong>Place of Supply:</strong> ${placeOfSupply}</p>` : ""}
    </div>

    <table>
      <thead>
        <tr style="background:#e2e8f0">
          <th style="border:1px solid #bbb;padding:5px 6px;font-size:10px;width:30px;vertical-align:middle">#</th>
          <th style="border:1px solid #bbb;padding:5px 6px;font-size:10px;text-align:left;vertical-align:middle">Item</th>
          <th style="border:1px solid #bbb;padding:5px 6px;font-size:10px;vertical-align:middle">HSN/SAC</th>
          <th style="border:1px solid #bbb;padding:5px 6px;font-size:10px;vertical-align:middle">Quantity</th>
          <th style="border:1px solid #bbb;padding:5px 6px;font-size:10px;vertical-align:middle">Rate / Item (${isExport ? currency : "\u20B9"})</th>
          <th style="border:1px solid #bbb;padding:5px 6px;font-size:10px;vertical-align:middle">Taxable Value (${isExport ? currency : "\u20B9"})</th>
          ${thGst}
          <th style="border:1px solid #bbb;padding:5px 6px;font-size:10px;vertical-align:middle">Total (${isExport ? currency : "\u20B9"})</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
        ${totalRow}
      </tbody>
    </table>

    <div style="display:flex;justify-content:flex-end;margin-top:10px">
      <table style="width:360px;font-size:12px">${totalsSummary}</table>
    </div>

    <div style="margin:8px 0;padding:6px 8px;background:#f9f9f9;border:1px solid #ddd;font-size:11px">
      ${amountInWords}
    </div>

    ${remarksConditions ? `<div style="margin:8px 0;padding:6px 8px;font-size:11px;border:1px solid #ddd;page-break-inside:avoid;overflow:hidden">
      <strong>Remarks / Terms & Conditions:</strong><br/>
      <span style="white-space:pre-line;word-wrap:break-word;overflow-wrap:break-word">${remarksConditions}</span>
    </div>` : ""}

    <div style="display:flex;justify-content:space-between;margin-top:8px">
      <div style="border:1px solid #bbb;padding:6px 8px;font-size:11px;min-width:300px">
        <p style="font-weight:700;margin:0 0 3px;font-size:12px">Bank Details:</p>
        ${bankDetails?.account_number || bankDetails?.account_no ? `<p style="margin:1px 0"><strong>Account No:</strong> ${bankDetails.account_number || bankDetails.account_no}</p>` : ""}
        ${bankDetails?.ifsc ? `<p style="margin:1px 0"><strong>IFSC:</strong> ${bankDetails.ifsc}</p>` : ""}
        ${bankDetails?.bank_name ? `<p style="margin:1px 0"><strong>Bank:</strong> ${bankDetails.bank_name}</p>` : ""}
        ${bankDetails?.branch ? `<p style="margin:1px 0"><strong>Branch:</strong> ${bankDetails.branch}</p>` : ""}
      </div>
      <div style="text-align:right;padding-top:4px">
        <p style="margin:0;font-size:12px;font-weight:600">For ${firmName.toUpperCase()}</p>
        <div style="height:42px"></div>
        <p style="margin:0;font-size:11px;border-top:1px solid #333;padding-top:3px">Authorised Signatory</p>
      </div>
    </div>

    <div style="margin-top:8px;padding-top:6px;padding-bottom:6px;border-top:1px solid #ddd;font-size:10px;color:#555">
      <p style="font-weight:700;margin:0 0 3px">Terms & Conditions:</p>
      <p style="margin:0;font-weight:700;letter-spacing:0.5px">PAYMENT TERMS: PAYMENT IS DUE WITHIN ${paymentDueDays} DAYS FROM THE INVOICE DATE</p>
      ${firmMsme ? `<p style="margin:4px 0 0;font-weight:700;letter-spacing:0.5px">MSME No: ${firmMsme}</p>` : ""}
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
