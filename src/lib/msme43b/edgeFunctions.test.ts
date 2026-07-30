import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * GUARDS ON THE EDGE FUNCTIONS.
 *
 * `npm run build` compiles the browser app; vitest runs the browser library.
 * NEITHER touches supabase/functions — they are Deno, deployed separately. So
 * the repo's normal checks are all green while an edge function is broken, and
 * the first thing to notice is a failed deploy or a 500 in production.
 *
 * That gap let a commit go out with raw git conflict markers in all three
 * functions: a stash was reapplied onto a different base, `git add -A` swallowed
 * the conflicted files, and tests plus build passed regardless.
 *
 * These are cheap text assertions, not a substitute for typechecking, but they
 * catch the failure that actually happened.
 */
const FUNCTIONS = [
  'supabase/functions/msme-extract-ledger/index.ts',
  'supabase/functions/msme-calibrate/index.ts',
  'supabase/functions/msme-panel-review/index.ts',
];

describe('edge functions are committed in a sane state', () => {
  it.each(FUNCTIONS)('%s has no merge conflict markers', (file) => {
    const src = readFileSync(file, 'utf8');
    for (const marker of ['<<<<<<<', '>>>>>>>', 'Updated upstream', 'Stashed changes']) {
      expect(src).not.toContain(marker);
    }
  });

  it.each(FUNCTIONS)('%s declares each transport constant exactly once', (file) => {
    const src = readFileSync(file, 'utf8');
    // A duplicate `const` is a Deno syntax error — the function would not even
    // start — and it is exactly what a botched conflict resolution produces.
    for (const decl of ['const DEFAULT_MODEL', 'const DEFAULT_VISION_MODEL', 'function resolveProvider', 'async function callModel']) {
      expect(src.split(decl).length - 1, `${decl} in ${file}`).toBe(1);
    }
  });

  it('the panel declares its challenger model exactly once', () => {
    const src = readFileSync('supabase/functions/msme-panel-review/index.ts', 'utf8');
    expect(src.split('const DEFAULT_GPT_MODEL').length - 1).toBe(1);
  });

  it('a picture or a PDF is routed to a model that can see one', () => {
    // The text models in use (DeepSeek, Kimi) accept neither. Losing this
    // routing would break scanned ledgers only — the hardest files, and the
    // ones where the failure looks like a bad scan rather than a wrong model.
    for (const file of FUNCTIONS) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).toContain('const needsVision = parts.some');
      expect(src, file).toContain('resolveProvider(needsVision)');
      expect(src, file).toContain('MSME_VISION_MODEL');
    }
  });
});
