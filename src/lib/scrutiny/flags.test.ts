import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { scrutinyV2Enabled, scrutinyRunFunction } from "./flags";

describe("scrutiny v2 feature flag", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
  });

  it("is ON by default — routes to run-scrutiny-v2", () => {
    expect(scrutinyV2Enabled()).toBe(true);
    expect(scrutinyRunFunction()).toBe("run-scrutiny-v2");
  });

  it("opts back to legacy v1 via localStorage 'false'", () => {
    localStorage.setItem("scrutiny_v2", "false");
    expect(scrutinyV2Enabled()).toBe(false);
    expect(scrutinyRunFunction()).toBe("run-scrutiny");
  });

  // Note: the VITE_SCRUTINY_V2 build-time path is not unit-tested — Vite freezes
  // import.meta.env at transform time, so vi.stubEnv can't reach it. The localStorage
  // path above covers the runtime opt-out.

  it("treats any non-'false' value as on (default)", () => {
    localStorage.setItem("scrutiny_v2", "1");
    expect(scrutinyV2Enabled()).toBe(true);
  });
});
