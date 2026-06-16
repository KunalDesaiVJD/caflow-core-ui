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
});
