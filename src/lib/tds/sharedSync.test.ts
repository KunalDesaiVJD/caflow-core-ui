import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The TDS column-mapping engine is used by the app (Stage-1/2/3 all read client
 * Excel through it) AND by the tds-recon-import Deno edge function, which cannot
 * import from src/. So the edge function imports a byte-identical copy from
 * supabase/functions/_shared/. This guard fails if the copies drift.
 *
 * This is not hypothetical. The engine was previously duplicated INLINE inside
 * tds-recon-import/index.ts, and the two copies silently diverged: the app's copy
 * gained a bare "credit" synonym on amount_paid, which made bestFieldForHeader tag
 * "Date of payment / credit (dd/mm/yyyy)" as an AMOUNT column — so the real payment
 * date was never eligible as date_of_payment and the mapper fell back to "Date of
 * deduction". Measured against 90 real client files, 31 mapped differently between
 * the two engines. Nothing surfaced it, because nothing compared them.
 *
 * To re-sync after editing src: copy the file into supabase/functions/_shared/.
 *   cp src/lib/tds/columnEngine.ts supabase/functions/_shared/tdsColumnEngine.ts
 *
 * columnEngine.ts is deliberately dependency-free (zero imports) so the same text
 * is valid in both the browser bundle and Deno. Keep it that way — an import would
 * break the copy in one runtime or the other.
 */
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");

describe("shared TDS engine stays in sync with src", () => {
  it("columnEngine.ts matches the _shared copy the edge function imports", () => {
    expect(read("../../../supabase/functions/_shared/tdsColumnEngine.ts")).toBe(read("./columnEngine.ts"));
  });

  it("columnEngine.ts has no imports, so the copy is valid in Deno and the browser", () => {
    expect(read("./columnEngine.ts")).not.toMatch(/^\s*import\s/m);
  });
});
