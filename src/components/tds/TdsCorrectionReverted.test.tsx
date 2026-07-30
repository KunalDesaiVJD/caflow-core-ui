/**
 * A row edited back to its filed values is NOT a change.
 *
 * If a user edits an entry, thinks better of it and types the original values
 * back by hand, the row can still carry a 'modify' marking. Rendering that as
 * Modified plus an "Original" comparison row shows two rows holding identical
 * data — which reads as a duplicated entry.
 *
 * The database clears the marking on the next write (20260730140000); this
 * covers rows ALREADY sitting in that state.
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, vi, expect } from "vitest";

vi.mock("@/integrations/supabase/client", () => {
  const rowsFor = (n: string) => {
    if (n === "tds_corrections") return [{ id:"corr1",firm_id:"firm1",client_id:"c1",financial_year:"2025-26",quarter:"Q4",form_type:"26Q",status:"draft" }];
    if (n === "tds_correction_challans") return [{ id:"cch1",filing_id:"corr1",correction_id:"corr1",action:"unchanged",challan_serial_no:"14755",client_id:"c1",form_type:"26Q",financial_year:"2025-26",quarter:"Q4",total_challan_amount:14214 }];
    if (n === "tds_correction_deductees") return [
      // marked 'modify', but every value equals the snapshot: a hand-reverted row
      { id:"d1",filing_id:"corr1",challan_id:"cch1",correction_id:"corr1",action:"modify",client_id:"c1",
        deductee_name:"BHAGWANBHAI NARSINGHBHAI PATEL",deductee_pan:"AALPP4283D",
        amount_paid_credited:100000,tds_amount:10000,total_tax_deducted:10000,
        original_values:{ deductee_name:"BHAGWANBHAI NARSINGHBHAI PATEL",deductee_pan:"AALPP4283D",
          // same amount, different scale — must not read as a difference
          amount_paid_credited:"100000.00",tds_amount:10000,total_tax_deducted:10000 } },
    ];
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

describe("a hand-reverted row", () => {
  it("renders as ONE unchanged entry, with no Original comparison row", async () => {
    render(<TdsCorrectionsModule clients={[{id:"c1",name:"Amber"}] as any} users={[]} isSuperadmin={false} resolveFirmId={async()=>"firm1"} />);
    await waitFor(() => expect(screen.getAllByTitle("Open correction").length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByTitle("Open correction")[0]);
    await new Promise(r => setTimeout(r, 700));

    const t = document.body.textContent!;
    // no duplicate "Original" row for it
    expect(screen.queryByText("ORIGINAL")).toBeNull();
    // and it is not advertised as a change anywhere
    expect(t).toContain("No changes yet");
    expect(screen.queryByText("Modified")).toBeNull();
  });
});
