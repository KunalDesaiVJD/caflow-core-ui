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
npx supabase db query --linked -f supabase/migrations/<file>.sql
npx supabase migration repair --status applied <version>
```

See §10 for whether Claude can run this itself in the current session.

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
2. **BS/PL Face = Note Total** (direct read via applyNCENoteTotal, no re-derivation)
3. **BS TOTAL = Σ individual rows** (NCE_AST / NCE_EL computed from note-overridden leaf codes, NOT from raw TB — internal consistency guaranteed)
4. **BS balanced** when Σ note assets = Σ note liabilities (FsHealthPanel flags drift)
5. **Export blocked** when any invariant violation detected (drift > ₹100)
6. **Severe drift logged** to `fs_reconciliation_log` table for audit trail

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

---

## 10. Supabase deployment access

**Standing instruction from the user (29-Jul-2026): Claude should run the Supabase
deploy steps in §4 and §5 itself rather than handing back a list of commands.**

Whether that is possible depends on where the session is running.

### Local sessions (Claude Code on the user's PC)

The user's Chrome is signed in to Supabase. `npx supabase login` opens the browser
and completes without further input. **Run §4 and §5 directly — do not ask.**

### Cloud sessions (claude.ai/code, GitHub Actions, mobile/web)

These run in an **isolated ephemeral container with no access to the user's
machine** — a different computer, not a different window. The user's open Chrome
is unreachable: no shared browser profile, no session cookies, no CDP bridge. A
Chromium binary exists in the container but is a blank Playwright install, so
"log in via the browser" would still need credentials and MFA.

In a cloud session, `npx supabase <anything>` fails with:

```
LegacyPlatformAuthRequiredError: Access token not provided.
```

**Making cloud sessions able to deploy is possible, but carries a real
trade-off** — read this before doing it.

A `SUPABASE_ACCESS_TOKEN` in the cloud-environment variables makes the CLI
non-interactive, and Claude can then run §4 and §5 unattended. However,
Anthropic's own documentation is explicit that cloud environments have **no
secrets store**, and that environment-variable values are readable by anyone
who uses that environment:

> "Anyone who uses the environment can read the values, and cloud environments
> have no dedicated secrets store, so don't add API keys or other credentials."
> — https://code.claude.com/docs/en/cloud-environments#set-environment-variables

A Supabase personal access token cannot be scoped: it grants **full account
access** to every project. That makes it one of the worst candidates for a
readable environment variable.

**Default position: run the deploys locally.** They take under a minute, need
no standing credential, and `supabase login` already works there.

**If the convenience is worth it anyway** (a personal, non-shared environment
where the user is the only reader), the setup is:

1. Create a token at https://supabase.com/dashboard/account/tokens
2. At claude.ai/code, select the cloud icon showing the environment name in the
   row above the message box (there is no settings page or direct URL), hover
   the environment, select the gear icon, and add to **Environment variables**
   in `.env` format:
   `SUPABASE_ACCESS_TOKEN=sbp_...`
   Optionally `SUPABASE_PROJECT_REF=hubyywmodekfdzhwiumb`.
3. Start a **new** session — variables are copied once at startup, so a session
   already running keeps the values it began with.

Never paste the token into chat, into the repo, or into a shared environment.

Until it is set, say so plainly and give the exact commands — do not claim the
browser is reachable.

### Secrets

Never paste an API key into chat or a commit. Set it directly:

```bash
npx supabase secrets set OPENROUTER_API_KEY=<key>
```

Keys used by the MSME 43B(h) utility: `ANTHROPIC_API_KEY` (Claude — extraction,
calibration, panel) and `OPENROUTER_API_KEY` (GPT — review panel; optional
`OPENROUTER_MODEL` to pin the model).
