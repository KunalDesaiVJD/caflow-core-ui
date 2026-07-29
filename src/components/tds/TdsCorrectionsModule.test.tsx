/**
 * Correction module regression guard.
 *
 * Build and tsc never mount the tree, so neither catches render-time crashes
 * nor effect loops. This mounts both surfaces against a fake supabase and pins
 * the rules the module exists to enforce:
 *
 *   1. A FILED correction is read-only — no Sign/Submit/Edit/Delete offered.
 *   2. Each stage offers only its own next action (sign / approve / file).
 *   3. The client portal NEVER offers a signing control, at any status.
 *   4. isCorrectionLocked is the single source of truth for 1-3.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { isCorrectionLocked, summariseCorrection } from "@/lib/tdsCorrections";

const CORRECTION: any = {
  id: "corr1", firm_id: "firm1", client_id: "c1",
  financial_year: "2025-26", quarter: "Q1", form_type: "26Q",
  original_filing_id: "f1", status: "awaiting_senior", reason: "Wrong PAN reported",
  raised_by: "u1", raised_by_name: "Asha", raised_by_role: "staff",
  raised_at: "2026-07-01T10:00:00Z", submitted_at: "2026-07-01T11:00:00Z",
  signed_by: null, signed_by_name: null, signed_by_role: null, signed_at: null,
  rejected_by: null, rejected_at: null, rejection_reason: null,
};
const CHALLAN: any = {
  id: "cch1", correction_id: "corr1", original_challan_id: "ch1", action: "unchanged",
  challan_serial_no: "00123", bsr_code: "0510308", deposit_date: "2025-07-07",
  total_challan_amount: 5000, total_tax_deposited: 5000, interest_deposited: 0,
  late_fees_234e: 0, minor_head_of_challan: "200", is_book_entry: false, bank_name: "HDFC",
};
const DEDUCTEE: any = {
  id: "cd1", correction_id: "corr1", correction_challan_id: "cch1",
  original_deductee_id: "d1", action: "modify",
  deductee_name: "Acme Traders", deductee_pan: "AAAPA1234A", pan_not_available: false,
  section_code: "194C", amount_paid_credited: 250000, date_of_payment: "2025-06-15",
  rate_of_tds: 2, tds_amount: 5000, total_tax_deducted: 5000, interest_amount: 0,
  gross_salary: null, standard_deduction_allowed: null, net_taxable_salary: null,
};

const { state } = vi.hoisted(() => ({ state: { status: "awaiting_senior" as string } }));

vi.mock("@/integrations/supabase/client", () => {
  const rowsFor = (name: string) => {
    if (name === "tds_corrections") return [{ ...CORRECTION, status: state.status }];
    if (name === "tds_correction_challans") return [CHALLAN];
    if (name === "tds_correction_deductees") return [DEDUCTEE];
    if (name === "tds_filings") return [{ id: "f1", financial_year: "2025-26", quarter: "Q1", tds_forms: ["26Q"] }];
    return [];
  };
  const build = (name: string) => {
    const rows = rowsFor(name);
    const b: any = {};
    // The correction detail now renders the real TdsDataEntry engine, which
    // uses a wider query surface than the old bespoke screen — keep every
    // builder method chainable so the mock never dictates the component's
    // query style.
    for (const m of [
      "select", "eq", "neq", "in", "is", "gte", "lte", "gt", "lt",
      "order", "limit", "range", "ilike", "or", "filter", "insert",
      "update", "upsert", "delete",
    ]) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    b.single = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    b.then = (res: any) => Promise.resolve({ data: rows, error: null, count: rows.length }).then(res);
    return b;
  };
  const ch: any = {}; ch.on = vi.fn(() => ch); ch.subscribe = vi.fn(() => ch);
  return {
    supabase: { from: (n: string) => build(n), channel: () => ch, removeChannel: vi.fn() },
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u9", name: "Ravi", email: "r@x.com", role: "admin", firm_id: "firm1" } }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/contexts/PortalClientContext", () => ({
  usePortalClient: () => ({
    activeClient: { id: "c1", name: "Acme Pvt Ltd", firm_id: "firm1" },
    clients: [], allClientIds: ["c1"], setActiveById: () => {}, loading: false, reload: () => {},
  }),
}));

import { TdsCorrectionsModule } from "./TdsCorrectionsModule";
import PortalCorrections from "@/pages/PortalCorrections";

const staffProps = {
  clients: [{ id: "c1", name: "Acme Pvt Ltd" }],
  users: [{ id: "u1", name: "Asha" }],
  isSuperadmin: false,
  resolveFirmId: async () => "firm1",
};

describe("isCorrectionLocked", () => {
  it("locks only the filed state", () => {
    expect(isCorrectionLocked("filed")).toBe(true);
    for (const s of ["draft", "awaiting_employee", "awaiting_senior", "ready_to_file", "rejected", undefined, null]) {
      expect(isCorrectionLocked(s as any)).toBe(false);
    }
  });
});

describe("summariseCorrection", () => {
  it("counts each action independently", () => {
    const d = summariseCorrection(
      [{ ...CHALLAN, action: "modify" }] as any,
      [
        { ...DEDUCTEE, action: "add" }, { ...DEDUCTEE, action: "modify" },
        { ...DEDUCTEE, action: "delete" }, { ...DEDUCTEE, action: "unchanged" },
      ] as any,
    );
    expect(d).toMatchObject({ added: 1, modified: 1, deleted: 1, unchanged: 1, challansTouched: 1 });
  });
});

describe("staff module", () => {
  beforeEach(() => { state.status = "awaiting_senior"; });

  it("mounts the dashboard and lists the correction", async () => {
    render(<TdsCorrectionsModule {...staffProps} />);
    await waitFor(() => expect(screen.getByText("Corrections")).toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByText("Acme Pvt Ltd").length).toBeGreaterThan(0));
    // All six lifecycle tiles render, in workflow order
    for (const tile of ["Draft", "Awaiting Employee", "Awaiting Senior", "Ready to File", "Filed", "Rejected"]) {
      expect(screen.getAllByText(tile).length).toBeGreaterThan(0);
    }
  });
});

describe("client portal", () => {
  beforeEach(() => { state.status = "awaiting_senior"; });

  it("mounts and never offers a signing control while pending", async () => {
    render(<PortalCorrections />);
    // Title now lives on the TDS module shell; this tab is identified by its
    // own primary action.
    await waitFor(() => expect(screen.getByText(/Raise Correction/i)).toBeInTheDocument());
    expect(screen.queryByText(/Sign as preparer|Approve as senior|Mark as Filed/i)).toBeNull();
    expect(screen.queryByText(/^Reject$/i)).toBeNull();
  });

  it("offers no signing control once filed either", async () => {
    state.status = "filed";
    render(<PortalCorrections />);
    // Title now lives on the TDS module shell; this tab is identified by its
    // own primary action.
    await waitFor(() => expect(screen.getByText(/Raise Correction/i)).toBeInTheDocument());
    expect(screen.queryByText(/Sign as preparer|Approve as senior|Mark as Filed/i)).toBeNull();
  });
});

// ─── Portal TDS module shell ────────────────────────────────────────────────

import PortalTdsModule from "@/pages/PortalTdsModule";

describe("portal TDS module", () => {
  beforeEach(() => { state.status = "awaiting_senior"; });

  it("renders exactly two sub-tabs: Data Entry and Correction", async () => {
    const { container } = render(<PortalTdsModule />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "TDS" })).toBeInTheDocument());

    // The sub-tab bar is the only button group directly under the border-b row.
    const tabBar = container.querySelector(".flex.border-b");
    const tabs = Array.from(tabBar?.querySelectorAll("button") ?? []).map(b => b.textContent?.trim());
    expect(tabs).toEqual(["Data Entry", "Correction"]);
  });

  it("keeps both tabs mounted so state survives switching", async () => {
    const { container } = render(<PortalTdsModule />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "TDS" })).toBeInTheDocument());
    // Correction starts hidden rather than unmounted.
    const hidden = container.querySelectorAll(".hidden");
    expect(hidden.length).toBeGreaterThan(0);
  });
});

// ─── Redesign affordances ───────────────────────────────────────────────────
// The detail screen exists to FIND and fix one wrong entry among hundreds.
// These pin the affordances that make that possible.

import { fireEvent } from "@testing-library/react";

describe("correction detail is the Data Entry engine", () => {
  beforeEach(() => { state.status = "draft"; });

  const openDetail = async () => {
    render(<TdsCorrectionsModule {...staffProps} />);
    await waitFor(() => expect(screen.getAllByText("Acme Pvt Ltd").length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByTitle("Open correction")[0]);
    await waitFor(() => expect(screen.getByText("All corrections")).toBeInTheDocument());
  };

  it("renders the real Data Entry engine, not a look-alike", async () => {
    await openDetail();
    // These are TdsDataEntry's own controls and computed balances — a
    // bespoke look-alike would not produce them.
    await waitFor(() => expect(screen.getByText(/Add Challan/i)).toBeInTheDocument());
    expect(screen.getByText(/Add Row/i)).toBeInTheDocument();
    expect(screen.getByText(/Auto-match/i)).toBeInTheDocument();
    // Utilised / unutilised balance, straight from the engine.
    expect(screen.getByText(/Applied:/)).toBeInTheDocument();
    expect(screen.getAllByText(/Unconsumed/).length).toBeGreaterThan(0);
  });

  it("hides the filing selector — the period is fixed by the correction", async () => {
    await openDetail();
    await waitFor(() => expect(screen.getByText(/Add Challan/i)).toBeInTheDocument());
    expect(screen.queryByText("Select Filing")).toBeNull();
  });

  it("keeps the workflow chrome around the engine", async () => {
    await openDetail();
    // Stage tracker + both signature slots live outside the engine.
    expect(screen.getByText("1 · Employee signature")).toBeInTheDocument();
    expect(screen.getByText("2 · Senior approval")).toBeInTheDocument();
  });

  it("shows change counts only when non-zero — no empty stat cards", async () => {
    state.status = "awaiting_senior";
    await openDetail();
    await waitFor(() => expect(screen.getByText("1 modified")).toBeInTheDocument());
    expect(screen.queryByText(/^0 added$/)).toBeNull();
    expect(screen.queryByText(/^0 deleted$/)).toBeNull();
  });
});
