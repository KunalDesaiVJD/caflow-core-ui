import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, vi, expect } from "vitest";
vi.mock("@/integrations/supabase/client", () => {
  const rowsFor = (n: string) => {
    if (n === "tds_corrections") return [{ id:"corr1",firm_id:"firm1",client_id:"c1",financial_year:"2025-26",quarter:"Q1",form_type:"26Q",status:"draft" }];
    if (n === "tds_correction_challans") return [{ id:"cch1",filing_id:"corr1",correction_id:"corr1",action:"unchanged",challan_serial_no:"14755",client_id:"c1",form_type:"26Q",financial_year:"2025-26",quarter:"Q1",total_challan_amount:14214 }];
    if (n === "tds_correction_deductees") return [
      { id:"d1",filing_id:"corr1",challan_id:"cch1",correction_id:"corr1",action:"unchanged",client_id:"c1",deductee_name:"KEPT",total_tax_deducted:3800,interest_amount:0 },
      { id:"d3",filing_id:"corr1",challan_id:"cch1",correction_id:"corr1",action:"delete",client_id:"c1",deductee_name:"REMOVED",total_tax_deducted:900,interest_amount:0 },
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

/**
 * Correction grid invariants.
 *
 * A correction keeps deleted entries VISIBLE (struck through) so the removal
 * can be seen — but a removed entry no longer consumes the challan. These pin
 * that the display and the arithmetic disagree in the right direction.
 */
describe("correction grid", () => {
  it("shows deleted rows but excludes them from balance and count", async () => {
    render(<TdsCorrectionsModule clients={[{id:"c1",name:"Acme"}] as any} users={[]} isSuperadmin={false} resolveFirmId={async()=>"firm1"} />);
    await waitFor(() => expect(screen.getAllByTitle("Open correction").length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByTitle("Open correction")[0]);
    await new Promise(r => setTimeout(r, 700));
    // Challans is collapsed by default in the Correction tab — expand it first.
    fireEvent.click(screen.getByText("Challans").closest("button")!);
    await new Promise(r => setTimeout(r, 100));
    const t = document.body.textContent!.replace(/\s+/g," ");
    const i = t.indexOf("Applied");
    console.log("BALANCE:", t.slice(i - 120, i + 80));
    // 3,800 kept + 900 deleted = 4,700 if the bug were present.
    expect(t).toContain("Applied: ₹3,800");
    expect(t).not.toContain("Applied: ₹4,700");
    // ...and the count follows the same rule
    expect(t).toContain("Deductees: 1");
    // ...while the removed entry is still on screen, badged
    expect(t).toContain("Deleted");
    // The challan itself is unchanged — only an entry under it was deleted.
    // The card must STILL flag it, otherwise there is no way to find which of
    // ten challans holds the change.
    expect(t).toContain("1 changed");
    // and an Undo control is offered on the changed entry
    expect(document.querySelectorAll('[title^="Undo this change"]').length).toBeGreaterThan(0);
  });
});
