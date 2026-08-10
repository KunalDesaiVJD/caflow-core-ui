/**
 * matchChallanDownload — per-challan Matched/Not Matched verdict, the real
 * check the old CSI flow's header-only comparison could never do (see
 * parseChallanPaymentHistory.ts's own doc for why). For each OFFICE challan
 * (tds_challans, this filing, not archived — same convention every other
 * "office total" computation in this module uses), looks for a portal row
 * with the same challan serial number, deposit date, and amount — and,
 * when the portal row actually carries one, BSR code too. BSR is compared
 * only when the portal side has a value: parseChallanPaymentHistory's own
 * extraction of it from a real export isn't confirmed yet (see its header
 * doc), so a null there is "couldn't tell", never treated as "different
 * office record" — never penalise on absence of evidence.
 */
import type { PortalChallanRow } from "./parseChallanPaymentHistory";

export interface OfficeChallanForMatch {
  id: string;
  bsr_code?: string | null;
  challan_serial_no?: string | null;
  deposit_date?: string | null; // yyyy-mm-dd, as returned by Supabase for a `date` column
  total_challan_amount?: number | null;
}

export interface ChallanMatchResult {
  officeChallanId: string;
  officeSerialNo: string | null;
  officeDate: string | null;
  officeAmount: number;
  matched: boolean;
  reason: string | null;
}

const normSerial = (s: string | null | undefined) => (s || "").trim().replace(/^0+(?=\d)/, "");
// Paise-precision amount compare — same convention as computeChallanOverApplied
// (src/lib/tds/rateEngine.ts) and the old CSI amount_match, avoids float noise.
const amountsEqual = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);
const normBsr = (s: string | null | undefined) => (s || "").trim();
// true only when BOTH sides actually have a BSR value AND they differ —
// a blank on either side is "nothing to compare", not a mismatch.
const bsrConflicts = (portal: string | null, office: string | null | undefined) => {
  const p = normBsr(portal), o = normBsr(office);
  return !!p && !!o && p !== o;
};

export function matchChallanDownload(
  officeChallans: OfficeChallanForMatch[],
  portalRows: PortalChallanRow[],
): ChallanMatchResult[] {
  return officeChallans.map((office) => {
    const officeSerial = normSerial(office.challan_serial_no);
    const officeAmount = office.total_challan_amount ?? 0;

    if (!officeSerial) {
      return {
        officeChallanId: office.id, officeSerialNo: office.challan_serial_no ?? null,
        officeDate: office.deposit_date ?? null, officeAmount,
        matched: false, reason: "Office challan has no serial number recorded",
      };
    }

    const bySerial = portalRows.filter((p) => normSerial(p.serialNo) === officeSerial);
    if (!bySerial.length) {
      return {
        officeChallanId: office.id, officeSerialNo: office.challan_serial_no ?? null,
        officeDate: office.deposit_date ?? null, officeAmount,
        matched: false, reason: "No portal challan with this serial number",
      };
    }

    const exact = bySerial.find((p) =>
      p.depositDate === office.deposit_date && amountsEqual(p.amount, officeAmount) && !bsrConflicts(p.bsrCode, office.bsr_code));
    if (exact) {
      return {
        officeChallanId: office.id, officeSerialNo: office.challan_serial_no ?? null,
        officeDate: office.deposit_date ?? null, officeAmount, matched: true, reason: null,
      };
    }

    const dateMismatch = bySerial.every((p) => p.depositDate !== office.deposit_date);
    const bsrMismatch = !dateMismatch && bySerial.every((p) => bsrConflicts(p.bsrCode, office.bsr_code));
    const reason = dateMismatch
      ? `Portal challan #${officeSerial} is dated ${bySerial[0].depositDate}, office shows ${office.deposit_date ?? "—"}`
      : bsrMismatch
      ? `Portal challan #${officeSerial} has BSR code ${bySerial[0].bsrCode}, office shows ${office.bsr_code ?? "—"}`
      : `Portal challan #${officeSerial} amount differs (portal ₹${bySerial[0].amount.toLocaleString("en-IN")}, office ₹${officeAmount.toLocaleString("en-IN")})`;
    return {
      officeChallanId: office.id, officeSerialNo: office.challan_serial_no ?? null,
      officeDate: office.deposit_date ?? null, officeAmount, matched: false, reason,
    };
  });
}
