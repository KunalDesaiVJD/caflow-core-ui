/**
 * firmResolver
 *
 * Single source of truth for resolving an engagement's audit firm and the
 * engagement partner's ICAI membership number.
 *
 * Rules:
 *   - The engagement's `firm_id` column (→ `firms` table) is canonical.
 *   - Partner membership lives in `firms.membership_numbers` JSONB array of
 *     `{ partner_name, membership_no }`. We match by user name (from
 *     `audit_engagements.partner_id → users.name`) case-insensitively.
 *   - There is NEVER a hardcoded firm fallback (no VJ Desai ghost).
 */
import { supabase } from "@/integrations/supabase/client";

export interface MembershipEntry {
  partner_name: string;
  membership_no: string;
}

export interface ResolvedFirm {
  id: string;
  /** Display name (`display_name || name`). */
  name: string;
  /** Always the legal name from `firms.name`. */
  legalName: string;
  /** Firm Registration Number (ICAI). */
  frn: string | null;
  state: string | null;
  address: { line?: string; city?: string } | null;
  membershipNumbers: MembershipEntry[];
  isAuditFirm: boolean;
}

export async function resolveEngagementFirm(
  engagementId: string,
): Promise<ResolvedFirm | null> {
  if (!engagementId) return null;
  const { data: eng } = await supabase
    .from("audit_engagements")
    .select("firm_id")
    .eq("id", engagementId)
    .maybeSingle();
  if (!eng?.firm_id) return null;
  return resolveFirmById(eng.firm_id);
}

export async function resolveFirmById(
  firmId: string,
): Promise<ResolvedFirm | null> {
  if (!firmId) return null;
  const { data: firm } = await supabase
    .from("firms")
    .select(
      "id, name, display_name, icai_firm_reg_no, state, address, membership_numbers, is_audit_firm",
    )
    .eq("id", firmId)
    .maybeSingle();
  if (!firm) return null;
  const f: any = firm;
  return {
    id: f.id,
    legalName: f.name,
    name: f.display_name || f.name,
    frn: f.icai_firm_reg_no ?? null,
    state: f.state ?? null,
    address: f.address ?? null,
    membershipNumbers: Array.isArray(f.membership_numbers)
      ? (f.membership_numbers as MembershipEntry[])
      : [],
    isAuditFirm: !!f.is_audit_firm,
  };
}

/**
 * Look up the membership number for a given partner name within a firm's
 * partner roster. Returns a blank-line placeholder when not found so call
 * sites can render the slot without crashing.
 */
export function resolvePartnerMembership(
  firm: ResolvedFirm | null,
  partnerName: string | null | undefined,
): string {
  if (!firm || !partnerName) return "____________";
  const norm = (s: string) => (s || "").trim().toLowerCase();
  const target = norm(partnerName);
  const hit = firm.membershipNumbers.find(
    (m) => norm(m.partner_name) === target,
  );
  return hit?.membership_no || "____________";
}
