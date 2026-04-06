// ─────────────────────────────────────────────────────────────────────────────
// CAFlow — TB Manual Override Panel (N.9 UI)
//
// Lets the user:
//   1. Search for a ledger by name
//   2. See its current classification (section, normalBal, parent)
//   3. Change its section via dropdown
//   4. Reassign its parent (by typing the parent name)
//   5. Lock/unlock the override
//   6. Delete the override
//
// Saves immediately on change (no Save button needed).
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useCallback } from "react";
import { Search, Lock, Unlock, Trash2, AlertCircle, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  saveOverride,
  deleteOverride,
  toggleOverrideLock,
  buildSectionOverride,
  buildParentOverride,
} from "@/lib/tb-override-service";
import type { TbManualOverride, TbResolvedRow, TbSectionType } from "@/lib/tb-types";

// ── Types ─────────────────────────────────────────────────────────────────────
interface TbOverridePanelProps {
  /** All resolved nodes for the current import */
  nodes: TbResolvedRow[];
  /** Existing overrides (normalized_name → TbManualOverride) */
  overrides: Map<string, TbManualOverride>;
  userId: string;
  onOverrideChanged?: () => void;
}

// ── Section options ───────────────────────────────────────────────────────────
const SECTION_OPTIONS: Array<{ value: TbSectionType; label: string }> = [
  { value: "bs_asset",     label: "BS — Asset (Dr normal)" },
  { value: "bs_liability", label: "BS — Liability (Cr normal)" },
  { value: "pl_income",    label: "P&L — Income (Cr normal)" },
  { value: "pl_expense",   label: "P&L — Expense (Dr normal)" },
  { value: "unknown",      label: "Unclassified" },
];

const SECTION_BADGE: Record<TbSectionType, string> = {
  bs_asset:     "bg-blue-100 text-blue-800 border-blue-200",
  bs_liability: "bg-purple-100 text-purple-800 border-purple-200",
  pl_income:    "bg-green-100 text-green-800 border-green-200",
  pl_expense:   "bg-orange-100 text-orange-800 border-orange-200",
  unknown:      "bg-gray-100 text-gray-600 border-gray-200",
};

// ── Component ─────────────────────────────────────────────────────────────────
export function TbOverridePanel({
  nodes,
  overrides: initialOverrides,
  userId,
  onOverrideChanged,
}: TbOverridePanelProps) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [localOverrides, setLocalOverrides] = useState<Map<string, TbManualOverride>>(
    new Map(initialOverrides)
  );
  const [editingParent, setEditingParent] = useState<string | null>(null);
  const [parentInput, setParentInput] = useState("");

  // Filter nodes to leaves with unknown section or existing overrides
  const relevantNodes = nodes.filter(
    n => n.section === "unknown" || localOverrides.has(n.normalizedName)
  );
  const filteredNodes = search.trim()
    ? relevantNodes.filter(n =>
        n.name.toLowerCase().includes(search.toLowerCase()) ||
        n.normalizedName.includes(search.toLowerCase())
      )
    : relevantNodes;

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleSectionChange = useCallback(async (node: TbResolvedRow, newSection: TbSectionType) => {
    const override = buildSectionOverride(node, newSection, userId);
    try {
      await saveOverride(override);
      setLocalOverrides(prev => new Map(prev).set(override.normalizedName, override));
      toast({ title: "Override saved", description: `"${node.name}" → ${newSection}` });
      onOverrideChanged?.();
    } catch (err) {
      toast({ title: "Error saving override", description: String(err), variant: "destructive" });
    }
  }, [userId, toast, onOverrideChanged]);

  const handleParentSave = useCallback(async (node: TbResolvedRow) => {
    const parentNorm = parentInput.trim().toLowerCase() || null;
    const override = buildParentOverride(node, parentNorm, userId);
    try {
      await saveOverride(override);
      setLocalOverrides(prev => new Map(prev).set(override.normalizedName, override));
      setEditingParent(null);
      setParentInput("");
      toast({ title: "Parent reassigned", description: `"${node.name}" → "${parentInput || "(root)"}"` });
      onOverrideChanged?.();
    } catch (err) {
      toast({ title: "Error saving parent", description: String(err), variant: "destructive" });
    }
  }, [parentInput, userId, toast, onOverrideChanged]);

  const handleToggleLock = useCallback(async (override: TbManualOverride) => {
    const newLocked = !override.locked;
    try {
      await toggleOverrideLock(override.overrideId, newLocked);
      setLocalOverrides(prev => {
        const updated = new Map(prev);
        updated.set(override.normalizedName, { ...override, locked: newLocked });
        return updated;
      });
      toast({
        title: newLocked ? "Override locked" : "Override unlocked",
        description: newLocked
          ? "This override will persist through re-imports."
          : "This override may be superseded on next import.",
      });
    } catch (err) {
      toast({ title: "Error", description: String(err), variant: "destructive" });
    }
  }, [toast]);

  const handleDelete = useCallback(async (override: TbManualOverride) => {
    try {
      await deleteOverride(override.overrideId);
      setLocalOverrides(prev => {
        const updated = new Map(prev);
        updated.delete(override.normalizedName);
        return updated;
      });
      toast({ title: "Override deleted", description: `Override for "${override.displayName}" removed.` });
      onOverrideChanged?.();
    } catch (err) {
      toast({ title: "Error", description: String(err), variant: "destructive" });
    }
  }, [toast, onOverrideChanged]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          Manual Classification Overrides
          {localOverrides.size > 0 && (
            <Badge variant="secondary">{localOverrides.size} active</Badge>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Assign a section to unclassified ledgers. Overrides survive re-imports.
          Lock an override to prevent it from being overwritten.
        </p>

        {/* Search */}
        <div className="relative mt-2">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search ledger name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {filteredNodes.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {search ? "No matching ledgers found." : "No unclassified ledgers. All ledgers have been classified."}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="text-xs">
                <TableHead className="pl-4">Ledger</TableHead>
                <TableHead>Hierarchy Path</TableHead>
                <TableHead>Section</TableHead>
                <TableHead>Parent Override</TableHead>
                <TableHead className="text-right pr-4">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredNodes.map(node => {
                const override = localOverrides.get(node.normalizedName);
                const effectiveSection = override?.section ?? node.section;

                return (
                  <TableRow key={node.nodeId} className="text-xs align-top">
                    {/* Name */}
                    <TableCell className="pl-4 font-medium max-w-[160px]">
                      <div className="truncate">{node.name}</div>
                      {override?.locked && (
                        <div className="flex items-center gap-1 text-amber-600 mt-0.5">
                          <Lock className="h-2.5 w-2.5" /> <span className="text-[10px]">locked</span>
                        </div>
                      )}
                    </TableCell>

                    {/* Path */}
                    <TableCell className="max-w-[200px]">
                      <div className="truncate text-muted-foreground">{node.hierarchyPath}</div>
                    </TableCell>

                    {/* Section dropdown */}
                    <TableCell>
                      <Select
                        value={effectiveSection}
                        onValueChange={(val) => handleSectionChange(node, val as TbSectionType)}
                        disabled={override?.locked}
                      >
                        <SelectTrigger className={`h-6 text-xs w-36 ${SECTION_BADGE[effectiveSection]} border`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SECTION_OPTIONS.map(opt => (
                            <SelectItem key={opt.value} value={opt.value} className="text-xs">
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>

                    {/* Parent override */}
                    <TableCell>
                      {editingParent === node.normalizedName ? (
                        <div className="flex items-center gap-1">
                          <Input
                            value={parentInput}
                            onChange={e => setParentInput(e.target.value)}
                            placeholder="Parent ledger name…"
                            className="h-6 text-xs w-36"
                            autoFocus
                            onKeyDown={e => {
                              if (e.key === "Enter") handleParentSave(node);
                              if (e.key === "Escape") { setEditingParent(null); setParentInput(""); }
                            }}
                          />
                          <Button
                            size="sm"
                            className="h-6 text-xs px-2"
                            onClick={() => handleParentSave(node)}
                          >
                            Set
                          </Button>
                        </div>
                      ) : (
                        <button
                          className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                          onClick={() => {
                            setEditingParent(node.normalizedName);
                            setParentInput(override?.parentNormalizedName ?? "");
                          }}
                          disabled={override?.locked}
                        >
                          {override?.parentNormalizedName
                            ? <span className="text-green-700">↳ {override.parentNormalizedName}</span>
                            : <span className="text-muted-foreground">Set parent…</span>
                          }
                        </button>
                      )}
                    </TableCell>

                    {/* Actions */}
                    <TableCell className="text-right pr-4">
                      <div className="flex items-center justify-end gap-1">
                        {override && (
                          <>
                            {/* Lock toggle */}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0"
                              title={override.locked ? "Unlock override" : "Lock override"}
                              onClick={() => handleToggleLock(override)}
                            >
                              {override.locked
                                ? <Lock className="h-3 w-3 text-amber-600" />
                                : <Unlock className="h-3 w-3 text-gray-400" />
                              }
                            </Button>

                            {/* Delete */}
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 w-6 p-0 text-red-400 hover:text-red-600"
                                  title="Delete override"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete override?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This will remove the override for "{node.name}".
                                    On the next import, this ledger will be classified automatically again.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    className="bg-red-600 hover:bg-red-700"
                                    onClick={() => handleDelete(override)}
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
