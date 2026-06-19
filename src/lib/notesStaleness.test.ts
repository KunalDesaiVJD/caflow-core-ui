import { describe, it, expect } from "vitest";
import { evaluateNotesStaleness } from "./notesStaleness";

describe("evaluateNotesStaleness", () => {
  const T0 = "2026-06-16T10:00:00.000Z";
  const LATER = "2026-06-16T12:00:00.000Z";

  it("returns 'unknown' when TB sync time is missing", () => {
    const r = evaluateNotesStaleness({ latestTbSyncedAt: null, latestNotesUpdatedAt: T0 });
    expect(r.verdict).toBe("unknown");
    expect(r.isStale).toBe(false);
    expect(r.canRefresh).toBe(false);
  });

  it("returns 'unknown' when notes update time is missing", () => {
    const r = evaluateNotesStaleness({ latestTbSyncedAt: T0, latestNotesUpdatedAt: null });
    expect(r.verdict).toBe("unknown");
    expect(r.isStale).toBe(false);
  });

  it("returns 'fresh' when notes were built at/after the TB sync", () => {
    const r = evaluateNotesStaleness({ latestTbSyncedAt: T0, latestNotesUpdatedAt: LATER });
    expect(r.verdict).toBe("fresh");
    expect(r.isStale).toBe(false);
    expect(r.canRefresh).toBe(false);
  });

  it("returns 'stale_refreshable' when TB re-synced after notes and notes are editable", () => {
    const r = evaluateNotesStaleness({ latestTbSyncedAt: LATER, latestNotesUpdatedAt: T0, notesFinalized: false });
    expect(r.verdict).toBe("stale_refreshable");
    expect(r.isStale).toBe(true);
    expect(r.canRefresh).toBe(true);
  });

  it("returns 'stale_locked' when TB re-synced after notes but notes are finalized", () => {
    const r = evaluateNotesStaleness({ latestTbSyncedAt: LATER, latestNotesUpdatedAt: T0, notesFinalized: true });
    expect(r.verdict).toBe("stale_locked");
    expect(r.isStale).toBe(true);
    expect(r.canRefresh).toBe(false);
  });

  it("does not flag staleness within the clock-skew tolerance", () => {
    const a = "2026-06-16T10:00:00.000Z";
    const b = "2026-06-16T10:00:00.500Z"; // 500ms later, within 1000ms tolerance
    const r = evaluateNotesStaleness({ latestTbSyncedAt: b, latestNotesUpdatedAt: a });
    expect(r.verdict).toBe("fresh");
  });

  it("flags staleness just beyond the tolerance", () => {
    const a = "2026-06-16T10:00:00.000Z";
    const b = "2026-06-16T10:00:02.000Z"; // 2s later, beyond tolerance
    const r = evaluateNotesStaleness({ latestTbSyncedAt: b, latestNotesUpdatedAt: a });
    expect(r.isStale).toBe(true);
  });

  // BUG-041 / D2.4 — COA-mapping fingerprint awareness (pull-model reactivity).
  it("flags stale via COA fingerprint mismatch even when timestamps say fresh", () => {
    const r = evaluateNotesStaleness({
      latestTbSyncedAt: T0, latestNotesUpdatedAt: LATER, // timestamps => fresh
      liveCoaFingerprint: "abc", notesCoaFingerprint: "xyz", // but mapping changed
    });
    expect(r.verdict).toBe("stale_refreshable");
    expect(r.isStale).toBe(true);
    expect(r.reason).toBe("coa_change");
  });

  it("stays fresh when the COA fingerprint matches and TB is not newer", () => {
    const r = evaluateNotesStaleness({
      latestTbSyncedAt: T0, latestNotesUpdatedAt: LATER,
      liveCoaFingerprint: "abc", notesCoaFingerprint: "abc",
    });
    expect(r.verdict).toBe("fresh");
    expect(r.isStale).toBe(false);
  });

  it("a COA change on finalized notes is stale_locked, not auto-refreshable", () => {
    const r = evaluateNotesStaleness({
      latestTbSyncedAt: T0, latestNotesUpdatedAt: LATER, notesFinalized: true,
      liveCoaFingerprint: "abc", notesCoaFingerprint: "xyz",
    });
    expect(r.verdict).toBe("stale_locked");
    expect(r.reason).toBe("coa_change");
  });

  it("TB re-sync takes precedence over a COA change in the reason", () => {
    const r = evaluateNotesStaleness({
      latestTbSyncedAt: LATER, latestNotesUpdatedAt: T0, // TB newer
      liveCoaFingerprint: "abc", notesCoaFingerprint: "xyz", // and COA changed
    });
    expect(r.isStale).toBe(true);
    expect(r.reason).toBe("tb_resync");
  });

  it("is unchanged (legacy) when no fingerprints are supplied", () => {
    const r = evaluateNotesStaleness({ latestTbSyncedAt: T0, latestNotesUpdatedAt: LATER });
    expect(r.verdict).toBe("fresh");
    expect(r.reason ?? null).toBe(null);
  });
});
