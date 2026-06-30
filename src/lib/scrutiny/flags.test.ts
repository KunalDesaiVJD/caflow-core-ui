import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { scrutinyV2Enabled, scrutinyRunFunction } from "./flags";

describe("scrutiny v2 feature flag", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
  });

  it("is off by default — routes to the legacy run-scrutiny", () => {
    expect(scrutinyV2Enabled()).toBe(false);
    expect(scrutinyRunFunction()).toBe("run-scrutiny");
  });

  it("opts in via localStorage and routes to run-scrutiny-v2", () => {
    localStorage.setItem("scrutiny_v2", "true");
    expect(scrutinyV2Enabled()).toBe(true);
    expect(scrutinyRunFunction()).toBe("run-scrutiny-v2");
  });

  // Note: the VITE_SCRUTINY_V2 build-time path is not unit-tested — Vite freezes
  // import.meta.env at transform time, so vi.stubEnv can't reach it. The localStorage
  // path above covers the runtime opt-in users actually toggle.

  it("treats any non-'true' value as off", () => {
    localStorage.setItem("scrutiny_v2", "1");
    expect(scrutinyV2Enabled()).toBe(false);
  });
});
