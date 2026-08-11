// The point of the session store is that a refresh loses nothing, so the tests
// are about the failure modes: an oversized snapshot, a stale one, and a
// corrupt one. In every case the reviewer must end up with something usable
// rather than a thrown error on page load.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readSession, writeSession, clearSession, type Msme43bSession } from './sessionStore';
import type { Msme43bReport, VendorLedger } from './types';

const report = (extra = ''): Msme43bReport => ({
  cyLabel: '2025-26',
  fyLabel: '2026-27',
  windowDays: 45,
  vendors: [],
  totalDisallowedCY: 125000,
  totalAllowedFY: 0,
  totalStillOutstanding: 125000,
  totalGstExcluded: 0,
  unreconciledVendors: [],
  unreconciledDisallowed: 0,
  blocksSignOff: false,
  blockingReasons: [],
  totalGstUnidentified: 0,
  clean: true,
  clientName: `Accu-Panels${extra}`,
});

const ledger = (bulk = ''): VendorLedger => ({
  vendorName: `A Vendor${bulk}`,
  openingBalance: 0,
  closingBalance: 1000,
  txns: [],
  format: 'ai',
});

const session = (over: Partial<Msme43bSession> = {}): Msme43bSession => ({
  clientId: 'client-1',
  runId: 'run-1',
  windowDays: 45,
  savedAt: new Date().toISOString(),
  snapshot: { report: report(), cyLedgers: [ledger()], fyLedgers: [], panelReview: null },
  ...over,
});

describe('msme43b session store', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

  it('round-trips the screen, figures and all', () => {
    const out = writeSession(session());
    expect(out).toEqual({ stored: true, snapshotDropped: false });

    const back = readSession();
    expect(back?.clientId).toBe('client-1');
    expect(back?.runId).toBe('run-1');
    expect(back?.snapshot?.report.totalDisallowedCY).toBe(125000);
    expect(back?.snapshot?.cyLedgers).toHaveLength(1);
  });

  it('returns null when nothing was ever saved', () => {
    expect(readSession()).toBeNull();
  });

  // The ledgers are the bulk of a snapshot AND are held on the run row, so they
  // are the first thing given up — the figures on screen are what matter.
  it('drops the ledgers rather than the report when the snapshot is too big', () => {
    const huge = writeSession(session({
      snapshot: {
        report: report(),
        cyLedgers: [ledger('x'.repeat(4_000_000))],
        fyLedgers: [],
        panelReview: null,
      },
    }));
    expect(huge.stored).toBe(true);
    expect(huge.snapshotDropped).toBe(false);

    const back = readSession();
    expect(back?.snapshot?.report.totalDisallowedCY).toBe(125000);
    expect(back?.snapshot?.cyLedgers).toEqual([]);
    // The pointer still names the run, so the ledgers come back from Supabase.
    expect(back?.runId).toBe('run-1');
  });

  it('keeps the pointer when even the lean snapshot will not fit', () => {
    const out = writeSession(session({
      snapshot: { report: report('y'.repeat(4_000_000)), cyLedgers: [], fyLedgers: [], panelReview: null },
    }));
    expect(out).toEqual({ stored: true, snapshotDropped: true });

    const back = readSession();
    expect(back?.snapshot).toBeNull();
    expect(back?.runId).toBe('run-1');
    expect(back?.clientId).toBe('client-1');
  });

  it('ignores a session older than thirty days, and forgets it', () => {
    writeSession(session({ savedAt: new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString() }));
    expect(readSession()).toBeNull();
    expect(localStorage.getItem('msme43b:session:v1')).toBeNull();
  });

  it('keeps a session from yesterday', () => {
    writeSession(session({ savedAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString() }));
    expect(readSession()?.runId).toBe('run-1');
  });

  // A snapshot written by an older shape of the code must not break page load.
  it('discards unreadable stored data instead of throwing', () => {
    localStorage.setItem('msme43b:session:v1', '{not json');
    expect(readSession()).toBeNull();
    expect(localStorage.getItem('msme43b:session:v1')).toBeNull();
  });

  it('discards a stored object with no savedAt', () => {
    localStorage.setItem('msme43b:session:v1', JSON.stringify({ clientId: 'c' }));
    expect(readSession()).toBeNull();
  });

  it('clears on request', () => {
    writeSession(session());
    clearSession();
    expect(readSession()).toBeNull();
  });
});
