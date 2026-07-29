import { describe, it, expect } from 'vitest';
import { ownedBytes, linesFromItems } from './pdfText';

/**
 * Simulates what pdfjs does: it TRANSFERS the buffer it is handed to its worker
 * thread, which detaches it on this side. structuredClone with a transfer list
 * detaches in exactly the same way, so this reproduces the real failure without
 * needing pdfjs or a worker.
 */
function transferAway(bytes: Uint8Array): void {
  structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
}

describe('ownedBytes protects the caller from pdfjs detaching their buffer', () => {
  it('reproduces the bug when the buffer is handed over directly', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5]);
    // What the broken code did: pass the caller's own bytes straight through.
    transferAway(original);
    // The caller's buffer is now unusable — this is the production error.
    expect(() => new Uint8Array(original.buffer)).toThrow(/detached/i);
  });

  it('leaves the caller\'s buffer intact when a copy is handed over', () => {
    const buf = new ArrayBuffer(5);
    new Uint8Array(buf).set([1, 2, 3, 4, 5]);

    const copy = ownedBytes(buf);
    transferAway(copy); // pdfjs takes the copy

    // The caller can still read, and still upload, their own bytes.
    expect(() => new Uint8Array(buf)).not.toThrow();
    expect(Array.from(new Uint8Array(buf))).toEqual([1, 2, 3, 4, 5]);
    expect(buf.byteLength).toBe(5);
  });

  it('survives being called twice on the same input — page count then page text', () => {
    const buf = new ArrayBuffer(3);
    new Uint8Array(buf).set([9, 8, 7]);

    transferAway(ownedBytes(buf)); // pdfPageCount()
    transferAway(ownedBytes(buf)); // pdfPageTexts()

    expect(Array.from(new Uint8Array(buf))).toEqual([9, 8, 7]);
  });

  it('copies rather than views, for both input shapes', () => {
    const buf = new ArrayBuffer(4);
    expect(ownedBytes(buf).buffer).not.toBe(buf);

    const view = new Uint8Array([1, 2, 3, 4]);
    expect(ownedBytes(view).buffer).not.toBe(view.buffer);
    expect(Array.from(ownedBytes(view))).toEqual([1, 2, 3, 4]);
  });
});

describe('linesFromItems (unchanged, guards the parsing contract)', () => {
  it('groups tokens into lines top-to-bottom, left-to-right', () => {
    const lines = linesFromItems([
      { str: 'World', x: 50, y: 100, width: 30 },
      { str: 'Hello', x: 10, y: 100, width: 30 },
      { str: 'Second', x: 10, y: 80, width: 30 },
    ]);
    expect(lines.map((l) => l.text)).toEqual(['Hello World', 'Second']);
  });
});
