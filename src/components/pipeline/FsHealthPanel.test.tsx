import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import FsHealthPanel from "@/components/pipeline/FsHealthPanel";

const okResult = { rows: [], allOk: true, severeCount: 0, minorCount: 0, computedAt: "2026-06-17" };

const baseProps = {
  engagementId: "e1",
  bsFaceCy: {} as Record<string, number>,
  bsFacePy: {} as Record<string, number>,
  visible: true,
  precomputedResult: okResult as any,
};

describe("FsHealthPanel — Phase 5 BS-imbalance surfacing", () => {
  it("renders the red imbalance row when bsResidual exceeds tolerance, alongside the normal panel", () => {
    render(<FsHealthPanel {...baseProps} bsResidual={{ cy: 5000, py: 0 }} />);
    expect(screen.getByText(/Balance Sheet does not balance/i)).toBeTruthy();
    expect(screen.getAllByText(/5,000/).length).toBeGreaterThan(0);
    expect(screen.getByText(/FS Health:/i)).toBeTruthy(); // normal panel still renders
  });

  it("shows a CY · PY sub-line when both columns are off", () => {
    render(<FsHealthPanel {...baseProps} bsResidual={{ cy: 5000, py: 3000 }} />);
    expect(screen.getByText(/CY ₹5,000 · PY ₹3,000/)).toBeTruthy();
  });

  it("BUG-100: shows the CY · PY sub-line even when only ONE year is off", () => {
    render(<FsHealthPanel {...baseProps} bsResidual={{ cy: 5000, py: 0 }} />);
    expect(screen.getByText(/CY ₹5,000 · PY ₹0/)).toBeTruthy();
  });

  it("does NOT render the imbalance row when balanced (residual 0)", () => {
    render(<FsHealthPanel {...baseProps} bsResidual={{ cy: 0, py: 0 }} />);
    expect(screen.queryByText(/Balance Sheet does not balance/i)).toBeNull();
  });

  it("ignores sub-tolerance noise (≤ ₹2)", () => {
    render(<FsHealthPanel {...baseProps} bsResidual={{ cy: 1, py: -2 }} />);
    expect(screen.queryByText(/Balance Sheet does not balance/i)).toBeNull();
  });

  it("does NOT throw and still surfaces the imbalance when precomputedResult is null", () => {
    // The adversarial null-deref guard: the imbalance row must render without the
    // result-dependent panel throwing.
    expect(() =>
      render(<FsHealthPanel {...baseProps} precomputedResult={null} nceNotesByType={{}} bsResidual={{ cy: 7000, py: 0 }} />),
    ).not.toThrow();
    expect(screen.getByText(/Balance Sheet does not balance/i)).toBeTruthy();
  });

  it("Corporate path (bsResidual null) renders no imbalance row", () => {
    render(<FsHealthPanel {...baseProps} bsResidual={null} />);
    expect(screen.queryByText(/Balance Sheet does not balance/i)).toBeNull();
  });

  it("hides entirely when not visible", () => {
    const { container } = render(<FsHealthPanel {...baseProps} visible={false} bsResidual={{ cy: 9999, py: 0 }} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("FsHealthPanel — PD-2/BUG-087 manual-vs-drift labelling", () => {
  const manualRow = (manualVerified: boolean) => ({
    code: "NCE_TP", noteType: "trade_payables", label: "Trade Payables",
    coaTotal: { cy: 100, py: 0 }, noteTotal: { cy: 5100, py: 0 },
    bsFace: { cy: 5100, py: 0 }, manualDelta: { cy: 5000, py: 0 },
    delta: { cy: 0, py: 0 }, status: "manual", manualVerified,
  });

  it("flags an unverified 'manual' row (no backing manual customRow) as an unexplained difference", () => {
    const res = { rows: [manualRow(false)], allOk: true, severeCount: 0, minorCount: 0, computedAt: "2026-06-19" };
    const { container } = render(<FsHealthPanel {...baseProps} precomputedResult={res as any} bsResidual={null} />);
    expect(container.textContent).toMatch(/unexplained difference/i);
    expect(container.textContent).not.toMatch(/audit additions/i);
  });

  it("keeps a verified 'manual' row labelled as an audit addition", () => {
    const res = { rows: [manualRow(true)], allOk: true, severeCount: 0, minorCount: 0, computedAt: "2026-06-19" };
    const { container } = render(<FsHealthPanel {...baseProps} precomputedResult={res as any} bsResidual={null} />);
    expect(container.textContent).toMatch(/with manual adjustment/i);
    expect(container.textContent).not.toMatch(/unexplained difference/i);
  });
});
