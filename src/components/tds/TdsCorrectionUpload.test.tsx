/**
 * Upload → Filed becomes available.
 *
 * The requirement end to end: choose Offline or Online, attach the ACK or the
 * screenshot, and only then can the correction be marked Filed. The DB refuses
 * a filing without a mode and a proof, so this pins the UI half agreeing.
 */
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, vi, expect, beforeEach } from "vitest";

const { db } = vi.hoisted(() => ({
  db: {
    correction: null as any,
    uploaded: [] as any[],
  },
}));

vi.mock("@/integrations/supabase/client", () => {
  const build = (n: string) => {
    const rows = n === "tds_corrections" ? [db.correction] : [];
    // Every method returns the SAME builder so any chain length works, and the
    // builder is itself thenable — mirroring the postgrest client.
    const b: any = {};
    for (const m of ["select","eq","neq","in","is","gte","lte","gt","lt","order","limit","range","ilike","or","filter","insert","upsert","delete"]) b[m] = () => b;
    b.update = (payload: any) => { Object.assign(db.correction, payload); return b; };
    b.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    b.single = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    b.then = (r: any) => Promise.resolve({ data: rows, error: null, count: rows.length }).then(r);
    return b;
  };
  const ch: any = {}; ch.on = vi.fn(() => ch); ch.subscribe = vi.fn(() => ch);
  return {
    supabase: {
      from: (n: string) => build(n),
      channel: () => ch,
      removeChannel: vi.fn(),
      storage: {
        from: (bucket: string) => ({
          upload: (path: string, file: any) => { db.uploaded.push({ bucket, path, name: file.name }); return Promise.resolve({ error: null }); },
          getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } }),
          remove: () => Promise.resolve({ error: null }),
        }),
      },
    },
  };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id:"u9",name:"Ravi",role:"manager",firm_id:"firm1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
import { TdsCorrectionsModule } from "@/components/tds/TdsCorrectionsModule";

const open = async () => {
  render(<TdsCorrectionsModule clients={[{id:"c1",name:"Elenza"}] as any} users={[]} isSuperadmin={false} resolveFirmId={async()=>"firm1"} />);
  await waitFor(() => expect(screen.getAllByTitle("Open correction").length).toBeGreaterThan(0));
  fireEvent.click(screen.getAllByTitle("Open correction")[0]);
  await new Promise(r => setTimeout(r, 600));
};

describe("filing proof upload", () => {
  beforeEach(() => {
    cleanup();
    db.uploaded = [];
    db.correction = {
      id:"corr1", firm_id:"firm1", client_id:"c1", financial_year:"2025-26", quarter:"Q4",
      form_type:"26Q", status:"ready_to_file",
      prepared_by:"u1", prepared_by_name:"Ronak", prepared_at:"2026-07-30T12:00:00Z",
      approved_by:"u2", approved_by_name:"Gautam", approved_at:"2026-07-30T12:50:00Z",
      submission_mode:null, proof_file_url:null, proof_file_name:null,
    };
  });

  const attach = async (label: RegExp, fileName: string) => {
    fireEvent.click(screen.getByRole("button", { name: label }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    const file = new File(["x"], fileName, { type: "application/pdf" });
    Object.defineProperty(input, "files", { value: [file] });
    fireEvent.change(input);
    await waitFor(() => expect(db.uploaded.length).toBe(1));
  };

  // Filed on + Acknowledgement no. are mandatory alongside proof — fill both
  // the way a user would before Mark as Filed can ever be enabled.
  const fillFiledOnAndAck = () => {
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    expect(dateInput).toBeTruthy();
    fireEvent.change(dateInput, { target: { value: "2026-07-31" } });
    fireEvent.change(screen.getByPlaceholderText(/Required/i), { target: { value: "ACK12345" } });
  };

  it("Offline filing uploads the ACK and then enables Filed", async () => {
    await open();
    // gated before any attachment
    expect(screen.getByRole("button", { name: /Mark as Filed/i })).toBeDisabled();

    await attach(/^Offline/i, "ack.pdf");
    expect(db.uploaded[0].name).toBe("ack.pdf");
    // saved AND linked to this correction
    expect(db.correction.submission_mode).toBe("offline");
    expect(db.correction.proof_file_name).toBe("ack.pdf");
    expect(db.correction.proof_file_url).toContain("tds-corrections/corr1/offline-");

    // the attached file is shown back to the user
    await waitFor(() => expect(screen.getByText("ack.pdf")).toBeInTheDocument());
    // still gated until Filed on + Acknowledgement no. are entered too
    expect(screen.getByRole("button", { name: /Mark as Filed/i })).toBeDisabled();
    fillFiledOnAndAck();
    // ...and Filed unlocks once the user confirms
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Mark as Filed/i })).toBeEnabled());
  });

  it("Online correction filing uploads the screenshot and then enables Filed", async () => {
    await open();
    await attach(/^Online/i, "submission.png");
    expect(db.correction.submission_mode).toBe("online");
    expect(db.correction.proof_file_url).toContain("tds-corrections/corr1/online-");
    await waitFor(() => expect(screen.getByText("submission.png")).toBeInTheDocument());
    fillFiledOnAndAck();
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Mark as Filed/i })).toBeEnabled());
  });
});
