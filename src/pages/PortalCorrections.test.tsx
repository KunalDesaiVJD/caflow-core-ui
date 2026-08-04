/**
 * PortalCorrections regression guard.
 *
 * PortalCorrectionDetail computed a "__unlinked__" bucket of deductee rows
 * (correction_challan_id === null) but never rendered it anywhere, and had no
 * empty-state message when a correction had zero challans. The
 * Added/Modified/Deleted stat cards (driven by the full deductees array
 * regardless of challan linkage) could show real counts while the actual
 * entries were invisible below — the same failure mode PortalTds.tsx had for
 * combined-payment challans. This pins that the unlinked section now renders.
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const CORRECTION = {
  id: "corr1", client_id: "c1", firm_id: "firm1",
  financial_year: "2025-26", quarter: "Q1", form_type: "26Q",
  status: "draft", reason: "Missed a deductee", raised_at: "2025-07-01T00:00:00Z",
  approved_by_name: null, approved_at: null, signed_by_name: null, signed_at: null,
  rejection_reason: null,
};
const CHALLAN = {
  id: "cc1", correction_id: "corr1", original_challan_id: "ch1", action: "unchanged",
  challan_serial_no: "00123", deposit_date: "2025-07-07", total_challan_amount: 5000,
};
const LINKED_DEDUCTEE = {
  id: "cd1", correction_id: "corr1", correction_challan_id: "cc1", action: "unchanged",
  deductee_name: "Acme Traders", deductee_pan: "AAAPA1234A", pan_not_available: false,
  section_code: "194C", amount_paid_credited: 250000, tds_amount: 5000, total_tax_deducted: 5000,
};
// The bug: an entry not linked to any challan in this correction (e.g. added
// fresh, or its challan wasn't part of the snapshot) — grouped into
// byChallan's "__unlinked__" key but that key was never read in the JSX.
const UNLINKED_DEDUCTEE = {
  id: "cd2", correction_id: "corr1", correction_challan_id: null, action: "add",
  deductee_name: "Gamma Consulting", deductee_pan: "GGGPG9999G", pan_not_available: false,
  section_code: "194J", amount_paid_credited: 100000, tds_amount: 10000, total_tax_deducted: 10000,
};

const { channelObj, removeChannel } = vi.hoisted(() => {
  const ch: any = {};
  ch.on = vi.fn(() => ch);
  ch.subscribe = vi.fn(() => ch);
  return { channelObj: ch, removeChannel: vi.fn() };
});

vi.mock("@/integrations/supabase/client", () => {
  const table = (name: string) => {
    let single = false;
    const builder: any = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: () => { single = true; return builder; },
      then: (res: any) => {
        let rows: any[];
        if (name === "tds_corrections") rows = [CORRECTION];
        else if (name === "tds_correction_challans") rows = [CHALLAN];
        else if (name === "tds_correction_deductees") rows = [LINKED_DEDUCTEE, UNLINKED_DEDUCTEE];
        else rows = [];
        const result = single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null };
        return Promise.resolve(result).then(res);
      },
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

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Client User", email: "client@acme.com", role: "client" } }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/contexts/PortalClientContext", () => ({
  usePortalClient: () => ({
    activeClient: { id: "c1", name: "Acme Pvt Ltd", firm_id: "firm1" },
    clients: [], allClientIds: ["c1"], setActiveById: () => {},
    loading: false, reload: () => {},
  }),
}));

import PortalCorrections from "./PortalCorrections";

describe("PortalCorrections detail render check", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows both the linked challan's rows AND the unlinked-entries section", async () => {
    render(<PortalCorrections />);

    await waitFor(() => {
      expect(screen.getByText(/Missed a deductee/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/Missed a deductee/));

    // Linked entry, under its challan card
    await waitFor(() => {
      expect(screen.getByText("Acme Traders")).toBeInTheDocument();
    });
    expect(screen.getByText(/Challan 00123/)).toBeInTheDocument();

    // Unlinked entry — this is the regression: it must not silently vanish
    expect(screen.getByText("Gamma Consulting")).toBeInTheDocument();
    expect(screen.getByText("Not linked to a challan")).toBeInTheDocument();
  });
});
