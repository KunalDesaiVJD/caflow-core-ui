/**
 * Filing-proof upload.
 *
 * Verified against the live project first: the `documents` bucket is
 * public-read, has an authenticated INSERT policy and a 10 MB object cap, and
 * is the bucket this app already writes real ACKs to. The private
 * `tds-ack-files` bucket carries NO storage policies, so every client read and
 * write against it is rejected by RLS — it is legacy and deliberately unused.
 *
 * These pin the parts that would otherwise only fail at the user's hands.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { store } = vi.hoisted(() => ({
  store: {
    uploads: [] as any[],
    removed: [] as any[],
    updates: [] as any[],
    uploadError: null as any,
    updateError: null as any,
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        upload: (path: string, file: any, opts: any) => {
          store.uploads.push({ bucket, path, name: file.name, opts });
          return Promise.resolve({ error: store.uploadError });
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${bucket}/${path}` } }),
        remove: (paths: string[]) => { store.removed.push({ bucket, paths }); return Promise.resolve({ error: null }); },
      }),
    },
    from: (_t: string) => {
      const b: any = {};
      b.insert = () => Promise.resolve({ error: null });
      b.update = (payload: any) => { store.updates.push(payload); return b; };
      b.eq = () => Promise.resolve({ error: store.updateError });
      return b;
    },
  },
}));

import {
  uploadCorrectionProof, PROOF_BUCKET, PROOF_MAX_BYTES,
} from "./tdsCorrections";

const CORRECTION: any = { id: "corr1", firm_id: "f1", client_id: "c1" };
const ACTOR: any = { id: "u1", name: "Ravi", role: "manager" };
const fileOf = (name: string, size: number) =>
  ({ name, size, type: "" }) as unknown as File;

describe("uploadCorrectionProof", () => {
  beforeEach(() => {
    store.uploads = []; store.removed = []; store.updates = [];
    store.uploadError = null; store.updateError = null;
  });

  it("writes the ACK to the documents bucket under the correction's own path", async () => {
    const r = await uploadCorrectionProof(CORRECTION, "offline", fileOf("ack.pdf", 1024), ACTOR);
    expect(r.error).toBeNull();
    expect(store.uploads).toHaveLength(1);
    expect(store.uploads[0].bucket).toBe(PROOF_BUCKET);
    // per-correction folder, so a re-upload cannot collide with another one
    expect(store.uploads[0].path).toMatch(/^tds-corrections\/corr1\/offline-\d+\.pdf$/);
  });

  it("writes a screenshot for online filing", async () => {
    await uploadCorrectionProof(CORRECTION, "online", fileOf("proof.PNG", 2048), ACTOR);
    expect(store.uploads[0].path).toMatch(/^tds-corrections\/corr1\/online-\d+\.png$/);
  });

  it("links the stored file to the correction row", async () => {
    await uploadCorrectionProof(CORRECTION, "offline", fileOf("ack.pdf", 1024), ACTOR);
    const saved = store.updates[0];
    expect(saved).toMatchObject({ submission_mode: "offline", proof_file_name: "ack.pdf" });
    expect(saved.proof_file_url).toContain(`${PROOF_BUCKET}/tds-corrections/corr1/offline-`);
    expect(saved.proof_uploaded_at).toBeTruthy();
    expect(saved.proof_uploaded_by).toBe("u1");
  });

  it("rejects a file over the bucket's 10 MB cap, before uploading", async () => {
    const r = await uploadCorrectionProof(CORRECTION, "online", fileOf("big.png", PROOF_MAX_BYTES + 1), ACTOR);
    expect(r.error).toMatch(/limit is 10 MB/i);
    expect(store.uploads).toHaveLength(0);   // no wasted round trip
  });

  it("rejects an empty file and a disallowed type", async () => {
    expect((await uploadCorrectionProof(CORRECTION, "offline", fileOf("ack.pdf", 0), ACTOR)).error)
      .toMatch(/empty/i);
    expect((await uploadCorrectionProof(CORRECTION, "offline", fileOf("virus.exe", 100), ACTOR)).error)
      .toMatch(/not accepted/i);
    expect(store.uploads).toHaveLength(0);
  });

  it("surfaces a storage failure instead of claiming success", async () => {
    store.uploadError = { message: "Payload too large" };
    const r = await uploadCorrectionProof(CORRECTION, "offline", fileOf("ack.pdf", 1024), ACTOR);
    expect(r.error).toBe("Payload too large");
    expect(store.updates).toHaveLength(0);
  });

  it("removes the uploaded object if the row update fails, leaving no orphan", async () => {
    store.updateError = { message: "row locked" };
    const r = await uploadCorrectionProof(CORRECTION, "offline", fileOf("ack.pdf", 1024), ACTOR);
    expect(r.error).toBe("row locked");
    expect(store.removed).toHaveLength(1);
    expect(store.removed[0].paths[0]).toBe(store.uploads[0].path);
  });
});
