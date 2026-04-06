// ─────────────────────────────────────────────────────────────────────────────
// CAFlow — TB Manual Override Service (N.9)
//
// Provides CRUD operations for TbManualOverride records.
// Overrides survive re-imports: every time the TB is re-imported, all locked
// and unlocked overrides are fetched and applied on top of the parser output.
//
// Override application rules:
//   1. An override is applied to a resolved node whose normalizedName matches.
//   2. Only the fields listed in override.overrideFields are applied.
//   3. Locked overrides always win (even if the parser now produces a different value).
//   4. Unlocked overrides are "unapplied" if the parser now produces the same value
//      as the override (reduces clutter in the override list).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from "@/integrations/supabase/client";
import type { TbManualOverride, TbResolvedRow, TbSectionType } from "./tb-types";

// ── Load all overrides for an engagement ─────────────────────────────────────
export async function loadOverrides(
  engagementId: string,
): Promise<Map<string, TbManualOverride>> {
  const { data, error } = await supabase
    .from("tb_manual_overrides")
    .select("*")
    .eq("engagement_id", engagementId);

  if (error) throw new Error(`Failed to load overrides: ${error.message}`);

  const map = new Map<string, TbManualOverride>();
  for (const row of data ?? []) {
    map.set(row.normalized_name, {
      overrideId: row.override_id,
      engagementId: row.engagement_id,
      normalizedName: row.normalized_name,
      displayName: row.display_name,
      section: row.section ?? undefined,
      normalBal: row.normal_bal ?? undefined,
      parentNormalizedName: row.parent_normalized_name ?? undefined,
      isLeaf: row.is_leaf ?? undefined,
      overrideFields: row.override_fields ?? [],
      locked: row.locked ?? false,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      note: row.note ?? undefined,
    });
  }
  return map;
}

// ── Save a single override ────────────────────────────────────────────────────
export async function saveOverride(
  override: TbManualOverride,
): Promise<void> {
  const { error } = await supabase
    .from("tb_manual_overrides")
    .upsert({
      override_id: override.overrideId,
      engagement_id: override.engagementId,
      normalized_name: override.normalizedName,
      display_name: override.displayName,
      section: override.section ?? null,
      normal_bal: override.normalBal ?? null,
      parent_normalized_name: override.parentNormalizedName ?? null,
      is_leaf: override.isLeaf ?? null,
      override_fields: override.overrideFields,
      locked: override.locked,
      created_by: override.createdBy,
      created_at: override.createdAt,
      updated_at: new Date().toISOString(),
      note: override.note ?? null,
    }, { onConflict: "override_id" });

  if (error) throw new Error(`Failed to save override: ${error.message}`);
}

// ── Delete a single override ──────────────────────────────────────────────────
export async function deleteOverride(overrideId: string): Promise<void> {
  const { error } = await supabase
    .from("tb_manual_overrides")
    .delete()
    .eq("override_id", overrideId);

  if (error) throw new Error(`Failed to delete override: ${error.message}`);
}

// ── Toggle lock on an override ────────────────────────────────────────────────
export async function toggleOverrideLock(
  overrideId: string,
  locked: boolean,
): Promise<void> {
  const { error } = await supabase
    .from("tb_manual_overrides")
    .update({ locked, updated_at: new Date().toISOString() })
    .eq("override_id", overrideId);

  if (error) throw new Error(`Failed to toggle override lock: ${error.message}`);
}

// ── Apply overrides to resolved rows ─────────────────────────────────────────
/**
 * Apply a map of overrides to a list of resolved rows.
 * Returns a new array — original nodes are not mutated.
 *
 * Also handles parent reassignment: if an override sets parentNormalizedName,
 * finds the matching node in the resolved list and updates parentNodeId.
 */
export function applyOverridesToNodes(
  nodes: TbResolvedRow[],
  overrides: Map<string, TbManualOverride>,
): TbResolvedRow[] {
  if (overrides.size === 0) return nodes;

  // Build normalizedName → nodeId lookup for parent reassignment
  const nameToNodeId = new Map<string, string>(
    nodes.map(n => [n.normalizedName, n.nodeId])
  );

  return nodes.map(node => {
    const override = overrides.get(node.normalizedName);
    if (!override) return node;

    const fields = new Set(override.overrideFields);
    const updated = { ...node, hasOverride: true };

    if (fields.has("section") && override.section !== undefined) {
      updated.section = override.section;
      // Also update normalBal to match section if not explicitly overriding normalBal
      if (!fields.has("normalBal")) {
        updated.normalBal = derivedNormalBal(override.section);
      }
    }

    if (fields.has("normalBal") && override.normalBal !== undefined) {
      updated.normalBal = override.normalBal;
    }

    if (fields.has("isLeaf") && override.isLeaf !== undefined) {
      updated.isLeaf = override.isLeaf;
    }

    if (fields.has("parentNormalizedName") && override.parentNormalizedName !== undefined) {
      const newParentNodeId = override.parentNormalizedName
        ? (nameToNodeId.get(override.parentNormalizedName) ?? node.parentNodeId)
        : null;
      updated.parentNodeId = newParentNodeId;
    }

    return updated;
  });
}

// ── Helper: default normalBal from section ───────────────────────────────────
function derivedNormalBal(section: TbSectionType): "Dr" | "Cr" | "Unknown" {
  if (section === "bs_asset" || section === "pl_expense") return "Dr";
  if (section === "bs_liability" || section === "pl_income") return "Cr";
  return "Unknown";
}

// ── Build a new override from a user drag-drop action ────────────────────────
/**
 * Creates a TbManualOverride from a user's drag-drop reassignment.
 * Called when the user moves a node to a different parent in the TbOverridePanel.
 */
export function buildParentOverride(
  node: TbResolvedRow,
  newParentNormalizedName: string | null,
  userId: string,
  note?: string,
): TbManualOverride {
  const now = new Date().toISOString();
  return {
    overrideId: `ov_${node.engagementId}_${node.normalizedName}`.slice(0, 100),
    engagementId: node.engagementId,
    normalizedName: node.normalizedName,
    displayName: node.name,
    parentNormalizedName: newParentNormalizedName,
    overrideFields: ["parentNormalizedName"],
    locked: false,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    note: note ?? `Parent manually reassigned to "${newParentNormalizedName ?? "(root)"}"`,
  };
}

/**
 * Creates a TbManualOverride from a section reassignment.
 * Called when the user selects a different section from the dropdown.
 */
export function buildSectionOverride(
  node: TbResolvedRow,
  newSection: TbSectionType,
  userId: string,
  note?: string,
): TbManualOverride {
  const now = new Date().toISOString();
  return {
    overrideId: `ov_${node.engagementId}_${node.normalizedName}`.slice(0, 100),
    engagementId: node.engagementId,
    normalizedName: node.normalizedName,
    displayName: node.name,
    section: newSection,
    normalBal: derivedNormalBal(newSection) === "Unknown" ? undefined : derivedNormalBal(newSection) as "Dr" | "Cr",
    overrideFields: ["section", "normalBal"],
    locked: false,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    note: note ?? `Section manually changed to "${newSection}"`,
  };
}
