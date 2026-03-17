

## Plan: Enhance Notes to Accounts + CARO Modules

This is a large restructuring effort touching pipeline stages 7 & 8, navigation labels, the Notes editor, CARO defaults, and a new master configuration system. Here's the precise plan.

---

### 1. Module Restructuring (Stage 7 & 8 reorganization)

**Current structure:**
- Stage 7: Tabs → "Notes to Accounts" | "Accounting Policies (Note 1 & 2)"
- Stage 8: Tabs → "CARO 2020" | "Form 3CD"

**Target structure:**
- Stage 7 renamed → **"Notes to Accounts/CARO"** with 3 tabs:
  - **Notes to Accounts** (merges current NotesToAccountsEditor + PipelineStage7's Accounting Policies into one unified view)
  - **CARO** (moves EngagementCARO from Stage 8 into here)
  - **Master Config** (new tab for master templates)
- Stage 8 renamed → **"3CD Reports"** (only Form 3CD remains)

**Files to change:**
- `src/pages/AuditPipeline.tsx` — lines ~47-48 (STAGES labels), lines ~802-873 (stage 7 & 8 rendering). Stage 7 gets 3 tabs; Stage 8 becomes just Form 3CD.
- `src/pages/AuditIntelligence.tsx` — lines ~44-45 (STAGES labels) to match.
- `src/components/AppSidebar.tsx` — lines ~38-39 rename labels.
- `src/pages/EngagementDetail.tsx` — update tab labels if used.

### 2. Note 1 — Overview Paragraph Fix

**In `src/pages/NotesToAccounts.tsx`:**
- Modify the Note 1 editor to render a **generated paragraph template**:
  > "{Company Name} incorporated under the Companies Act, 2013 vide CIN {CIN} having its registered office at {registered_office} and engaged in business of {business_activity}."
- Company Name → auto-fetched from engagement's client
- CIN → auto-fetched from `clients.cin` column
- Registered Office → editable field (saved to note_1 JSONB)
- Business Activity → editable field (saved to note_1 JSONB)
- The paragraph is assembled live and displayed as formatted text with inline editable spans

**DB change:** Add `registered_office` and `business_activity` columns to `clients` table if not present (registered_office missing, business_activity missing based on schema query).

### 3. Make Basis of Preparation / Measurement / Estimates Editable

**In `src/pages/NotesToAccounts.tsx`:**
- Currently `STANDARD_TEXTS` are hardcoded constants used in Note 2.
- Change them to be **editable textareas** initialized from STANDARD_TEXTS defaults but saved to `note_2` JSONB fields: `basis_of_preparation`, `basis_of_measurement`, `use_of_estimates`.

### 4. Dynamic Note Selection + Auto Numbering

**In `src/components/pipeline/PipelineStage7.tsx`** (which already has `is_selected` toggle and `note_templates`):
- Already has selection logic. Enhance with:
  - **Auto-renumbering**: selected notes get sequential display numbers (1, 2, 3...) regardless of original note_number
  - **Default pre-selection**: common notes pre-checked on first load
  - Persist selection per engagement (already done via `audit_notes.is_selected`)
- Also integrate into `NotesToAccounts.tsx` — the Note list sidebar should show dynamic numbering

### 5. CARO 2020 — Default Content from Uploaded Document

**In `src/components/engagement/EngagementCARO.tsx`:**
- Replace the empty seed with **pre-filled `auto_draft`** content from the uploaded CARO_CLAUSES.doc for all 21 clauses
- Map the parsed document content to each clause number
- Add a "Use Default" button that copies auto_draft → user_response
- All clauses remain fully editable
- The `is_applicable` toggle + lock mechanism already exists — keep it

**Hardcode the default content** as a constant `CARO_DEFAULT_CONTENT` mapped by clause number (extracted from the uploaded doc).

### 6. Master Configuration System

**New component: `src/components/pipeline/MasterConfigPanel.tsx`**

A tabbed config panel with 3 sections:
- **Notes Templates**: Edit `note_templates` table — change headings, default text for each note
- **CARO Templates**: Edit default clause content (stored in a new `caro_master_templates` table or reuse `note_templates` with a type discriminator)
- **3CD Clause Config**: Link to Form 3CD clause configuration

**New DB table: `caro_master_templates`**
```sql
CREATE TABLE caro_master_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid REFERENCES firms(id),
  clause_number integer NOT NULL,
  clause_title text,
  default_content text,
  is_applicable_default boolean DEFAULT true,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(firm_id, clause_number)
);
```

**New DB columns on `clients`:**
```sql
ALTER TABLE clients ADD COLUMN IF NOT EXISTS registered_office text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS business_activity text;
```

**Behavior:** When seeding CARO rows for a new engagement, check `caro_master_templates` for the firm first. If firm-level templates exist, use those as `auto_draft`. Otherwise fall back to the hardcoded defaults.

Similarly for Notes: when editing a `note_templates` row, changes propagate to future engagements automatically (existing engagements keep their saved content).

### 7. UI/UX Rules

- Reuse existing components: Card, Tabs, Accordion, Dialog, Textarea, Switch, Badge
- No redesign — only add tabs, fields, and selection logic
- Keep existing print/preview functionality intact

### Summary of Files Changed

| File | Change |
|---|---|
| `src/pages/AuditPipeline.tsx` | Rename stages 7/8, restructure tabs |
| `src/pages/AuditIntelligence.tsx` | Rename stage labels |
| `src/components/AppSidebar.tsx` | Rename nav labels |
| `src/pages/EngagementDetail.tsx` | Update tab names |
| `src/pages/NotesToAccounts.tsx` | Note 1 paragraph, editable basis texts |
| `src/components/pipeline/PipelineStage7.tsx` | Auto-renumbering for selected notes |
| `src/components/engagement/EngagementCARO.tsx` | Default CARO content from doc |
| `src/components/pipeline/MasterConfigPanel.tsx` | **NEW** — Master config UI |
| DB migration | `caro_master_templates` table, `clients` columns |

### Technical Details

- The `note_templates` table already serves as the master for Notes — the MasterConfigPanel will provide a CRUD UI for it
- CARO defaults are hardcoded as a fallback; firm-level overrides come from `caro_master_templates`
- Auto-numbering: a `useMemo` that filters selected notes and assigns `displayNumber = index + 1`
- Note 1 paragraph uses template literals with client data, rendered as a `<p>` with `contentEditable` spans or inline `<Input>` for the editable parts

