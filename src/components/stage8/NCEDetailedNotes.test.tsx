/**
 * Regression test for the "Trade Receivable" caption-locked bug (reported by
 * VJDESAI, Aug-2026): a 2026-06-17 fix locked every static Schedule-III note
 * caption (e.g. "Unsecured, considered good" under Note 18: Trade
 * Receivables) as read-only, intending to protect only the FIGURES from
 * drifting. It over-applied the lock to the row's NAME as well, so auditors
 * could no longer rename a caption at all — even though renaming is
 * display-only (writes to `labelOverrides`, keyed by the row's stable id;
 * every total/export still reads the real id) and cannot affect any figure.
 *
 * Fix: the caption Input is editable again (handleChangeStaticLabel writes
 * labelOverrides + schedules the existing total-preserving label-only
 * persist path); the amount cell for the same row stays disabled — proving
 * figures remain locked while only the caption re-opened.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn() },
}));
vi.mock("@/lib/nceAutoPopulate", async () => {
  const actual: any = await vi.importActual("@/lib/nceAutoPopulate");
  return { ...actual, nceAutoPopulate: vi.fn(async (_engagementId: string, built: any) => built) };
});

import { supabase } from "@/integrations/supabase/client";
import { NCEDetailedNotes } from "@/components/stage8/NCEDetailedNotes";

function makeChain(dataIfSingle: any, dataIfArray: any) {
  const chain: any = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.order = () => chain;
  chain.update = () => chain;
  chain.insert = () => Promise.resolve({ data: null, error: null });
  chain.upsert = () => Promise.resolve({ data: null, error: null });
  chain.single = () => Promise.resolve({ data: dataIfSingle, error: null });
  chain.maybeSingle = () => Promise.resolve({ data: dataIfSingle, error: null });
  chain.then = (resolve: any, reject: any) =>
    Promise.resolve({ data: dataIfArray, error: null }).then(resolve, reject);
  return chain;
}

const engRow = { financial_year: "2025-26", notes_finalized: false, clients: { name: "Test Co" } };
// Trade Receivables note, seeded so "Unsecured, considered good" (ka_unsecured) carries a figure.
const tradeReceivablesRow = {
  note_type: "trade_receivables",
  cy_data: { ka_unsecured: 125000 },
  py_data: { ka_unsecured: 100000 },
};

function setupSupabase() {
  (supabase.from as any).mockImplementation((table: string) => {
    if (table === "audit_engagements") return makeChain(engRow, []);
    if (table === "nce_financial_notes") return makeChain({ id: "note-1", cy_data: tradeReceivablesRow.cy_data }, [tradeReceivablesRow]);
    return makeChain(null, []);
  });
}

function renderNotes(engagementId: string) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NCEDetailedNotes engagementId={engagementId} />
    </QueryClientProvider>,
  );
}

describe("NCEDetailedNotes — static caption is renameable, figures stay locked", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("lets the auditor rename a Schedule-III row caption while its amount input stays disabled", async () => {
    setupSupabase();
    const { container } = renderNotes("e1");

    await waitFor(() => expect(container.textContent || "").toContain("Trade Receivables"));
    fireEvent.click(screen.getByTitle(/Expand all note cards/i));
    // "Unsecured, considered good" is a caption shared by several NCE notes
    // (Trade Receivables, Loans & Advances, …), so disambiguate by finding the
    // instance whose row also carries the seeded CY amount input
    // (value="1,25,000") — that's Trade Receivables' ka_unsecured row. The
    // amount itself is an <input value=...>, invisible to getByText, so it's
    // located via querySelector instead.
    await waitFor(() => expect(screen.getAllByDisplayValue("Unsecured, considered good").length).toBeGreaterThan(0), { timeout: 5000 });
    const captionCandidates = screen.getAllByDisplayValue("Unsecured, considered good") as HTMLInputElement[];
    let row: HTMLTableRowElement | undefined;
    let captionInput: HTMLInputElement | undefined;
    for (const input of captionCandidates) {
      const r = input.closest("tr");
      if (r && r.querySelector('input[value="1,25,000"]')) { row = r; captionInput = input; break; }
    }
    expect(row).toBeTruthy();
    expect(captionInput).toBeTruthy();
    expect(captionInput!.readOnly).toBe(false);

    fireEvent.change(captionInput!, { target: { value: "Trade Receivables — Related Parties" } });
    await waitFor(() => expect(captionInput!.value).toBe("Trade Receivables — Related Parties"));

    // The amount cell for the SAME row must still be locked — only the caption re-opened.
    const amountInputsInRow = row!.querySelectorAll("input[disabled]");
    expect(amountInputsInRow.length).toBeGreaterThan(0);

    // The debounced (600ms) label-only persist should fire and write the rename
    // — via persistNoteLabels, which overlays only _label_overrides onto the
    // existing DB row so every figure key is carried through byte-identical.
    await waitFor(() => {
      const calls = (supabase.from as any).mock.calls.filter((c: any[]) => c[0] === "nce_financial_notes");
      expect(calls.length).toBeGreaterThan(1); // initial load select + the label-persist round-trip
    }, { timeout: 2000 });
  });
});
