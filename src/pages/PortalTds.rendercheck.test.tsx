/**
 * THROWAWAY render check — deleted after running.
 *
 * Build + tsc do not mount the tree, so neither catches render-time crashes
 * (see the Radix asChild class of bug). This mounts PortalTds against a fake
 * supabase + portal context and asserts it paints real rows.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const FILING = {
  id: "f1", client_id: "c1", financial_year: "2025-26", quarter: "Q1",
  tds_forms: ["26Q"], work_status: "Under Process",
  date_of_filing: null, acknowledgment_number: null,
};
const CHALLAN = {
  id: "ch1", form_type: "26Q", bsr_code: "0510308", challan_serial_no: "00123",
  deposit_date: "2025-07-07", total_tax_deposited: 5000, interest_deposited: 0,
  late_fees_234e: 0, total_challan_amount: 5000, minor_head_of_challan: "200",
  is_book_entry: false, bank_name: "HDFC Bank",
};
const DEDUCTEE = {
  id: "d1", challan_id: "ch1", form_type: "26Q", deductee_name: "Acme Traders",
  deductee_pan: "AAAPA1234A", pan_not_available: false, deductee_type: "Company",
  section_code: "194C", amount_paid_credited: 250000, date_of_payment: "2025-06-15",
  rate_of_tds: 2, tds_amount: 5000, total_tax_deducted: 5000, interest_amount: 0,
  reason_for_lower_or_nil_deduction: null,
  gross_salary: null, standard_deduction_allowed: null, net_taxable_salary: null,
};

// vi.mock factories are hoisted above module scope — anything they touch must
// be created inside vi.hoisted, not as a plain top-level const.
const { channelObj, removeChannel } = vi.hoisted(() => {
  const ch: any = {};
  ch.on = vi.fn(() => ch);
  ch.subscribe = vi.fn(() => ch);
  return { channelObj: ch, removeChannel: vi.fn() };
});

vi.mock("@/integrations/supabase/client", () => {
  const table = (name: string) => {
    const rows = name === "tds_filings" ? [FILING]
      : name === "tds_challans" ? [CHALLAN]
      : name === "tds_deductees" ? [DEDUCTEE] : [];
    const builder: any = {
      select: () => builder,
      eq: () => builder,
      then: (res: any) => Promise.resolve({ data: rows, error: null }).then(res),
    };
    return builder;
  };
  return {
    supabase: {
      from: (name: string) => table(name),
      channel: () => channelObj,
      removeChannel,
    },
  };
});

vi.mock("@/contexts/PortalClientContext", () => ({
  usePortalClient: () => ({
    activeClient: { id: "c1", name: "Acme Pvt Ltd", firm_id: "firm1" },
    clients: [], allClientIds: ["c1"], setActiveById: () => {},
    loading: false, reload: () => {},
  }),
}));

import PortalTds from "./PortalTds";

describe("PortalTds render check", () => {
  beforeEach(() => vi.clearAllMocks());

  it("mounts and paints the client's own challan + deductee rows", async () => {
    render(<PortalTds />);

    await waitFor(() => {
      expect(screen.getByText("TDS Workspace")).toBeInTheDocument();
    });

    // Deductee row reached the DOM
    await waitFor(() => {
      expect(screen.getByText("Acme Traders")).toBeInTheDocument();
    });
    expect(screen.getByText("AAAPA1234A")).toBeInTheDocument();
    expect(screen.getByText("194C")).toBeInTheDocument();

    // Challan header
    expect(screen.getByText(/Challan 00123/)).toBeInTheDocument();

    // Read-only affordance is present
    expect(screen.getByText("View only")).toBeInTheDocument();

    // Not one editable control on the page
    expect(document.querySelectorAll("input, textarea").length).toBe(0);
  });

  it("subscribes to the three Data Entry tables for live updates", async () => {
    render(<PortalTds />);
    await waitFor(() => expect(channelObj.on).toHaveBeenCalled());
    const tables = channelObj.on.mock.calls.map((c: any[]) => c[1].table);
    expect(tables).toContain("tds_filings");
    expect(tables).toContain("tds_challans");
    expect(tables).toContain("tds_deductees");
    // every subscription is scoped to the active entity
    const filters = channelObj.on.mock.calls.map((c: any[]) => c[1].filter);
    expect(filters.every((f: string) => f === "client_id=eq.c1")).toBe(true);
  });
});
