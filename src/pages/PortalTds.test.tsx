/**
 * PortalTds regression guard.
 *
 * Build + tsc never mount the tree, so neither catches render-time crashes nor
 * effect loops. This mounts the page against a fake supabase + portal context
 * and pins the two properties the portal TDS view exists to guarantee:
 *
 *   1. READ-ONLY — the page paints the firm's data and renders no input.
 *   2. LIVE + SCOPED — it subscribes to all three Data Entry tables, and every
 *      subscription is filtered to the active entity.
 *
 * It also catches the fetch→setState→fetch loop that an effect keyed on the
 * activeClient OBJECT (rather than its id) reintroduces — that version OOMs
 * this test instead of silently hanging a client's browser.
 *
 * Since PortalTds.tsx reads through getEffectiveClientLedger() (correction-
 * aware — see that fetchDetail's own doc), the mock supabase client below
 * does REAL .eq()/.in() filtering, not a no-op — otherwise the {archived:
 * false} and {archived: true} ledger calls would return identical
 * (duplicated) rows, since both share the exact same underlying query shape
 * apart from the is_archived value.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const FILING = {
  id: "f1", client_id: "c1", financial_year: "2025-26", quarter: "Q1",
  tds_forms: ["26Q"], work_status: "Under Process",
  date_of_filing: null, acknowledgment_number: null,
};
const CHALLAN = {
  id: "ch1", client_id: "c1", is_archived: false, financial_year: "2025-26", quarter: "Q1",
  form_type: "26Q", bsr_code: "0510308", challan_serial_no: "00123",
  deposit_date: "2025-07-07", total_tax_deposited: 5000, interest_deposited: 0,
  late_fees_234e: 0, total_challan_amount: 5000, minor_head_of_challan: "200",
  is_book_entry: false, bank_name: "HDFC Bank",
};
const DEDUCTEE = {
  id: "d1", client_id: "c1", financial_year: "2025-26", quarter: "Q1",
  challan_id: "ch1", form_type: "26Q", deductee_name: "Acme Traders",
  deductee_pan: "AAAPA1234A", pan_not_available: false, deductee_type: "Company",
  section_code: "194C", amount_paid_credited: 250000, date_of_payment: "2025-06-15",
  rate_of_tds: 2, tds_amount: 5000, total_tax_deducted: 5000, interest_amount: 0,
  reason_for_lower_or_nil_deduction: null,
  gross_salary: null, standard_deduction_allowed: null, net_taxable_salary: null,
};
// A COMBINED-PAYMENT challan: created under 24Q's Genius import (so its own
// form_type is "24Q"), but reused for a 26Q deductee too — the exact scenario
// TdsDataEntry.tsx's "A COMBINED PAYMENT" fetch fix handles. Filtering
// challans strictly by period/form would drop it; PortalTds.tsx's
// fetchDetail finds it via the deductee side instead, from the SAME full
// client ledger (no extra query needed).
const SHARED_CHALLAN = {
  id: "ch2", client_id: "c1", is_archived: false, financial_year: "2025-26", quarter: "Q1",
  form_type: "24Q", bsr_code: "0510309", challan_serial_no: "00456",
  deposit_date: "2025-07-08", total_tax_deposited: 8000, interest_deposited: 0,
  late_fees_234e: 0, total_challan_amount: 8000, minor_head_of_challan: "200",
  is_book_entry: false, bank_name: "HDFC Bank",
};
const SHARED_DEDUCTEE = {
  id: "d2", client_id: "c1", financial_year: "2025-26", quarter: "Q1",
  challan_id: "ch2", form_type: "26Q", deductee_name: "Beta Supplies",
  deductee_pan: "BBBPB5678B", pan_not_available: false, deductee_type: "Company",
  section_code: "194J", amount_paid_credited: 400000, date_of_payment: "2025-06-20",
  rate_of_tds: 2, tds_amount: 8000, total_tax_deducted: 8000, interest_amount: 0,
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
    let data: any[] =
      name === "tds_filings" ? [FILING]
      : name === "tds_challans" ? [CHALLAN, SHARED_CHALLAN]
      : name === "tds_deductees" ? [DEDUCTEE, SHARED_DEDUCTEE]
      : []; // tds_corrections and friends — no filed corrections in this fixture set
    const builder: any = {
      select: () => builder,
      eq: (col: string, val: any) => { data = data.filter((r: any) => r[col] === val); return builder; },
      in: (col: string, vals: any[]) => { data = data.filter((r: any) => vals.includes(r[col])); return builder; },
      order: () => builder,
      then: (res: any) => Promise.resolve({ data, error: null }).then(res),
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
      // The page title now lives on the TDS module shell; this tab is
      // identified by its own read-only affordance.
      expect(screen.getByText("View only")).toBeInTheDocument();
    });

    // Deductee row reached the DOM
    await waitFor(() => {
      expect(screen.getByText("Acme Traders")).toBeInTheDocument();
    });
    expect(screen.getByText("AAAPA1234A")).toBeInTheDocument();
    expect(screen.getByText("194C")).toBeInTheDocument();

    // Challan header
    expect(screen.getByText(/Challan 00123/)).toBeInTheDocument();

    // Combined-payment challan (own form_type "24Q", only reachable via the
    // deductee side) still surfaces on this 26Q screen, along with its row —
    // it must not silently vanish just because its own form_type differs and
    // it isn't covered by a period-only filter.
    expect(screen.getByText(/Challan 00456/)).toBeInTheDocument();
    expect(screen.getByText("Beta Supplies")).toBeInTheDocument();

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
