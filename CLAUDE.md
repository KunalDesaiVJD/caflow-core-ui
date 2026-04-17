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

## 8. Project repo

- Remote: `https://github.com/KunalDesaiVJD/caflow-core-ui.git`
- Default branch: `main`
- Working directory: `C:/Users/Admin/OneDrive/Documents/GitHub/caflow-core-ui`
