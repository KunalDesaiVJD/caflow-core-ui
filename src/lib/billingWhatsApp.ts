/**
 * Every WhatsApp action on the Billing page opens this one number — never a
 * client's registered mobile. Change it here to change it everywhere.
 */
export const BILLING_WHATSAPP_NUMBER = "919727172515";
export const BILLING_WHATSAPP_DISPLAY = "+91 97271 72515";

/** WhatsApp Web chat with the billing number, message pre-filled for review. */
export function billingWhatsAppUrl(text: string): string {
  return `https://web.whatsapp.com/send?phone=${BILLING_WHATSAPP_NUMBER}&text=${encodeURIComponent(text)}`;
}
