import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, vi, expect } from "vitest";
vi.mock("@/integrations/supabase/client", () => {
  const rowsFor = (n: string) => {
    if (n === "tds_corrections") return [{ id:"corr1",firm_id:"firm1",client_id:"c1",financial_year:"2025-26",quarter:"Q4",form_type:"26Q",status:"draft" }];
    if (n === "tds_correction_challans") return [{ id:"cch1",filing_id:"corr1",correction_id:"corr1",action:"unchanged",challan_serial_no:"88904",client_id:"c1",form_type:"26Q",financial_year:"2025-26",quarter:"Q4",total_challan_amount:509 }];
    if (n === "tds_correction_deductees") return [
      { id:"d1",filing_id:"corr1",challan_id:"cch1",correction_id:"corr1",action:"modify",client_id:"c1",
        deductee_name:"HIMANSHU ENGINEERING",tds_amount:30,total_tax_deducted:30,amount_paid_credited:3000,
        original_values:{ deductee_name:"HIMANSHU ENGINEERING",tds_amount:40,total_tax_deducted:40,amount_paid_credited:4000 } },
      { id:"d2",filing_id:"corr1",challan_id:"cch1",correction_id:"corr1",action:"add",client_id:"c1",deductee_name:"NEW PARTY" },
      { id:"d3",filing_id:"corr1",challan_id:"cch1",correction_id:"corr1",action:"delete",client_id:"c1",deductee_name:"GONE PARTY" },
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
 * "Changes vs the filed return" is ROW-WISE: one row per change, columns
 * aligned, so a correction is scanned down a single Original / Corrected pair
 * rather than read block by block.
 */
describe("changes panel", () => {
  it("renders one row per change with aligned columns", async () => {
    const { container } = render(<TdsCorrectionsModule clients={[{id:"c1",name:"Amber"}] as any} users={[]} isSuperadmin={false} resolveFirmId={async()=>"firm1"} />);
    await waitFor(() => expect(screen.getAllByTitle("Open correction").length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByTitle("Open correction")[0]);
    await new Promise(r => setTimeout(r, 700));

    const tables = Array.from(container.querySelectorAll("table"));
    const panel = tables.find(t => t.textContent?.includes("Corrected"))!;
    expect(panel).toBeTruthy();
    const hdr = Array.from(panel.querySelectorAll("thead th")).map(h => h.textContent!.trim());
    const body = Array.from(panel.querySelectorAll("tbody tr"))
      .map(tr => Array.from(tr.querySelectorAll("td")).map(td => td.textContent!.trim()));
    expect(hdr).toEqual(["Change","Type","Name","Field","Original","Corrected"]);
    // 3 modified fields + 1 added + 1 deleted = 5 rows
    expect(body.length).toBe(5);

    // Modified leads — those need the value comparison; burying them under an
    // alphabetically-earlier addition is the manual hunting this panel removes.
    expect(body[0][0]).toBe("Modified");
    expect(body[0].slice(3)).toEqual(["TDS", "40", "30"]);
    // continuation rows repeat neither badge nor name
    expect(body[1][0]).toBe("");
    expect(body[1].slice(3)).toEqual(["Total tax deducted", "40", "30"]);
    expect(body.map(r => r[0])).toEqual(["Modified", "", "", "Added", "Deleted"]);
  });
});
