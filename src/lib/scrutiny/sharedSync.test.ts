import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The scrutiny engine + adapters are unit-tested here in src/, but the run-scrutiny-v2 Deno
 * edge function imports byte-identical copies from supabase/functions/_shared/. This guard fails
 * if the copies drift, so a fix/extension to the engine can't silently miss the deployed copy.
 *
 * To re-sync after editing src: copy the two files into supabase/functions/_shared/.
 */
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");

describe("shared scrutiny modules stay in sync with src", () => {
  it("detectionEngine.ts matches the _shared copy", () => {
    expect(read("../../../supabase/functions/_shared/detectionEngine.ts")).toBe(read("./detectionEngine.ts"));
  });

  it("adapters.ts matches the _shared copy", () => {
    expect(read("../../../supabase/functions/_shared/adapters.ts")).toBe(read("./adapters.ts"));
  });
});
