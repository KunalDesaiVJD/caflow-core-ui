import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorTypeBreakdown, filterByErrorType } from "./ErrorTypeBreakdown";

interface Row { id: string; result: string }
const row = (id: string, result: string): Row => ({ id, result });
const getType = (r: Row) => r.result;

describe("ErrorTypeBreakdown — auto-discovered error-type chips", () => {
  it("renders nothing when fewer than 2 distinct types are present", () => {
    const { container } = render(
      <ErrorTypeBreakdown rows={[row("1", "Date Mismatch")]} getType={getType} activeType={null} onSelectType={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for an empty list", () => {
    const { container } = render(
      <ErrorTypeBreakdown rows={[]} getType={getType} activeType={null} onSelectType={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("auto-discovers every distinct type present, with counts, most-frequent first", () => {
    const rows = [
      row("1", "Date Mismatch"), row("2", "Ledger Entry Not Found"), row("3", "Ledger Entry Not Found"),
      row("4", "Ledger Entry Not Found"), row("5", "Credit Amount Mismatch"),
    ];
    render(<ErrorTypeBreakdown rows={rows} getType={getType} activeType={null} onSelectType={() => {}} />);
    expect(screen.getByText("All Records (5)")).toBeTruthy();
    expect(screen.getByText("Ledger Entry Not Found (3)")).toBeTruthy();
    expect(screen.getByText("Date Mismatch (1)")).toBeTruthy();
    expect(screen.getByText("Credit Amount Mismatch (1)")).toBeTruthy();
  });

  it("picks up a BRAND NEW type nobody wrote UI for — auto-discovery, not a hardcoded list", () => {
    const rows = [row("1", "Never Seen Before Status"), row("2", "Matched-ish")];
    render(<ErrorTypeBreakdown rows={rows} getType={getType} activeType={null} onSelectType={() => {}} />);
    expect(screen.getByText("Never Seen Before Status (1)")).toBeTruthy();
    expect(screen.getByText("Matched-ish (1)")).toBeTruthy();
  });

  it("clicking a chip reports it selected; clicking the active chip again reports null (toggle-off)", () => {
    const rows = [row("1", "Date Mismatch"), row("2", "Ledger Entry Not Found")];
    const onSelectType = vi.fn();
    const { rerender } = render(<ErrorTypeBreakdown rows={rows} getType={getType} activeType={null} onSelectType={onSelectType} />);
    fireEvent.click(screen.getByText("Date Mismatch (1)"));
    expect(onSelectType).toHaveBeenCalledWith("Date Mismatch");

    rerender(<ErrorTypeBreakdown rows={rows} getType={getType} activeType="Date Mismatch" onSelectType={onSelectType} />);
    fireEvent.click(screen.getByText("Date Mismatch (1)"));
    expect(onSelectType).toHaveBeenCalledWith(null);
  });

  it("the active chip is marked aria-pressed", () => {
    const rows = [row("1", "Date Mismatch"), row("2", "Ledger Entry Not Found")];
    render(<ErrorTypeBreakdown rows={rows} getType={getType} activeType="Date Mismatch" onSelectType={() => {}} />);
    expect(screen.getByText("Date Mismatch (1)").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("All Records (2)").getAttribute("aria-pressed")).toBe("false");
  });
});

describe("filterByErrorType — the filtering half of the same contract", () => {
  const rows = [row("1", "Date Mismatch"), row("2", "Ledger Entry Not Found"), row("3", "Date Mismatch")];

  it("returns everything unchanged when activeType is null (\"All Records\")", () => {
    expect(filterByErrorType(rows, getType, null)).toEqual(rows);
  });

  it("returns only the matching rows for a selected type", () => {
    expect(filterByErrorType(rows, getType, "Date Mismatch")).toEqual([rows[0], rows[2]]);
  });

  it("returns an empty array for a type that matches nothing", () => {
    expect(filterByErrorType(rows, getType, "Nonexistent Type")).toEqual([]);
  });
});
