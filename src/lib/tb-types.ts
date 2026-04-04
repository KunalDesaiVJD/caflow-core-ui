// ─────────────────────────────────────────────────────────────────────────────
// CAFlow — TB Import Type System (Refactor)
// N.5 — TypeScript interfaces for the refactored Tally XML TB import pipeline
//
// Design principles:
//   1. Raw rows are immutable — they come from XML/Excel and are never changed.
//   2. Resolved rows carry hierarchy path, sign-corrected values, section label.
//   3. Manual overrides are keyed by (engagement_id, normalized_name) so they
//      survive re-imports and schema changes without losing user corrections.
//   4. AI suggestions are advisory only — the UI shows them; only Accept/Reject
//      makes them permanent.
//   5. Validation issues are per-import — never mutated after creation.
// ─────────────────────────────────────────────────────────────────────────────

// ── Source discriminator ──────────────────────────────────────────────────────
/**
 * How the TB was uploaded.
 *   "xml"   → Tally XML export (has DSPACCNAMELEVEL / DSPACCACCISLEAF hints)
 *   "excel" → Tally Excel/XLS export (no explicit level hints; needs heuristics)
 */
export type TbImportSource = "xml" | "excel";

// ── Constitution types ────────────────────────────────────────────────────────
/**
 * Indian entity constitution type.
 * Drives which primary-group vocabulary is expected and which BS sections appear.
 */
export type TbConstitutionType =
  | "proprietorship"
  | "partnership"
  | "llp"
  | "private_limited"
  | "public_limited"
  | "huf"
  | "trust"
  | "jv"
  | "unknown";

// ── Raw row — direct from XML/Excel, never mutated ───────────────────────────
/**
 * One row exactly as it appears in the source file.
 * For Tally XML exports the xmlLevel / xmlIsLeaf / xmlParentName fields are
 * populated from the DSPACCNAMELEVEL, DSPACCACCISLEAF and parent-context
 * tags inside each DSPACCNAME block.
 * For Excel exports they are null — hierarchy must be reconstructed heuristically.
 */
export interface TbRawRow {
  /** Stable surrogate key assigned at import time (UUID). */
  rowId: string;

  /** FK to tb_import_rows_raw.import_id */
  importId: string;

  /** FK to audit_engagements */
  engagementId: string;

  /** Sequential row position in source (1-based). Needed for heuristic matching. */
  rowNumber: number;

  // ── Source values ───────────────────────────────────────────────────────────
  /** Raw account / group name as it appears in the source, no normalisation. */
  rawName: string;

  opening: number;
  txnDebit: number;
  txnCredit: number;
  closing: number;

  // ── Tally XML hints (null for Excel imports) ────────────────────────────────
  /**
   * DSPACCNAMELEVEL — explicit indentation level from Tally XML.
   * 1 = top-level group, 2 = sub-group, 3+ = leaf or deeper sub-group.
   * When non-null, hierarchy reconstruction uses this instead of sum-matching.
   */
  xmlLevel: number | null;

  /**
   * DSPACCACCISLEAF — Tally's own "is this a ledger?" flag.
   * true  → ledger (leaf node in our tree)
   * false → group or sub-group (non-leaf)
   * null  → not present (Excel import or very old Tally version)
   */
  xmlIsLeaf: boolean | null;

  /**
   * DSPDISPNAME / parent name extracted from surrounding context in XML.
   * When non-null, we use it directly as the parent node name (exact-match join).
   */
  xmlParentName: string | null;

  // ── Excel hints (null for XML imports) ─────────────────────────────────────
  /**
   * Indentation level inferred from leading spaces in the cell text.
   * Used only for Excel imports as a fallback.
   */
  excelIndentLevel: number | null;

  /** Whether the cell was bold-formatted in the Excel worksheet. */
  excelIsBold: boolean | null;

  // ── Metadata ────────────────────────────────────────────────────────────────
  importSource: TbImportSource;
  createdAt: string; // ISO timestamp
}

// ── Resolved row — hierarchy-resolved, sign-corrected, section-labelled ──────
/**
 * A TbRawRow after the hierarchy resolver, sign-corrector and classifier
 * have processed it.  This is what gets stored in tb_import_rows_resolved
 * and what the frontend works with.
 */
export interface TbResolvedRow {
  rowId: string;       // same UUID as TbRawRow.rowId
  importId: string;
  engagementId: string;
  rowNumber: number;

  // ── Identity ────────────────────────────────────────────────────────────────
  /** Normalised name used as a stable join key (lower-case, ASCII, no punctuation). */
  normalizedName: string;

  /** Display name (original with proper capitalisation). */
  name: string;

  // ── Hierarchy ───────────────────────────────────────────────────────────────
  nodeId: string;
  parentNodeId: string | null;
  level: number;
  isLeaf: boolean;

  /**
   * Materialized ancestry path, e.g. "Fixed Assets > Furniture & Fixtures".
   * Used for display breadcrumbs and for AI suggestion context.
   */
  hierarchyPath: string;

  /**
   * How confident we are in this node's hierarchy placement.
   * 1.0 = explicit XML level + isLeaf flags matched; 0.0 = pure guess.
   */
  hierarchyConfidence: number;

  /**
   * Which strategy resolved this node's position in the tree.
   *   "xml_explicit"  → used xmlLevel + xmlIsLeaf
   *   "xml_parent"    → used xmlParentName direct join
   *   "excel_bold"    → used bold+indent hint from Excel
   *   "sum_match"     → numeric sum matched a parent
   *   "keyword"       → name keyword classified this as group/leaf
   *   "orphan_repair" → placed by repair pass, low confidence
   */
  resolutionStrategy:
    | "xml_explicit"
    | "xml_parent"
    | "excel_bold"
    | "sum_match"
    | "keyword"
    | "orphan_repair";

  // ── Classification ──────────────────────────────────────────────────────────
  primaryGroup: string;
  section: TbSectionType;
  normalBal: "Dr" | "Cr" | "Unknown";
  bsPlSide: "BS" | "PL" | "Unknown";

  // ── Sign-corrected values ───────────────────────────────────────────────────
  /**
   * Values AFTER Tally XML sign convention inversion.
   * Rule: Dr-normal accounts are stored NEGATIVE in Tally XML.
   *   opening/closing > 0  → genuine credit balance (shown as negative in Assets/Expenses)
   *   opening/closing < 0  → normal debit balance (shown as positive in Assets/Expenses)
   * After correction: positive = normal balance, negative = contra balance.
   */
  opening: number;
  txnDebit: number;
  txnCredit: number;
  closing: number;

  // ── Override state ──────────────────────────────────────────────────────────
  /**
   * Whether a manual override is active for this row.
   * When true, the overridden fields come from TbManualOverride, not from
   * the parsed values above.
   */
  hasOverride: boolean;

  /**
   * Whether an AI suggestion exists for this row that has not yet been
   * accepted or rejected by the user.
   */
  hasPendingAiSuggestion: boolean;

  createdAt: string;
}

// Re-export so downstream code imports from one place
export type TbSectionType = "bs_asset" | "bs_liability" | "pl_income" | "pl_expense" | "unknown";

// ── Manual override — persistent user correction ──────────────────────────────
/**
 * A user correction that overwrites the parser's output for a specific ledger.
 * Keyed by (engagementId, normalizedName) so it survives re-imports.
 *
 * Only the fields listed in `overrideFields` are applied; the rest come from
 * the resolved row.
 */
export interface TbManualOverride {
  overrideId: string;
  engagementId: string;

  /** Normalised ledger name — join key. */
  normalizedName: string;

  /** Human-readable ledger name for UI display. */
  displayName: string;

  // ── Overridable fields ──────────────────────────────────────────────────────
  /** Override the section assignment. */
  section?: TbSectionType;

  /** Override the normal-balance classification. */
  normalBal?: "Dr" | "Cr";

  /** Override the parent node assignment (by normalizedName of the parent). */
  parentNormalizedName?: string | null;

  /** Override the isLeaf flag. */
  isLeaf?: boolean;

  /**
   * Explicit set of fields this override touches.
   * Only listed fields are applied; unlisted fields come from parser output.
   */
  overrideFields: Array<
    "section" | "normalBal" | "parentNormalizedName" | "isLeaf"
  >;

  // ── Lock ─────────────────────────────────────────────────────────────────────
  /**
   * When true, re-import will NEVER overwrite this override — even if Tally
   * data changes.  Unlocked overrides are re-evaluated on each import and may
   * be superseded if the parser now produces the same output.
   */
  locked: boolean;

  // ── Audit trail ─────────────────────────────────────────────────────────────
  createdBy: string;   // user UUID
  createdAt: string;
  updatedAt: string;
  note?: string;       // optional user comment
}

// ── AI suggestion — advisory only ────────────────────────────────────────────
/**
 * One AI-generated suggestion for a single ledger.
 * Suggestions are advisory: they are shown in the review UI and become
 * active only when the user clicks Accept.
 *
 * An accepted suggestion creates or updates a TbManualOverride.
 */
export interface TbAiSuggestion {
  suggestionId: string;
  importId: string;
  engagementId: string;

  /** Normalised ledger name — join key. */
  normalizedName: string;

  // ── What the AI proposed ───────────────────────────────────────────────────
  suggestedSection?: TbSectionType;
  suggestedNormalBal?: "Dr" | "Cr";
  suggestedParentNormalizedName?: string | null;
  suggestedIsLeaf?: boolean;

  /** Plain-English explanation of why the AI made this suggestion. */
  rationale: string;

  /** Confidence score from the AI model (0–1). */
  confidence: number;

  // ── Status lifecycle ────────────────────────────────────────────────────────
  /**
   * "pending"    → shown to user, no action taken
   * "accepted"   → user clicked Accept; a TbManualOverride was created/updated
   * "rejected"   → user clicked Reject; override NOT created
   * "superseded" → a new import or manual override made this suggestion stale
   * "auto_applied" → confidence >= threshold, applied without user confirmation
   */
  status: "pending" | "accepted" | "rejected" | "superseded" | "auto_applied";

  /** If accepted, the resulting override ID. */
  resultingOverrideId?: string;

  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;  // user UUID or "auto"
}

// ── Validation issue — per-import finding ────────────────────────────────────
/**
 * One issue found by the validation engine for a specific import.
 * Issues are immutable once created.  Re-importing produces a fresh set.
 */
export interface TbValidationIssue {
  issueId: string;
  importId: string;
  engagementId: string;

  /**
   * Machine-readable issue code.
   * Prefix convention:
   *   BAL_  → balance sheet / P&L balance errors
   *   HIER_ → hierarchy structural errors
   *   SIGN_ → sign convention errors
   *   CLAS_ → classification errors
   *   DUPE_ → duplicate name errors
   *   ORPH_ → orphaned node errors
   *   CONF_ → constitution profile mismatches
   */
  issueCode: string;

  /** "error" blocks publish; "warning" shows banner; "info" is informational. */
  severity: "error" | "warning" | "info";

  /** Human-readable description of the issue. */
  message: string;

  /**
   * Node(s) involved in the issue.
   * Empty array = issue applies to the whole import.
   */
  affectedNodeIds: string[];

  /** Suggested fix (shown in the review UI). */
  suggestedFix?: string;

  createdAt: string;
}

// ── Constitution profile — one per engagement ─────────────────────────────────
/**
 * The detected constitution type for an engagement.
 * Stored per-engagement so re-import does not lose the detection result.
 */
export interface TbConstitutionProfile {
  profileId: string;
  engagementId: string;

  constitutionType: TbConstitutionType;

  /**
   * How was the constitution type determined?
   *   "client_record"   → taken from clients.entity_type in the database
   *   "xml_vocab"       → inferred from primary-group names in the XML
   *   "ai_detected"     → AI model detected it from the ledger structure
   *   "manual"          → user selected it manually in the UI
   */
  detectionMethod: "client_record" | "xml_vocab" | "ai_detected" | "manual";

  /** Confidence 0–1 (always 1.0 for "client_record" and "manual"). */
  confidence: number;

  /**
   * Primary group names that were present in the import that drove the detection.
   * E.g. ["Partners' Capital", "Partners' Current Account"] for partnership.
   */
  detectionEvidence: string[];

  createdAt: string;
  updatedAt: string;
}

// ── Publish snapshot — final published TB ─────────────────────────────────────
/**
 * A point-in-time snapshot of the TB hierarchy that has passed validation
 * and been published for downstream audit use (financial statements, working
 * papers, etc.).
 *
 * Snapshots are immutable.  A new import creates a new snapshot if published.
 */
export interface TbPublishSnapshot {
  snapshotId: string;
  engagementId: string;
  importId: string;

  /** ISO date of the snapshot (matches financial year end or interim date). */
  asOfDate: string;

  /**
   * JSON copy of TbResolvedRow[] at the time of publish, with all overrides applied.
   * Stored in full so the snapshot can be rendered without re-querying rows.
   */
  resolvedRows: TbResolvedRow[];

  /**
   * Validation summary at time of publish.
   * errorCount > 0 should be impossible (publish is gated on zero errors).
   */
  validationSummary: {
    errorCount: number;
    warningCount: number;
    infoCount: number;
    isBalanced: boolean;
    bsAssets: number;
    bsLiabilities: number;
    plSurplus: number;
  };

  publishedBy: string;   // user UUID
  publishedAt: string;
}

// ── Hierarchy resolution result — output of the resolver ─────────────────────
/**
 * Returned by `resolveHierarchy()` in the refactored backend.
 */
export interface TbHierarchyResolutionResult {
  nodes: TbResolvedRow[];

  /** Overall confidence in the hierarchy.  1.0 = all nodes resolved from XML hints. */
  overallConfidence: number;

  /**
   * Breakdown of nodes resolved by each strategy.
   * Keys are TbResolvedRow.resolutionStrategy values.
   */
  strategyBreakdown: Record<string, number>;

  /**
   * List of normalizedNames where the resolver was uncertain.
   * These are candidates for AI review.
   */
  uncertainNodes: string[];

  /**
   * Orphaned nodes that could not be placed in the tree.
   * These are validation errors.
   */
  orphanedNodes: string[];
}

// ── Import metadata ───────────────────────────────────────────────────────────
/**
 * Top-level import record (one per file upload).
 */
export interface TbImportRecord {
  importId: string;
  engagementId: string;
  importSource: TbImportSource;

  /** Original file name. */
  fileName: string;

  /** Financial year label, e.g. "2024-25". */
  financialYear: string;

  /**
   * Current status of the import pipeline.
   *   "raw"       → raw rows stored, resolution not yet run
   *   "resolved"  → hierarchy resolved, validation run
   *   "review"    → awaiting user review of warnings / AI suggestions
   *   "published" → validation passed, snapshot created
   *   "failed"    → unrecoverable error during parse or resolution
   */
  status: "raw" | "resolved" | "review" | "published" | "failed";

  /** Error message if status === "failed". */
  errorMessage?: string;

  rawRowCount: number;
  resolvedRowCount: number;
  leafCount: number;
  groupCount: number;

  constitutionType?: TbConstitutionType;

  createdBy: string;
  createdAt: string;
  publishedAt?: string;
}
