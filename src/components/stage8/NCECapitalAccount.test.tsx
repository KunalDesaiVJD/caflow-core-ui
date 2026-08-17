/**
 * Phase 2 (VADIWALA / RAY WINGS TECHNOLOGY, Prop.): the Capital Account note
 * was built for Partnership/LLP only — Share %, Remuneration, and Interest
 * columns don't apply to a sole proprietor. Pins that Proprietorship gets the
 * simplified layout while Partnership/LLP keep the full one, driven by
 * engagement.entity_type (falling back to clients.entity_type).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn() },
}));

import { supabase } from "@/integrations/supabase/client";
import { NCECapitalAccount } from "@/components/stage8/NCECapitalAccount";

function makeChain(dataIfSingle: any, dataIfArray: any) {
  const chain: any = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.order = () => chain;
  chain.range = () => chain;
  chain.single = () => Promise.resolve({ data: dataIfSingle, error: null });
  chain.then = (resolve: any, reject: any) =>
    Promise.resolve({ data: dataIfArray, error: null }).then(resolve, reject);
  return chain;
}

function setupSupabase(engRow: any) {
  (supabase.from as any).mockImplementation((table: string) => {
    if (table === "audit_engagements") return makeChain(engRow, []);
    if (table === "tally_trial_balance") return makeChain([], []);
    if (table === "nce_capital_account") return makeChain([], []);
    return makeChain(null, []);
  });
}

const baseEng = {
  financial_year: "2025-26",
  client_id: "c1",
  coa_mapping: {},
  firms: {},
  partner: { name: "CA Test" },
};

describe("NCECapitalAccount — entity-subtype column set", () => {
  it("Proprietorship: hides Share %, Remuneration, Interest and uses simplified labels", async () => {
    setupSupabase({ ...baseEng, entity_type: "Proprietorship", clients: { name: "Test Prop", entity_type: "Proprietorship" } });
    const { container } = render(<NCECapitalAccount engagementId="e1" />);

    await waitFor(() => expect(screen.getByText(/Proprietor's Name/i)).toBeTruthy());

    const text = container.textContent || "";
    expect(text).toContain("Note: Capital Account");
    expect(text).not.toContain("Note: Owners Capital Account");
    expect(text).not.toContain("Name of Partner");
    expect(text).not.toMatch(/Share of profit\/\s*\(loss\)%/i);
    expect(text).not.toContain("Remuneration for the year");
    expect(text).not.toContain("Interest for the year");
    expect(text).not.toContain("Add Partner");
    // Closing formula footnote should not mention Remuneration/Interest either
    expect(text).not.toMatch(/Remuneration \+ Interest/i);
  });

  it("Partnership: keeps Share %, Remuneration, Interest and 'Add Partner'", async () => {
    setupSupabase({ ...baseEng, entity_type: "Partnership", clients: { name: "Test Firm", entity_type: "Partnership" } });
    const { container } = render(<NCECapitalAccount engagementId="e2" />);

    await waitFor(() => expect(screen.getByText(/Name of Partner/i)).toBeTruthy());

    const text = container.textContent || "";
    expect(text).toContain("Note: Owners Capital Account");
    expect(text).toMatch(/Share of profit\/\s*\(loss\)%/i);
    expect(text).toContain("Remuneration for the year");
    expect(text).toContain("Interest for the year");
    expect(text).toContain("Add Partner");
  });

  it("falls back to clients.entity_type when the engagement's own entity_type is absent", async () => {
    setupSupabase({ ...baseEng, entity_type: null, clients: { name: "Test Prop 2", entity_type: "Proprietorship" } });
    const { container } = render(<NCECapitalAccount engagementId="e3" />);

    await waitFor(() => expect(screen.getByText(/Proprietor's Name/i)).toBeTruthy());
    expect(container.textContent || "").not.toMatch(/Share of profit\/\s*\(loss\)%/i);
  });
});

describe("NCECapitalAccount — LLP Fixed Capital / Current Capital split", () => {
  it("renders linked Fixed Capital and Current Capital sub-tables with Total (A)/(B)", async () => {
    setupSupabase({ ...baseEng, entity_type: "LLP", clients: { name: "Test LLP", entity_type: "LLP" } });
    const { container } = render(<NCECapitalAccount engagementId="e4" />);

    await waitFor(() => expect(screen.getByText(/Name of Partner/i)).toBeTruthy());

    const text = container.textContent || "";
    expect(text).toContain("(A) Fixed Capital");
    expect(text).toContain("(B) Current Capital");
    expect(text).toContain("Total (A)");
    expect(text).toContain("Total (B)");
    // Partnership/LLP columns are still present (LLP is never Proprietorship).
    expect(text).toContain("Remuneration for the year");
    expect(text).toContain("Interest for the year");
  });

  it("keeps the partner name in sync between Fixed Capital and Current Capital", async () => {
    setupSupabase({ ...baseEng, entity_type: "LLP", clients: { name: "Test LLP", entity_type: "LLP" } });
    render(<NCECapitalAccount engagementId="e5" />);

    await waitFor(() => expect(screen.getByText(/Name of Partner/i)).toBeTruthy());

    // Two "Partner 1" inputs exist: Fixed Capital (rendered first) and Current
    // Capital. Editing either one should propagate the name to the other.
    const inputsBefore = screen.getAllByPlaceholderText("Partner 1") as HTMLInputElement[];
    expect(inputsBefore).toHaveLength(2);

    fireEvent.change(inputsBefore[0], { target: { value: "Jane Partner" } });

    await waitFor(() => {
      const synced = screen.getAllByDisplayValue("Jane Partner");
      expect(synced).toHaveLength(2);
    });
  });
});
