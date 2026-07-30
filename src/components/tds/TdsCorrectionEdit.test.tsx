import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, vi, expect } from "vitest";

// Mutable store so an UPDATE really changes what the next SELECT returns —
// and so we can simulate the DB trigger setting action/original_values.
const { db } = vi.hoisted(() => ({ db: { ded: [] as any[] } }));

vi.mock("@/integrations/supabase/client", () => {
  db.ded = [{ id:"d1",filing_id:"corr1",challan_id:"cch1",correction_id:"corr1",action:"unchanged",
    client_id:"c1",deductee_name:"HIMANSHU",deductee_pan:"AMWPT3548E",section_code:"194C",
    amount_paid_credited:50900,total_tax_deducted:509,tds_amount:509,interest_amount:0 }];
  const rowsFor = (n: string) => {
    if (n === "tds_corrections") return [{ id:"corr1",firm_id:"firm1",client_id:"c1",financial_year:"2025-26",quarter:"Q4",form_type:"26Q",status:"draft" }];
    if (n === "tds_correction_challans") return [{ id:"cch1",filing_id:"corr1",correction_id:"corr1",action:"unchanged",challan_serial_no:"88904",client_id:"c1",form_type:"26Q",financial_year:"2025-26",quarter:"Q4",total_challan_amount:509 }];
    if (n === "tds_correction_deductees") return db.ded;
    return [];
  };
  const build = (n: string) => {
    const b: any = {}; let pending: any = null;
    for (const m of ["select","eq","neq","in","is","gte","lte","gt","lt","order","limit","range","ilike","or","filter","insert","upsert","delete"]) b[m]=()=>b;
    b.update = (u: any) => {
      if (n === "tds_correction_deductees") {
        const row = db.ded[0];
        // what the DB triggers do:
        if (row.action === "unchanged") { row.original_values = { ...row }; row.action = "modify"; }
        Object.assign(row, u);
        pending = row;
      }
      return b;
    };
    b.maybeSingle=()=>Promise.resolve({data: pending ?? rowsFor(n)[0] ?? null, error:null});
    b.single=()=>Promise.resolve({data: pending ?? rowsFor(n)[0] ?? null, error:null});
    b.then=(r:any)=>Promise.resolve({data: rowsFor(n), error:null, count: rowsFor(n).length}).then(r);
    return b;
  };
  const ch: any={}; ch.on=vi.fn(()=>ch); ch.subscribe=vi.fn(()=>ch);
  return { supabase: { from:(n:string)=>build(n), channel:()=>ch, removeChannel:vi.fn() } };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id:"u9",name:"Ravi",role:"admin",firm_id:"firm1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
import { TdsCorrectionsModule } from "@/components/tds/TdsCorrectionsModule";

/**
 * An edit must be VISIBLE immediately.
 *
 * action and original_values are written by DB triggers, so merging only the
 * fields the client sent leaves the row looking untouched — Change column "—"
 * and "No changes yet" — until a full reload. That was a real bug; this pins
 * the fix (return the stored row, and re-read the parent's summary).
 */
describe("editing a correction entry", () => {
  it("marks the row Modified and updates the summary without a reload", async () => {
    render(<TdsCorrectionsModule clients={[{id:"c1",name:"Amber"}] as any} users={[]} isSuperadmin={false} resolveFirmId={async()=>"firm1"} />);
    await waitFor(() => expect(screen.getAllByTitle("Open correction").length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByTitle("Open correction")[0]);
    await new Promise(r => setTimeout(r, 800));

    expect(document.body.textContent).toContain("No changes yet");

    // Edit the amount, exactly as the grid does (blur commits).
    const amount = document.querySelector('input[value="50900"]') as HTMLInputElement;
    expect(amount).toBeTruthy();
    fireEvent.change(amount, { target: { value: "60000" } });
    fireEvent.blur(amount);

    await waitFor(() => {
      expect(screen.getAllByText("Modified").length).toBeGreaterThan(0);
    }, { timeout: 3000 });

    // ...and the grid must NOT have been rebuilt to show it. If the refresh
    // went through the loading branch, the detail unmounts behind a skeleton
    // and this exact node would be detached — which is what made the screen
    // flash and lose the user's place on every edit.
    expect(amount.isConnected).toBe(true);
    // and the summary stops claiming nothing changed
    await waitFor(() => expect(document.body.textContent).not.toContain("No changes yet"));
  });
});
