/**
 * Recon26as smoke test: mounts the page, uploads a TRACES text 26AS and a
 * Tally-style CSV ledger, runs the reconciliation with AI off, and checks the
 * totals, the force-match offer for a proprietor-vs-firm party, and the 360°
 * issues tab — the render paths tsc and the build never exercise.
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock('@/lib/msme43b/pdfText', () => ({ pdfPageTexts: vi.fn(async () => []) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import Recon26as from './Recon26as';

const TRACES = [
  'PART-I - Details of Tax Deducted at Source',
  'Sr. No.^Name of Deductor^TAN of Deductor^^^^^Total Amount Paid / Credited^Total Tax Deducted^Total TDS Deposited',
  '1^ABC LIMITED^MUMA12345B^^^^^150000.00^15000.00^15000.00',
  '^Sr. No.^Section^Transaction Date^Status of Booking^Date of Booking^Remarks^Amount Paid / Credited^Tax Deducted^TDS Deposited',
  '^1^194J^30-Jun-2025^F^31-Jul-2025^-^100000.00^10000.00^10000.00',
  '^2^194J^30-Sep-2025^F^31-Oct-2025^-^50000.00^5000.00^5000.00',
  '2^RAMESH PATEL^AHMR12345A^^^^^50000.00^1000.00^1000.00',
  '^Sr. No.^Section^Transaction Date^Status of Booking^Date of Booking^Remarks^Amount Paid / Credited^Tax Deducted^TDS Deposited',
  '^1^194C^15-Nov-2025^F^31-Jan-2026^-^20000.00^400.00^400.00',
  '^2^194C^15-Feb-2026^F^31-May-2026^-^30000.00^600.00^600.00',
].join('\n');

const LEDGER = [
  'Date,Particulars,Vch Type,Vch No.,Debit,Credit',
  '30-06-2025,ABC Ltd,Journal,1,10000,',
  '05-10-2025,ABC Ltd,Journal,2,5000,',
  '01-05-2025,Shree Krishna Traders,Journal,3,700,',
  '01-08-2025,Shree Krishna Traders,Journal,4,300,',
  '31-03-2026,Ghost Customer,Journal,5,2500,',
].join('\n');

function file(name: string, text: string) {
  const f = new File([text], name, { type: 'text/plain' });
  // jsdom's File lacks text() / arrayBuffer() in some versions
  Object.assign(f, {
    text: async () => text,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  });
  return f;
}

describe('Recon26as page', () => {
  it('reconciles uploads and offers force match on agreeing totals', async () => {
    localStorage.clear();
    const { container } = render(<Recon26as />);
    const inputs = container.querySelectorAll('input[type="file"]');
    fireEvent.change(inputs[0], { target: { files: [file('26as.txt', TRACES)] } });
    fireEvent.change(inputs[1], { target: { files: [file('tds.csv', LEDGER)] } });
    fireEvent.click(screen.getByLabelText(/Use AI to match party names/));
    fireEvent.click(screen.getByRole('button', { name: /Reconcile/ }));

    await waitFor(() => expect(screen.getByText('TDS as per books')).toBeInTheDocument());
    expect(screen.getByText('₹18,500.00')).toBeInTheDocument();
    expect(screen.getByText('₹16,000.00')).toBeInTheDocument();
    expect(screen.getByText(/Totals agree — force match available/)).toBeInTheDocument();
    expect(screen.getByText(/Ghost Customer: TDS in books but deductor not in 26AS/)).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('tab', { name: /Party-wise/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Party-wise/ }));
    const row = await screen.findByText('RAMESH PATEL');
    const tr = row.closest('tr')!;
    fireEvent.click(within(tr).getByRole('button', { name: 'Force match' }));
    await waitFor(() => expect(within(screen.getByText('RAMESH PATEL').closest('tr')!).getByText('Force matched')).toBeInTheDocument());
  });
});
