# START HERE — Junior + Senior (CA), 7-day autonomous build

The partner is away ~7 days and will give **no commands**. You two build the **CAFlow Scrutiny Engine** through all phases, **on the branch only**, and produce a **preview the CA can open after every phase**. Everything is written down; the **Senior CA** decides anything about audit rules.

## How to begin (2 minutes)

1. On this machine, open a **new Claude Code session** in this project.
2. **Copy the entire grey-box prompt below and paste it as your first message.** It loads the full handoff, enforces the safety rules, runs the first build check, then works with you ticket-by-ticket.
3. Work through the phases in order. **After every phase, the assistant produces a preview link for the CA** (a file you open in a browser). The CA reviews; then you continue.

> ⚠️ Two unbreakable rules: **work only in the worktree `C:/Users/kvdes/caflow-ledger-scrutiny-wt`**, and **never push to `main`.** The pasted prompt enforces both — don't remove those lines.

---

## ⬇️ Paste this as your first message

```
You are my build assistant for the CAFlow "Scrutiny Engine" module. The partner is away ~7 days and will give NO commands — a Junior developer and a Senior (who is a CA) build it together. The Senior CA decides anything about audit rules. Follow these rules EXACTLY.

GOLDEN RULES (never break):
1. Work ONLY inside the git worktree: C:/Users/kvdes/caflow-ledger-scrutiny-wt (branch: claude/auto-2026-06-21-ledger-scrutiny). FIRST action: cd there and run `git branch --show-current`. If it is NOT exactly claude/auto-2026-06-21-ledger-scrutiny, STOP and tell me — do nothing else.
2. NEVER cd into or modify C:/Users/kvdes/OneDrive/Desktop/Audit/caflow-core-ui-main (the MAIN repo — it auto-pushes to main). Stay out of it.
3. NEVER run `git push`, never merge, never `git checkout main`. Commit ONLY to the branch in the worktree.
4. NEVER apply database migrations to production. Use a dev database only.
5. Do ONE ticket at a time: implement → run its acceptance test → `npm run build` (zero TS errors) → commit to the branch → STOP and let me test → I say "next".
6. Never guess audit rules/thresholds. If something is not in HANDOFF.md or 12-canonical-decisions.md, the Senior CA decides using the defaults in HANDOFF.md §8. Do not wait for the partner.

PREVIEW AFTER EVERY PHASE (mandatory — this is how the absent partner sees progress):
At the end of each phase: run `npm run build`; start the app (`npm run dev`) and screenshot the new screens; create a self-contained `docs/ledger-scrutiny/previews/phase-<N>-<name>.html` that summarises the phase and embeds the screenshots; commit it AND copy it to C:/Users/kvdes/OneDrive/Desktop/Audit/Scrutiny_Previews/. Give me that file path as the preview link (plus http://localhost:5173 if I'm on this machine). I (the CA) review it before you start the next phase.

STEP 1 — read for full context (from the worktree):
- docs/ledger-scrutiny/HANDOFF.md  (rules, the 12 decisions, autonomous mode, preview protocol, CA defaults §8, ticket backlog)
- docs/ledger-scrutiny/dossier/12-canonical-decisions.md  (binding)

STEP 2 — do ONLY Ticket 0.1 from HANDOFF.md §6: cd to the worktree, confirm the branch, `npm install`, `npm run build`. Tell me if it passes with zero TS errors; if not, paste the error and STOP.

STEP 3 — greet us (3 lines: what this module is, that we're on the branch and never touch main, the Ticket 0.1 result), confirm you will produce a preview after every phase, list the next tickets (0.2 Senior CA picks the dev DB; 0.3/0.4 Senior; 1.1 Junior), then STOP and wait for "next". Proceed through ALL phases this way without waiting for the partner.
```

---

## What to expect

- **Senior CA** makes the audit-domain calls (HANDOFF.md §8 has the defaults) and owns the senior-tagged tickets (security, AI, agentic, forensics, connectors).
- **Junior** owns Ticket 0.1, Phase 1, and the Phase 6 UI assembly.
- **After every phase**, the assistant drops a preview at `Scrutiny_Previews/phase-<N>.html` on the Desktop — open it in any browser to see what was built.
- Full plan: `docs/ledger-scrutiny/HANDOFF.md`. Binding decisions: `dossier/12-canonical-decisions.md`.
