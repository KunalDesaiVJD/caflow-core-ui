import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

/**
 * The panel is the only surface where an auditor can approve materiality, and it sits behind auth
 * so it cannot be exercised by hand without credentials. These tests mount it against a stubbed
 * Supabase so a broken query shape, a bad render, or a regression in the approve flow fails here
 * rather than in front of a user.
 */

const clients = [{ id: "c1", name: "Accurate PMS Pvt Ltd" }, { id: "c2", name: "Small Trader" }];
const judgments = [
  {
    id: "j1", client_id: "c1", financial_year: "2025-26", status: "proposed",
    proposed: { materiality: 2_200_000, performance: 1_300_000, trivial: 110_000, benchmark: "turnover", benchmark_pct: 0.5, basis: { turnover: 440_000_000 }, rationale: "Proposed at 0.5% of turnover." },
    decided: null,
  },
  {
    id: "j2", client_id: "c2", financial_year: "2025-26", status: "proposed",
    proposed: { benchmark: "floor", materiality: 25_000, performance: 15_000, trivial: 1_300, rationale: "No usable turnover." },
    decided: null,
  },
];
const counts = [
  { client_id: "c1", financial_year: "2025-26", open_count: 655 },
  { client_id: "c2", financial_year: "2025-26", open_count: 4 },
];

const updateSpy = vi.fn();

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1", firm_id: "f1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/integrations/supabase/client", () => {
  const table = (name: string) => {
    const rows = name === "clients" ? clients : name === "scrutiny_judgments" ? judgments : counts;
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    Object.assign(chain, {
      select: self, eq: self, in: self, limit: self,
      update: (payload: unknown) => { updateSpy(payload); return { eq: () => Promise.resolve({ error: null }) }; },
      then: (res: (v: { data: unknown; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(res),
    });
    return chain;
  };
  return { supabase: { from: (n: string) => table(n) } };
});

import MaterialityQueuePanel from "./MaterialityQueuePanel";

describe("MaterialityQueuePanel", () => {
  beforeEach(() => updateSpy.mockClear());

  it("lists every engagement awaiting approval with its client name", async () => {
    render(<MaterialityQueuePanel />);
    await waitFor(() => expect(screen.getByText("Accurate PMS Pvt Ltd")).toBeTruthy());
    expect(screen.getByText("Small Trader")).toBeTruthy();
  });

  // The whole point of the queue is ordering: the engagement where approving removes the most
  // noise should be actionable first, and a proposal the system could not compute must be visible
  // as needing a human figure rather than looking like a normal suggestion.
  it("marks the floor-fallback engagement as needing the auditor's own figure", async () => {
    render(<MaterialityQueuePanel />);
    await waitFor(() => expect(screen.getByText("Needs your figure")).toBeTruthy());
    expect(screen.getByText(/no usable turnover or asset base/i)).toBeTruthy();
  });

  it("shows what drove each suggestion and the open findings behind it", async () => {
    render(<MaterialityQueuePanel />);
    await waitFor(() => expect(screen.getByText(/0.5% of turnover/)).toBeTruthy());
    expect(screen.getByText("655")).toBeTruthy();
    expect(screen.getByText("₹13,00,000")).toBeTruthy();
  });

  // Ranking check: the floor-fallback engagement (Small Trader) outranks the 655-finding one,
  // because there the system has no opinion at all and only a human can supply the figure.
  it("puts the engagement needing a human figure at the top of the queue", async () => {
    render(<MaterialityQueuePanel />);
    await waitFor(() => expect(screen.getByText("Accurate PMS Pvt Ltd")).toBeTruthy());
    const names = screen.getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
    expect(names[0]).toContain("Small Trader");
    expect(names[1]).toContain("Accurate PMS Pvt Ltd");
  });

  it("opens an editor prefilled with the suggestion, and approves it", async () => {
    render(<MaterialityQueuePanel />);
    await waitFor(() => expect(screen.getByText("Accurate PMS Pvt Ltd")).toBeTruthy());
    // Second Review button = Accurate PMS, since the floor engagement sorts first.
    fireEvent.click(screen.getAllByRole("button", { name: /review/i })[1]);

    await waitFor(() => expect(screen.getByLabelText(/overall materiality/i)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalled());
    const payload = updateSpy.mock.calls[0][0] as { status: string; decided: { performance: number }; decided_by: string };
    expect(payload.status).toBe("approved");
    expect(payload.decided.performance).toBe(1_300_000);
    expect(payload.decided_by).toBe("u1");
  });

  // A trivial threshold at or above performance materiality would silently suppress everything the
  // performance level exists to catch, so the form must refuse to save it.
  it("blocks approval when the edited figures are not ordered", async () => {
    render(<MaterialityQueuePanel />);
    await waitFor(() => expect(screen.getByText("Accurate PMS Pvt Ltd")).toBeTruthy());
    fireEvent.click(screen.getAllByRole("button", { name: /review/i })[0]);
    await waitFor(() => expect(screen.getByLabelText(/clearly trivial/i)).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/clearly trivial/i), { target: { value: "9000000" } });
    expect(screen.getByText(/must sit below performance materiality/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
