/**
 * Filing a correction requires PROOF.
 *
 * Both signatures authorise it; the Filed button then stays disabled until a
 * submission mode is chosen AND the matching file is uploaded — offline wants
 * the acknowledgement, online wants a screenshot. The same rule is enforced by
 * a DB trigger, so this pins the UI half.
 */
import { describe, it, expect, vi } from "vitest";
import { canMarkFiled, SUBMISSION_MODE_META } from "@/lib/tdsCorrections";

const signed = { prepared_at: "2026-07-01T10:00:00Z", approved_at: "2026-07-01T11:00:00Z" };

describe("canMarkFiled", () => {
  it("refuses until BOTH signatures are present", () => {
    expect(canMarkFiled({ ...signed, prepared_at: null, submission_mode: "offline", proof_file_url: "u" } as any)).toBe(false);
    expect(canMarkFiled({ ...signed, approved_at: null, submission_mode: "offline", proof_file_url: "u" } as any)).toBe(false);
  });

  it("refuses when the submission mode has not been chosen", () => {
    expect(canMarkFiled({ ...signed, submission_mode: null, proof_file_url: "u" } as any)).toBe(false);
  });

  it("refuses when no proof file has been uploaded", () => {
    expect(canMarkFiled({ ...signed, submission_mode: "online", proof_file_url: null } as any)).toBe(false);
  });

  it("allows only with both signatures, a mode and a proof file", () => {
    expect(canMarkFiled({ ...signed, submission_mode: "offline", proof_file_url: "https://x/ack.pdf" } as any)).toBe(true);
    expect(canMarkFiled({ ...signed, submission_mode: "online", proof_file_url: "https://x/shot.png" } as any)).toBe(true);
  });

  it("asks for the right artefact per mode", () => {
    expect(SUBMISSION_MODE_META.offline.proofLabel).toMatch(/Acknowledgement/i);
    expect(SUBMISSION_MODE_META.online.proofLabel).toMatch(/screenshot/i);
    // an ACK is commonly a PDF; a screenshot is an image
    expect(SUBMISSION_MODE_META.offline.accept).toContain(".pdf");
    expect(SUBMISSION_MODE_META.online.accept).toContain(".png");
  });
});
