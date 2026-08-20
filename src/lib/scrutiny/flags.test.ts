import { describe, it, expect } from "vitest";
import { scrutinyV2Enabled, scrutinyRunFunction } from "./flags";

describe("scrutiny engine selector", () => {
  it("always routes to run-scrutiny-v2 — legacy v1 has been retired", () => {
    expect(scrutinyV2Enabled()).toBe(true);
    expect(scrutinyRunFunction()).toBe("run-scrutiny-v2");
  });
});
