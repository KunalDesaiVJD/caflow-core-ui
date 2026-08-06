/**
 * Root cause of "edits lost after hard refresh" (VJDESAI, Aug-2026): Save is
 * correctly disabled until the schedule ties to COA mapping (a server-side
 * guarantee — see save-nce-constrained-note), but the depreciation leg
 * routinely can't hit the booked figure to the rupee via the auto rate
 * formula. Untied edits were never persisted anywhere, so a refresh silently
 * reloaded the last-tied DB state with no warning. This pins the fix: dirty
 * edits mirror into a local draft (offered back on reload) and the UI shows
 * an explicit "unsaved changes" state instead of silently discarding them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(), functions: { invoke: vi.fn() } },
}));

import { supabase } from "@/integrations/supabase/client";
import { NCEPPESchedule } from "@/components/stage8/NCEPPESchedule";

function makeChain(dataIfSingle: any, dataIfArray: any) {
  const chain: any = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.order = () => chain;
  chain.range = () => chain;
  chain.single = () => Promise.resolve({ data: dataIfSingle, error: null });
  chain.maybeSingle = () => Promise.resolve({ data: dataIfSingle, error: null });
  chain.then = (resolve: any, reject: any) =>
    Promise.resolve({ data: dataIfArray, error: null }).then(resolve, reject);
  return chain;
}

const engRow = {
  financial_year: "2025-26",
  client_id: "c1",
  coa_mapping: {},
  clients: { name: "Test Co" },
  firms: {},
  partner: { name: "CA Test" },
};

function setupSupabase(ppeRows: any[] = []) {
  (supabase.from as any).mockImplementation((table: string) => {
    if (table === "audit_engagements") return makeChain(engRow, []);
    if (table === "nce_ppe_schedule") return makeChain([], ppeRows);
    if (table === "tally_trial_balance") return makeChain([], []);
    return makeChain(null, []);
  });
}

describe("NCEPPESchedule — local draft safety net", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("marks the schedule dirty and mirrors an untied edit into a local draft", async () => {
    setupSupabase([]);
    const { container } = render(<NCEPPESchedule engagementId="e1" />);

    await waitFor(() => expect(screen.getByText(/Freehold land/i)).toBeTruthy());
    expect(container.textContent || "").not.toContain("Unsaved changes");

    // First text input is Freehold land's Rate %; second is Opening Balance.
    const inputs = container.querySelectorAll('input[type="text"]');
    fireEvent.change(inputs[1], { target: { value: "50000" } });
    fireEvent.blur(inputs[1]);

    await waitFor(() => expect(container.textContent || "").toContain("Unsaved changes"));
    const draftKey = "nce_ppe_draft:e1:2025-26";
    const draft = localStorage.getItem(draftKey);
    expect(draft).toBeTruthy();
    expect(JSON.parse(draft!).some((r: any) => r.opening_balance === 50000)).toBe(true);
  });

  it("offers to restore a local draft found on reload that the DB doesn't have", async () => {
    // Seed a draft as if an earlier session left it behind (schedule never tied).
    const draftKey = "nce_ppe_draft:e1:2025-26";
    localStorage.setItem(
      draftKey,
      JSON.stringify(
        Array.from({ length: 11 }, (_, i) => ({
          sort_order: i + 1,
          asset_category: i < 6 ? "tangible" : "intangible",
          asset_name: i === 0 ? "Freehold land" : `Row ${i}`,
          rate_pct: 0,
          opening_balance: i === 0 ? 75000 : 0,
          additions_pre: 0, additions_post: 0, deletions: 0, depreciation: 0,
        })),
      ),
    );

    setupSupabase([]); // DB still has nothing saved
    render(<NCEPPESchedule engagementId="e1" />);

    await waitFor(() => expect(screen.getByText(/unsaved edits from an earlier session/i)).toBeTruthy());
    expect(screen.getByText(/Restore draft/i)).toBeTruthy();
    expect(screen.getByText(/Discard/i)).toBeTruthy();

    fireEvent.click(screen.getByText(/Restore draft/i));
    await waitFor(() => expect(screen.queryByText(/unsaved edits from an earlier session/i)).toBeNull());
  });

  it("does not show a draft banner when nothing was ever edited", async () => {
    setupSupabase([]);
    render(<NCEPPESchedule engagementId="e2" />);
    await waitFor(() => expect(screen.getByText(/Freehold land/i)).toBeTruthy());
    expect(screen.queryByText(/unsaved edits from an earlier session/i)).toBeNull();
  });
});

/**
 * Root cause of "the Save button doesn't respond to clicks" (AMBICA PLASTIC
 * INDUSTRIES, Aug-2026): SaveBtn was a locally-defined component invoked as
 * JSX, so React remounted its DOM node on every render (fixed separately).
 * Rather than depend solely on a click ever landing on a button, the
 * schedule now saves itself the moment it ties to COA mapping — this pins
 * that behaviour end-to-end with no button click involved at all.
 */
describe("NCEPPESchedule — auto-save on tie", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("saves automatically, with no button click, once an edit makes the schedule tie to COA mapping", async () => {
    const mappedEngRow = { ...engRow, coa_mapping: { Plant: { code: "NCE_PPE" } } };
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === "audit_engagements") return makeChain(mappedEngRow, []);
      if (table === "nce_ppe_schedule") return makeChain([], []);
      if (table === "tally_trial_balance")
        return makeChain([], [
          { ledger_name: "Plant", closing_balance: 1000, balance_type: "DR", opening_balance: 0, opening_type: "DR" },
        ]);
      return makeChain(null, []);
    });
    (supabase.functions.invoke as any).mockResolvedValue({ data: { ok: true }, error: null });

    const { container } = render(<NCEPPESchedule engagementId="e1" />);
    await waitFor(() => expect(screen.getByText(/Freehold land/i)).toBeTruthy());
    // Wait for the COA anchor fetch (TB → NCE_PPE ₹1,000) to land before editing,
    // so the edit below ties on the first render instead of racing the load.
    await waitFor(() => expect(container.textContent || "").toContain("1,000"));

    // Freehold land's Opening Balance — rate 0% auto-calculates depreciation to 0,
    // so ₹1,000 opening also ties the (unmapped, ₹0) NCE_DEPR anchor exactly.
    const inputs = container.querySelectorAll('input[type="text"]');
    fireEvent.change(inputs[1], { target: { value: "1000" } });
    fireEvent.blur(inputs[1]);

    await waitFor(() => expect(container.textContent || "").toContain("ready to save"));
    expect(supabase.functions.invoke).not.toHaveBeenCalled();

    // No click anywhere — the debounced auto-save effect fires on its own.
    await waitFor(
      () => expect(supabase.functions.invoke).toHaveBeenCalledWith(
        "save-nce-constrained-note",
        expect.objectContaining({
          body: expect.objectContaining({ type: "ppe", engagement_id: "e1" }),
        }),
      ),
      { timeout: 3000 },
    );
  });

  it("does not auto-save while the schedule is still untied", async () => {
    setupSupabase([]); // no coa_mapping → COA anchor is ₹0, so a non-zero edit stays untied
    (supabase.functions.invoke as any).mockResolvedValue({ data: { ok: true }, error: null });

    const { container } = render(<NCEPPESchedule engagementId="e1" />);
    await waitFor(() => expect(screen.getByText(/Freehold land/i)).toBeTruthy());

    const inputs = container.querySelectorAll('input[type="text"]');
    fireEvent.change(inputs[1], { target: { value: "50000" } });
    fireEvent.blur(inputs[1]);

    await waitFor(() => expect(container.textContent || "").toContain("Unsaved changes"));
    // Give the 1.2s debounce window a chance to have fired if it incorrectly would.
    await new Promise(r => setTimeout(r, 1500));
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });
});
