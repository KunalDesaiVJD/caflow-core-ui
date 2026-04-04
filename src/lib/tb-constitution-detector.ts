// ─────────────────────────────────────────────────────────────────────────────
// CAFlow — TB Constitution Detector
// Detects the entity constitution type from primary group vocabulary present
// in the trial balance.  Used to:
//   1. Select the correct classification keywords at import time
//   2. Power CONF_001 validation rule
//   3. Drive the constitution-specific display model in the frontend
// ─────────────────────────────────────────────────────────────────────────────

import type { TbConstitutionType } from "./tb-types";
import { normalizeName } from "./tb-hierarchy-resolver";

// ── Vocabulary fingerprints per constitution type ─────────────────────────────
// Each fingerprint is a list of terms. The first match wins at the highest score.
const CONSTITUTION_VOCAB: Array<{
  type: TbConstitutionType;
  /** Terms that MUST be present (all required) */
  required: string[][];
  /** Terms that SHOULD be present (each adds score) */
  supporting: string[];
  /** Terms that CANNOT be present (veto) */
  vetoed?: string[];
}> = [
  {
    type: "private_limited",
    required: [
      ["share capital", "equity share capital"],
    ],
    supporting: [
      "reserves and surplus", "reserves & surplus",
      "share application money", "preference share capital",
      "long term borrowings", "short term borrowings",
      "trade payables", "other current liabilities",
      "revenue from operations",
    ],
    vetoed: ["partners capital", "partner capital", "designated partners capital", "corpus fund"],
  },
  {
    type: "public_limited",
    required: [
      ["equity share capital"],
      ["debentures", "share capital"],
    ],
    supporting: [
      "reserves and surplus", "debentures",
      "long term borrowings", "revenue from operations",
    ],
    vetoed: ["partners capital", "corpus fund"],
  },
  {
    type: "llp",
    required: [
      ["designated partners capital", "designated partner capital"],
    ],
    supporting: [
      "partners current account", "contribution",
    ],
    vetoed: ["share capital", "corpus fund"],
  },
  {
    type: "partnership",
    required: [
      ["partners capital account", "partner capital account", "partners capital"],
    ],
    supporting: [
      "partners current account", "partner current account",
      "partner remuneration", "interest on capital",
      "partner payout", "remuneration to partner",
    ],
    vetoed: ["share capital", "designated partners capital", "corpus fund"],
  },
  {
    type: "trust",
    required: [
      ["corpus fund"],
    ],
    supporting: [
      "endowment fund", "designated funds",
      "income and expenditure", "income & expenditure",
      "grant received", "donation received",
    ],
    vetoed: ["share capital", "partners capital"],
  },
  {
    type: "huf",
    required: [
      ["huf", "hindu undivided"],
    ],
    supporting: [
      "coparcener", "co-parcener", "karta",
    ],
    vetoed: ["share capital", "corpus fund"],
  },
  {
    type: "proprietorship",
    required: [
      ["capital account"],
    ],
    supporting: [
      "proprietor capital", "drawings", "owner capital",
    ],
    vetoed: [
      "share capital", "partners capital", "designated partners capital",
      "corpus fund", "partners current account",
    ],
  },
];

// ── Detect from primary group names ───────────────────────────────────────────
export interface ConstitutionDetectionResult {
  constitutionType: TbConstitutionType;
  confidence: number;
  evidence: string[];
  detectionMethod: "xml_vocab" | "client_record" | "manual";
}

/**
 * Detect constitution type from the list of primary group names present in
 * the trial balance.
 *
 * @param primaryGroupNames - list of root/primary group names from the import
 * @param clientEntityType  - entity type from the clients table (optional override)
 */
export function detectConstitution(
  primaryGroupNames: string[],
  clientEntityType?: string | null,
): ConstitutionDetectionResult {
  // If the client record has a definitive entity type, use it
  if (clientEntityType) {
    const mapped = mapEntityTypeToConstitution(clientEntityType);
    if (mapped !== "unknown") {
      return {
        constitutionType: mapped,
        confidence: 1.0,
        evidence: [`Client entity type: "${clientEntityType}"`],
        detectionMethod: "client_record",
      };
    }
  }

  const normalized = primaryGroupNames.map(normalizeName);

  let bestType: TbConstitutionType = "unknown";
  let bestScore = 0;
  const bestEvidence: string[] = [];

  for (const spec of CONSTITUTION_VOCAB) {
    // Check veto — if any vetoed term is present, skip this constitution
    if (spec.vetoed) {
      const vetoed = spec.vetoed.filter(v =>
        normalized.some(n => n.includes(normalizeName(v)))
      );
      if (vetoed.length > 0) continue;
    }

    // Check required groups (OR within each subarray, AND across subarrays)
    let allRequired = true;
    const matchedRequired: string[] = [];
    for (const alternatives of spec.required) {
      const match = alternatives.find(alt =>
        normalized.some(n => n.includes(normalizeName(alt)))
      );
      if (!match) { allRequired = false; break; }
      matchedRequired.push(match);
    }
    if (!allRequired) continue;

    // Score supporting terms
    let score = 1.0; // base for meeting required terms
    const matchedSupporting: string[] = [];
    for (const sup of spec.supporting) {
      if (normalized.some(n => n.includes(normalizeName(sup)))) {
        score += 0.1;
        matchedSupporting.push(sup);
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestType = spec.type;
      bestEvidence.length = 0;
      bestEvidence.push(...matchedRequired, ...matchedSupporting);
    }
  }

  const confidence = bestType === "unknown" ? 0 : Math.min(0.99, bestScore / 2);
  return {
    constitutionType: bestType,
    confidence,
    evidence: bestEvidence,
    detectionMethod: "xml_vocab",
  };
}

// ── Map clients.entity_type to TbConstitutionType ─────────────────────────────
function mapEntityTypeToConstitution(entityType: string): TbConstitutionType {
  const lower = entityType.toLowerCase().replace(/[^a-z ]/g, " ").trim();
  if (lower.includes("private") || lower.includes("pvt") || lower.includes("limited liability company")) return "private_limited";
  if (lower.includes("public")) return "public_limited";
  if (lower.includes("llp") || lower.includes("limited liability partnership")) return "llp";
  if (lower.includes("partner")) return "partnership";
  if (lower.includes("trust") || lower.includes("ngo") || lower.includes("society")) return "trust";
  if (lower.includes("huf") || lower.includes("hindu")) return "huf";
  if (lower.includes("proprietor") || lower.includes("individual") || lower.includes("sole")) return "proprietorship";
  if (lower.includes("jv") || lower.includes("joint venture")) return "jv";
  return "unknown";
}
