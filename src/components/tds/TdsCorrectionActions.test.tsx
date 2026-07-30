import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, vi, expect } from "vitest";
const { state } = vi.hoisted(() => ({ state: { status: "ready_to_file" as string } }));
vi.mock("@/integrations/supabase/client", () => {
  const rowsFor = (n: string) => {
    if (n === "tds_corrections") return [{ id:"corr1",firm_id:"firm1",client_id:"c1",financial_year:"2025-26",quarter:"Q4",form_type:"26Q",
      status:state.status, prepared_by:"u1",prepared_by_name:"Ronak Virani",prepared_by_role:"staff_article",prepared_at:"2026-07-30T12:00:00Z",
      approved_by:"u2",approved_by_name:"Gautam Asodariya",approved_by_role:"manager",approved_at:"2026-07-30T12:50:00Z",
      submission_mode:null, proof_file_url:null, proof_file_name:null }];
    if (n === "tds_correction_challans") return [];
    if (n === "tds_correction_deductees") return [];
    return [];
  };
  const build = (n: string) => { const rows = rowsFor(n); const b: any = {};
    for (const m of ["select","eq","neq","in","is","gte","lte","gt","lt","order","limit","range","ilike","or","filter","insert","update","upsert","delete"]) b[m]=()=>b;
    b.maybeSingle=()=>Promise.resolve({data:rows[0]??null,error:null});
    b.single=()=>Promise.resolve({data:rows[0]??null,error:null});
    b.then=(r:any)=>Promise.resolve({data:rows,error:null,count:rows.length}).then(r);
    return b; };
  const ch: any={}; ch.on=vi.fn(()=>ch); ch.subscribe=vi.fn(()=>ch);
  return { supabase: { from:(n:string)=>build(n), channel:()=>ch, removeChannel:vi.fn() } };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id:"u9",name:"Ravi",role:"admin",firm_id:"firm1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
import { TdsCorrectionsModule } from "@/components/tds/TdsCorrectionsModule";

/**
 * Each workflow action lives in ITS OWN box — nothing in a header toolbar.
 *
 *   Employee signature box -> Submit / Sign as preparer
 *   Senior approval box    -> Reject / Approve as senior
 *   Filing box             -> Offline|Online, the upload, and Mark as Filed
 *
 * Duplicating them at the top-right is what this replaced.
 */
describe("workflow actions live in their own boxes", () => {
  const open = async () => {
    render(<TdsCorrectionsModule clients={[{id:"c1",name:"Elenza"}] as any} users={[]} isSuperadmin={false} resolveFirmId={async()=>"firm1"} />);
    await waitFor(() => expect(screen.getAllByTitle("Open correction").length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByTitle("Open correction")[0]);
    await new Promise(r => setTimeout(r, 700));
  };

  it("puts the filing flow inside the Filing box once both signatures are in", async () => {
    state.status = "ready_to_file";
    await open();
    const t = document.body.textContent!.replace(/\s+/g, " ");
    const filingIdx = t.indexOf("Filing");
    expect(filingIdx).toBeGreaterThan(-1);

    // both submission options and the action all sit AFTER the Filing heading
    const filingBox = t.slice(filingIdx);
    expect(filingBox).toContain("Offline filing");
    expect(filingBox).toContain("Acknowledgement (ACK)");
    expect(filingBox).toContain("Online correction filing");
    expect(filingBox).toContain("Submission screenshot");
    expect(filingBox).toContain("Mark as Filed");

    // and Mark as Filed is gated until a mode + proof are supplied
    expect(screen.getByRole("button", { name: /Mark as Filed/i })).toBeDisabled();
  });

  it("offers the senior action inside the Senior approval box", async () => {
    state.status = "awaiting_senior";
    await open();
    expect(screen.getByRole("button", { name: /Approve as senior/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reject/i })).toBeInTheDocument();
    // the Filing box offers nothing yet
    expect(screen.queryByRole("button", { name: /Mark as Filed/i })).toBeNull();
  });

  it("never calls a correction 'Filed' before it has been", async () => {
    // The grid locks entries from the first signature onward, and used to say
    // "This filing is Filed" whenever locked — untrue at awaiting_senior and
    // at ready_to_file, and it told the user to unlock it from the Filings
    // list, which has nothing to do with a correction.
    for (const st of ["awaiting_senior", "ready_to_file"]) {
      state.status = st;
      await open();
      const t = document.body.textContent!;
      expect(t).not.toContain("This filing is Filed");
      expect(t).not.toContain("Change status in Filings list");
      expect(t).toContain("Entries are locked");
      cleanup();
    }
  });

  it("drops the 'different person' note once the senior HAS signed", async () => {
    state.status = "ready_to_file";
    await open();
    // the rule only matters while the slot is open; under a completed
    // signature it reads as a warning about that signature
    expect(screen.queryByText(/Must be a different person/i)).toBeNull();
  });
});
