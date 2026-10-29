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
