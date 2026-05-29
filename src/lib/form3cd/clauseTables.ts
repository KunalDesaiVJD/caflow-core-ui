/**
 * clauseTables — enumerate the editable data tables inside any clause.
 *
 * A single clause can hold several tables (composite clauses like 21, 26, 31,
 * 34 nest tables inside sub-clauses). This walks the ClauseDefinition tree and
 * returns a flat list of tables, each with the dot-path into the clause's data
 * object where its `_rows` live. Used by both the Excel round-trip and the
 * "insert ledgers as rows" feature so they share one source of truth.
 */

import type { ClauseDefinition, SubClause, AnnexureColumn } from "@/data/form3cd-master";
import { getAtPath, setAtPath } from "@/lib/notesAutoPopulate";

export interface ClauseTable {
  /** unique id within the clause (the dot-path, or "_root") */
  id: string;
  label: string;
  columns: AnnexureColumn[];
  /** dot-path to the container object that holds `_rows` ("" = clause root) */
  path: string;
  rows: Record<string, any>[];
}

const TABLE_CONTROLS = new Set([
  "not_applicable_annexure",
  "structured_table",
  "note_reference",
]);

function rowsAt(value: any, path: string): Record<string, any>[] {
  const container = path ? getAtPath(value, path) : value;
  const r = container?._rows;
  return Array.isArray(r) ? r : [];
}

function walk(
  node: ClauseDefinition | SubClause,
  path: string,
  value: any,
  out: ClauseTable[],
): void {
  if (Array.isArray((node as any).annexureColumns) && TABLE_CONTROLS.has(node.control)) {
    out.push({
      id: path || "_root",
      label: node.heading || ("title" in node ? (node as ClauseDefinition).title : node.key) || "Table",
      columns: (node as any).annexureColumns as AnnexureColumn[],
      path,
      rows: rowsAt(value, path),
    });
  }
  const subs = (node as any).subClauses as SubClause[] | undefined;
  if (Array.isArray(subs)) {
    for (const sub of subs) {
      const childPath = path ? `${path}.${sub.key}` : sub.key;
      walk(sub, childPath, value, out);
    }
  }
}

/** All editable tables inside a clause, with their current rows. */
export function collectClauseTables(definition: ClauseDefinition, value: any): ClauseTable[] {
  const out: ClauseTable[] = [];
  walk(definition, "", value || {}, out);
  return out;
}

/** Immutably set the `_rows` array for a given table path within clause data. */
export function setTableRows(value: any, path: string, rows: Record<string, any>[]): Record<string, any> {
  const clone = JSON.parse(JSON.stringify(value || {}));
  setAtPath(clone, path ? `${path}._rows` : "_rows", rows);
  // Tables live behind an "As Per Annexure" toggle for not_applicable_annexure
  // clauses — make sure data we write is actually shown.
  if (!path) {
    clone._asPerAnnexure = true;
    clone._notApplicable = false;
  } else {
    const container = getAtPath(clone, path);
    if (container && typeof container === "object") {
      container._asPerAnnexure = true;
      container._notApplicable = false;
    }
  }
  return clone;
}
