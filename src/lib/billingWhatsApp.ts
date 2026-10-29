import { downloadBlob } from "@/lib/downloadBlob";

/**
 * Every WhatsApp action on the Billing page opens this one number — never a
 * client's registered mobile — except a client group's statement, which uses the
 * number saved on the group (Clients → Groups). Change it here to change it everywhere.
 */
export const BILLING_WHATSAPP_NUMBER = "919727172515";
export const BILLING_WHATSAPP_DISPLAY = "+91 97271 72515";

/**
 * WhatsApp Web chat, message pre-filled for review — the billing number unless a
 * client group's saved number is passed (digits with country code).
 */
export function billingWhatsAppUrl(text: string, phone: string = BILLING_WHATSAPP_NUMBER): string {
  return `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(text)}`;
}

// The WhatsApp Web tab this app opened. Chrome clears a tab's window name when it
// navigates to another site, so window.open(url, "name") can't find it again —
// holding the Window reference is what lets every send reuse the same tab.
let waTab: Window | null = null;

/**
 * Get the WhatsApp tab to use — the one already open, or a new blank one.
 * Call it synchronously inside the click handler, before any await, or the
 * browser's popup blocker stops a new tab. Returns null when the extension is
 * installed: it reuses the user's own WhatsApp Web tab instead.
 */
export function reserveBillingWhatsAppTab(force = false): Window | null {
  if (!force && hasWhatsAppExtension()) return null;
  if (waTab && !waTab.closed) return waTab;
  waTab = window.open("about:blank", "caflow_whatsapp");
  return waTab;
}

/** Close the reserved tab only if it is still blank (never an open chat). */
export function releaseBillingWhatsAppTab(tab: Window | null) {
  try { if (tab && tab.location.href === "about:blank") { tab.close(); if (tab === waTab) waTab = null; } }
  catch { /* cross-origin: an open WhatsApp chat — leave it */ }
}

/** True when the CAFlow WhatsApp Chrome extension (extensions/caflow-whatsapp) is installed. */
export function hasWhatsAppExtension(): boolean {
  return !!document.documentElement.dataset.caflowWhatsapp;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Hand the send to the extension: it reuses the open WhatsApp Web tab and attaches the PDF there. */
async function sendViaExtension(phone: string, text: string, pdf: { blob: Blob; filename: string } | null | undefined): Promise<void> {
  const id = crypto.randomUUID();
  const payload = pdf ? { base64: await blobToBase64(pdf.blob), filename: pdf.filename } : null;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { window.removeEventListener("message", onResult); reject(new Error("WhatsApp extension did not respond")); }, 15_000);
    function onResult(e: MessageEvent) {
      if (e.source !== window || e.data?.type !== "CAFLOW_WA_RESULT" || e.data.id !== id) return;
      clearTimeout(timer);
      window.removeEventListener("message", onResult);
      if (e.data.ok) resolve(); else reject(new Error(e.data.error || "WhatsApp extension failed"));
    }
    window.addEventListener("message", onResult);
    window.postMessage({ type: "CAFLOW_WA_SEND", id, phone, text, pdf: payload }, window.location.origin);
  });
}

/**
 * Open the billing WhatsApp chat with the message typed in and the PDF ready.
 * With the extension: the already-open WhatsApp Web tab is reused and the PDF
 * is attached in the chat for review. Without it (or if it fails): the tab this
 * app opened is reused and the PDF downloads for attaching by hand.
 */
export async function sendBillingWhatsApp(opts: {
  tab: Window | null;
  text: string;
  pdf?: { blob: Blob; filename: string } | null;
  /** WhatsApp digits with country code; defaults to the billing number. */
  phone?: string;
}): Promise<{ attached: boolean }> {
  if (hasWhatsAppExtension()) {
    try {
      await sendViaExtension(opts.phone || BILLING_WHATSAPP_NUMBER, opts.text, opts.pdf);
      return { attached: !!opts.pdf };
    } catch (e) {
      console.error("[BillingWhatsApp] extension send failed, falling back:", e);
    }
  }
  if (opts.pdf) downloadBlob(opts.pdf.blob, opts.pdf.filename);
  const url = billingWhatsAppUrl(opts.text, opts.phone);
  const tab = opts.tab && !opts.tab.closed ? opts.tab : reserveBillingWhatsAppTab(true);
  if (tab) { tab.location.href = url; tab.focus(); }
  else window.open(url, "_blank");
  return { attached: false };
}
