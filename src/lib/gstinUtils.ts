const GSTIN_STATE_CODES: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab",
  "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana", "07": "Delhi",
  "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
  "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram",
  "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
  "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
  "24": "Gujarat", "25": "Daman & Diu", "26": "Dadra & Nagar Haveli",
  "27": "Maharashtra", "28": "Andhra Pradesh (Old)", "29": "Karnataka", "30": "Goa",
  "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
  "35": "Andaman & Nicobar", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
};

export function detectStateFromGstin(gstin: string): string {
  if (!gstin || gstin.length < 2) return "";
  return GSTIN_STATE_CODES[gstin.substring(0, 2)] ?? "";
}

/**
 * Build the full list of {gstin, state} pairs for a client, merging
 * gstin_states (the saved map) with the raw gstin array (which may contain
 * GSTINs that were never assigned a state in gstin_states).
 */
export function buildClientGstins(
  gstinStates: Record<string, string> | null | undefined,
  gstinArray: string[] | null | undefined,
): { gstin: string; state: string }[] {
  const result: { gstin: string; state: string }[] = [];
  const seen = new Set<string>();

  // First: GSTINs that have an explicit state saved
  if (gstinStates && typeof gstinStates === "object") {
    for (const [gstin, state] of Object.entries(gstinStates)) {
      if (gstin && state) {
        result.push({ gstin, state });
        seen.add(gstin);
      }
    }
  }

  // Second: GSTINs from the array that are missing from gstin_states
  if (Array.isArray(gstinArray)) {
    for (const gstin of gstinArray) {
      if (!gstin || seen.has(gstin)) continue;
      const state = detectStateFromGstin(gstin);
      result.push({ gstin, state: state || gstin });
      seen.add(gstin);
    }
  }

  return result;
}
