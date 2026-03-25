// Form 3CD — Clause Definition Types
// This file defines the schema for data-driven clause rendering.
// To add/remove/reorder clauses, modify the FORM_3CD_CLAUSES array in form3cd-clauses.ts.

export type ControlType =
  | 'yes_no'                    // Simple Yes / No radio
  | 'yes_no_na'                 // Yes / No / NA radio
  | 'yes_no_notdue'             // Yes / No / Not Due (Cl.43)
  | 'not_applicable_annexure'   // Not Applicable checkbox + As Per Annexure checkbox
  | 'dropdown'                  // Single dropdown field
  | 'single_field'              // Single numeric/text field with Reset button
  | 'structured_table'          // Fixed-row structured table (Cl.27a, Cl.40)
  | 'matrix'                    // Matrix/Annexure-6 style (Cl.34a)
  | 'note_reference'            // Note reference + optional annexure (Cl.9a)
  | 'composite'                 // Composite — uses subClauses with mixed controls
  | 'same_as_checkbox';         // Same as X checkbox + free text (Cl.11b, 11c)

export interface DropdownOption { value: string; label: string; }

export interface AnnexureColumn {
  key: string;
  label: string;
  type: 'text' | 'numeric' | 'date' | 'dropdown' | 'auto_calc' | 'yes_no_dropdown' | 'pan' | 'readonly';
  options?: DropdownOption[];
  dropdownRef?: string;         // reference to DROPDOWN_LIBRARY key
  formula?: string;             // e.g. 'col_a + col_b' for auto_calc
  mandatory?: boolean;
  conditionalOn?: string;       // show/require only when this column = specific value
  width?: number;               // relative width hint (in px)
  minWidth?: number;
}

export interface SubClause {
  key: string;                  // unique key e.g. 'cl_21_b_i_A'
  heading: string;              // exact official heading text
  control: ControlType;
  annexureColumns?: AnnexureColumn[];
  subClauses?: SubClause[];
  defaultValue?: string;        // e.g. 'Nil' for single_field
  dropdownRef?: string;         // reference to DROPDOWN_LIBRARY key
  dropdownOptions?: DropdownOption[];
  dependsOn?: string;           // key of parent that must be 'yes' to enable
  dependsOnValue?: any;         // specific value the parent must have (default: true)
  noAnnexure?: boolean;         // true = never show annexure
  showTotals?: boolean;         // show auto-sum totals row
  totalColumns?: string[];      // which column keys to sum
  placeholder?: string;
  fieldType?: 'text' | 'number' | 'textarea';
}

export interface ClauseDefinition {
  clauseNo: string;             // e.g. '8', '21', '30A'
  displayOrder: number;         // drives rendering sequence
  title: string;                // short title for sidebar nav
  heading: string;              // full official heading text
  isActive: boolean;            // false = clause removed from form
  control: ControlType;
  subClauses?: SubClause[];
  annexureColumns?: AnnexureColumn[];
  dropdownRef?: string;
  dropdownOptions?: DropdownOption[];
  defaultValue?: string;
  showTotals?: boolean;
  totalColumns?: string[];
  notes?: string;               // implementation notes
}

// Helper to convert clauseNo to a state key
export function clauseKey(clauseNo: string): string {
  return `cl_${clauseNo.replace(/[^a-zA-Z0-9]/g, '_')}`;
}
