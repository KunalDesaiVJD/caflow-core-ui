/**
 * WhatsApp sending from the Billing page goes through the CAFlow WhatsApp Chrome
 * extension (extensions/caflow-whatsapp). It reuses the WhatsApp Web tab already
 * open in Chrome, checks that tab is logged in as the billing (sender) number,
 * opens the recipient's chat with the message typed in and attaches the PDF.
 * Nothing is sent until the user presses Send in WhatsApp.
 */

/** The WhatsApp account every billing message must be sent from. */
export const BILLING_WHATSAPP_NUMBER = "919727172515";
export const BILLING_WHATSAPP_DISPLAY = "+91 97271 72515";

/** True when the CAFlow WhatsApp Chrome extension is installed. */
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

/**
 * Open the recipient's chat from the billing number, with the message typed in
 * and the PDF attached for review. Throws (with a message to show the user) when
 * the extension is missing, WhatsApp Web is not logged in as the billing number,
 * or the recipient number is not valid.
 *
 * @param phone recipient, digits with country code (e.g. 919876543210)
 */
export async function sendBillingWhatsApp(opts: {
  phone: string;
  text: string;
  pdf?: { blob: Blob; filename: string } | null;
}): Promise<void> {
  if (!hasWhatsAppExtension()) {
    throw new Error("Install the CAFlow WhatsApp extension (link in the WhatsApp dialog) — it is needed to check the message goes out from " + BILLING_WHATSAPP_DISPLAY + ".");
  }
  const id = crypto.randomUUID();
  const pdf = opts.pdf ? { base64: await blobToBase64(opts.pdf.blob), filename: opts.pdf.filename } : null;
  await new Promise<void>((resolve, reject) => {
    // Generous: the extension may wait for WhatsApp Web to load and log in.
    const timer = setTimeout(() => { window.removeEventListener("message", onResult); reject(new Error("The WhatsApp extension did not respond")); }, 150_000);
    function onResult(e: MessageEvent) {
      if (e.source !== window || e.data?.type !== "CAFLOW_WA_RESULT" || e.data.id !== id) return;
      clearTimeout(timer);
      window.removeEventListener("message", onResult);
      if (e.data.ok) resolve(); else reject(new Error(e.data.error || "The WhatsApp extension failed"));
    }
    window.addEventListener("message", onResult);
    window.postMessage({ type: "CAFLOW_WA_SEND", id, phone: opts.phone, sender: BILLING_WHATSAPP_NUMBER, text: opts.text, pdf }, window.location.origin);
  });
}
