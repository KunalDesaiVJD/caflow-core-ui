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
    expect(screen.getByText(/5,000/)).toBeTruthy();
    expect(screen.getByText(/FS Health:/i)).toBeTruthy(); // normal panel still renders
  });

  it("shows a CY · PY sub-line when both columns are off", () => {
    render(<FsHealthPanel {...baseProps} bsResidual={{ cy: 5000, py: 3000 }} />);
    expect(screen.getByText(/CY ₹5,000 · PY ₹3,000/)).toBeTruthy();
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
