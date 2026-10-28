import { describe, it, expect, vi, afterEach } from "vitest";
import { downloadBlob } from "./downloadBlob";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("downloadBlob", () => {
  it("clicks a download link with a safe file name and revokes the URL only later", () => {
    vi.useFakeTimers();
    const create = vi.fn(() => "blob:x"); const revoke = vi.fn();
    (URL as any).createObjectURL = create; (URL as any).revokeObjectURL = revoke;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("Statement_A-B_2026.pdf");
      expect(this.href).toContain("blob:x");
    });
    downloadBlob(new Blob(["x"]), "Statement_A/B_2026.pdf");
    expect(click).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revoke).toHaveBeenCalledWith("blob:x");
  });
});
