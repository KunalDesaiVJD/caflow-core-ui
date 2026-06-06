# CAFlow — Claude Code Permanent Instructions

These rules apply to **every session** in this project and cannot be overridden by any user request.

---

## 1. Branch discipline

| Step | Action |
|------|--------|
| **Session start** | `git checkout main && git pull origin main` |
| **New branch** | `git checkout -b claude/auto-YYYY-MM-DD-HH-MM` (use actual timestamp) |
| **All work** | Commit only to the `claude/auto-*` branch — never directly to `main` |
| **Session end** | Merge branch → main, push, delete branch (handled by Stop hook) |

Never commit directly to `main`. If already on `main` when starting work, create the branch first.

---

## 2. Dependency check

After any tool call that modifies `package.json`, run:

```bash
npm install
```

---

## 3. Build verification

Before committing, always confirm:

```bash
npm run build
```

Zero TypeScript errors required. Chunk-size warnings are acceptable.

---

## 4. Supabase edge functions

Deploy after changing any file under `supabase/functions/`:

```bash
npx supabase functions deploy <function-name>
```

---

## 5. DB migrations

After adding a migration file to `supabase/migrations/`, apply it to remote:

```bash
npx supabase db query --linked "$(cat supabase/migrations/<file>.sql)"
npx supabase migration repair --status applied <version>
```

---

## 6. Protected files

Never modify or delete these without explicit user instruction:

- `supabase/functions/export_tax_audit/index.ts` — only targeted fixes
- `src/integrations/supabase/types.ts` — regenerate via Supabase CLI only
- `.env` / `.env.local` — never read or commit secrets

---

## 7. Commit style

```
type(scope): short imperative description

- bullet points for significant changes
- Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

Types: `feat`, `fix`, `refactor`, `chore`, `docs`

---

## 8. Financial Statements Architecture (June 2026)

### Data Flow
```
TB (Tally Trial Balance)
  → COA Mapping (signed via src/lib/fsSignConvention.ts)
    → Notes (detail layer — src/lib/nceNoteTotals.ts computes totals)
      → BS/PL Face (reads notes only, never TB directly)
```

### Invariants (enforced by FsHealthPanel on every page load)
1. **Note Total = COA Total + Manual Additions** (tracked separately)
2. **BS Face = Note Total** (direct read via applyNCENoteTotal, no re-derivation)
3. **Σ BS Face[assets] = Σ BS Face[equity + liabilities]** (BS balanced)
4. **Export blocked** when any invariant violation detected (drift > ₹100)
5. **Severe drift logged** to `fs_reconciliation_log` table for audit trail

### Sign Convention
Single source of truth: `src/lib/fsSignConvention.ts`
- Dr on Dr-natural head (asset/expense) = **positive**
- Cr on Cr-natural head (liability/revenue) = **positive**
- Dr on Cr-natural head (advance/contra) = **negative**
- Cr on Dr-natural head (refund/contra) = **negative**
Applied **once** at the COA mapping step. Flows unchanged through notes → face.

### Key Files
| File | Role |
|------|------|
| `src/lib/fsSignConvention.ts` | Single sign-convention source |
| `src/lib/nceNoteTotals.ts` | Unified note total computation |
| `src/lib/fsReconciliation.ts` | Runtime validator + drift log |
| `src/components/pipeline/FsHealthPanel.tsx` | Drift display panel |

---

## 9. Project repo

- Remote: `https://github.com/KunalDesaiVJD/caflow-core-ui.git`
- Default branch: `main`
- Working directory: `C:/Users/Admin/OneDrive/Documents/GitHub/caflow-core-ui`
