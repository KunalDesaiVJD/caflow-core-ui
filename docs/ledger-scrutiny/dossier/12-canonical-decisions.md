# 12 Canonical Decisions — BINDING

> **This file overrides everything.** These are the locked decisions for the CAFlow
> Scrutiny Engine build.
>
> ⚠️ **Provenance note (2026-06-30):** The original `dossier/12-canonical-decisions.md`
> was lost along with the rest of the prepared material (see `00-status.md`). This file
> is a **faithful transcription of HANDOFF.md §2**, which reproduced the same decision
> table. It is authoritative for the 12 decisions below. The original may have carried
> additional commentary per decision that is **not recoverable** — where the engine needs
> a detail not captured here, the **Senior CA decides using HANDOFF §8** (never invent).

---

## The locked decisions

| # | Decision | Choice |
|---|---|---|
| 1 | **Scope** | Build everything, in HANDOFF §5 phase order |
| 2 | **Ledger → family** | **Reuse the existing COA Mapping module** (do not build a new mapper) |
| 3 | **AI** | Full AI (agentic + narration) — senior-owned phases |
| 4 | **UI target** | The "ultra command center" (`prototype/scrutiny-engine-prototype.html`) |
| 5 | **Team** | Junior + Senior (CA); tickets tagged `[JUNIOR]` / `[SENIOR]` / `[CA]` |
| 6 | **Queries** | Write into the existing `audit_client_queries` table |
| 7 | **Maker-checker** | Always — a second person approves before a query is "sent" |
| 8 | **Coverage** | Advisory only — **never block** Sign-off / UDIN |
| 9 | **Connectors** | GST-2B / 26AS / bank by **manual file upload** |
| 10 | **Fact masters** | Engagement Setup + AI nominations |
| 11 | **Rule editing** | Firm partners/admins only; **every edit logged** |
| 12 | **AI cost** | Tiered (cheap model for bulk, top model only for judgment) |

---

## Decision-maker rule

For any audit-domain question not answered above or in the rule dossier, the
**Senior CA decides** using the defaults in **HANDOFF.md §8** (build DB, 40A(3) transport
exception, 269ST counterparty handling, thresholds/severity, 3CD auto-fill scope,
golden-file baselines, logo/visibility). **Never invent audit logic. Never wait for the
absent partner.**
