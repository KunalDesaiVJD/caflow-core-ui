import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * These tests exist because three consecutive fixes tuned PAGES-per-call while
 * the thing that actually overflows is ROWS. The case that kept escaping was a
 * SHORT but DENSE file: few pages, many rows. It fell under the page threshold,
 * so it was never split, and it reached the one code path that had no retry.
 *
 * Every test below is written in terms of that failure, not in terms of the
 * implementation, so a future change back to page-based splitting fails here.
 */

const invoke = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke } },
}));

const pdfPageTexts = vi.fn();
vi.mock('./pdfText', () => ({
  pdfPageTexts: (...a: unknown[]) => pdfPageTexts(...a),
  pdfPageCount: vi.fn(),
}));

const { extractLedgersViaAI } = await import('./aiExtract');

/** A supabase-js FunctionsHttpError as the real client shapes it. */
function overflowError() {
  return {
    error: {
      name: 'FunctionsHttpError',
      message: 'Edge Function returned a non-2xx status code',
      context: new Response(
        JSON.stringify({
          error: 'This page range holds more rows than one reply can carry.',
          code: 'truncated',
          truncated: true,
        }),
        { status: 502 },
      ),
    },
    data: null,
  };
}

function ok(rows: number, vendor = 'Dense Traders') {
  return {
    data: {
      ledgers: [{
        vendorName: vendor,
        openingBalance: 0,
        closingBalance: rows * 1000,
        rows: Array.from({ length: rows }, (_, i) => [
          `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, 'Purchase A/c', 'Purchase', `INV-${i}`,
          0, 1000, null, null, null,
        ]),
      }],
      truncated: false,
    },
    error: null,
  };
}

/** A file object good enough for the code under test. */
function pdf(name = 'merged.pdf'): File {
  return { name, arrayBuffer: async () => new ArrayBuffer(8) } as unknown as File;
}

/** N pages, each with `perPage` text lines — the density knob. */
function pages(count: number, perPage: number): string[] {
  return Array.from({ length: count }, (_, p) =>
    Array.from({ length: perPage }, (_, l) => `page${p + 1} line${l + 1} 1000.00`).join('\n'));
}

beforeEach(() => {
  invoke.mockReset();
  pdfPageTexts.mockReset();
});

describe('a short but DENSE file — the case that kept failing', () => {
  it('is split even though it is only 3 pages', async () => {
    // 3 pages x 100 lines = 300 lines. Page-based routing sent this whole, in one
    // call, on the path with no retry. It must now be split by line count.
    pdfPageTexts.mockResolvedValue(pages(3, 100));
    invoke.mockResolvedValue(ok(2));

    await extractLedgersViaAI(pdf());

    expect(invoke.mock.calls.length).toBeGreaterThan(1);
    // and it must NOT have been sent as a whole document
    for (const [, opts] of invoke.mock.calls) {
      expect(opts.body.pdf_base64).toBeUndefined();
      expect(opts.body.text_content).toBeTruthy();
    }
  });

  it('halves a chunk that overflows, instead of losing the file', async () => {
    pdfPageTexts.mockResolvedValue(pages(1, 80));
    // First call overflows; everything after it succeeds.
    invoke.mockResolvedValueOnce(overflowError()).mockResolvedValue(ok(1));

    const res = await extractLedgersViaAI(pdf());

    expect(invoke).toHaveBeenCalledTimes(3); // 1 overflow + 2 halves
    expect(res.ledgers.length).toBeGreaterThan(0);
  });

  it('keeps halving until it fits', async () => {
    pdfPageTexts.mockResolvedValue(pages(1, 80));
    // The first three attempts overflow (80 → 40 → 20), then success.
    invoke
      .mockResolvedValueOnce(overflowError())
      .mockResolvedValueOnce(overflowError())
      .mockResolvedValueOnce(overflowError())
      .mockResolvedValue(ok(1));

    const res = await extractLedgersViaAI(pdf());
    expect(res.ledgers.length).toBeGreaterThan(0);
  });

  it('stops halving at the floor and reports it, rather than looping', async () => {
    pdfPageTexts.mockResolvedValue(pages(1, 20));
    // A FRESH error object each time, as the real client produces — a Response
    // body can only be read once, so a shared one would not survive the retries.
    invoke.mockImplementation(async () => overflowError());

    await expect(extractLedgersViaAI(pdf())).rejects.toThrow(/Could not read any ledger/);
    // Bounded: halving 20 lines down to the 8-line floor is a handful of calls,
    // not an unbounded retry storm.
    expect(invoke.mock.calls.length).toBeLessThan(12);
  });

  it('still retries when the error body cannot be read at all', async () => {
    // A 502 whose body is already consumed carries no `code`. Treating that as
    // "not retryable" would lose the whole file, so the status alone is enough.
    pdfPageTexts.mockResolvedValue(pages(1, 80));
    const consumed = new Response(JSON.stringify({ code: 'truncated' }), { status: 502 });
    await consumed.text(); // drain it, as a double-read would
    invoke
      .mockResolvedValueOnce({
        data: null,
        error: { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: consumed },
      })
      .mockResolvedValue(ok(1));

    const res = await extractLedgersViaAI(pdf());
    expect(invoke).toHaveBeenCalledTimes(3); // overflow + 2 halves
    expect(res.ledgers.length).toBeGreaterThan(0);
  });
});

describe('routing', () => {
  it('sends the whole document ONLY when there is no text layer', async () => {
    pdfPageTexts.mockResolvedValue(['', '   ', '']); // a scan
    invoke.mockResolvedValue(ok(1));

    await extractLedgersViaAI(pdf('scan.pdf'));

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][1].body.pdf_base64).toBeTruthy();
  });

  it('says what to do when a SCAN is too large, since it cannot be split', async () => {
    pdfPageTexts.mockResolvedValue(['', '']);
    invoke.mockResolvedValue(overflowError());

    await expect(extractLedgersViaAI(pdf('scan.pdf')))
      .rejects.toThrow(/scan with no text layer[\s\S]*Split the PDF into smaller files/);
  });

  it('falls back to the whole document when pdfjs cannot read the file at all', async () => {
    pdfPageTexts.mockRejectedValue(new Error('bad xref'));
    invoke.mockResolvedValue(ok(1));

    await extractLedgersViaAI(pdf());

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][1].body.pdf_base64).toBeTruthy();
  });

  it('does not treat a non-overflow failure as something to retry', async () => {
    pdfPageTexts.mockResolvedValue(pages(1, 20));
    invoke.mockResolvedValue({
      data: null,
      error: {
        name: 'FunctionsHttpError',
        message: 'Edge Function returned a non-2xx status code',
        context: new Response(
          JSON.stringify({ error: 'The openrouter account has no credits left.' }),
          { status: 402 },
        ),
      },
    });

    await expect(extractLedgersViaAI(pdf())).rejects.toThrow(/no credits left/);
    expect(invoke).toHaveBeenCalledTimes(1); // no pointless halving
  });
});

describe('a long file still works', () => {
  it('splits 40 sparse pages by line count and stitches the vendors back', async () => {
    pdfPageTexts.mockResolvedValue(pages(40, 10)); // 400 lines
    invoke.mockResolvedValue(ok(2, 'Same Vendor'));

    const res = await extractLedgersViaAI(pdf());

    expect(invoke.mock.calls.length).toBe(5); // 400 lines / 80
    // Every chunk reported the same vendor, so they merge into one ledger.
    expect(res.ledgers).toHaveLength(1);
    expect(res.ledgers[0].vendorName).toBe('Same Vendor');
  });

  it('reports the page range it is working on, so a long run does not look hung', async () => {
    pdfPageTexts.mockResolvedValue(pages(10, 30));
    invoke.mockResolvedValue(ok(1));
    const notes: string[] = [];

    await extractLedgersViaAI(pdf(), (n) => notes.push(n));

    expect(notes.length).toBeGreaterThan(1);
    expect(notes.some((n) => /pages? \d+/.test(n))).toBe(true);
    expect(notes.some((n) => /lines/.test(n))).toBe(true);
  });
});
