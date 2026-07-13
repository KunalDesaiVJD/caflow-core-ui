// TEMPORARY verification scratch page — mounts the REAL TdsFilingsManager
// component with only window.fetch intercepted for Supabase REST calls, so
// the redundant-wrapper-div fix can be visually re-verified in a real render
// without an authenticated session. Deleted before finishing this task.
import { useEffect, useState } from "react";
import { TdsFilingsManager } from "@/components/tds/TdsFilingsManager";

const NOW = new Date().toISOString();

const MOCK_FILINGS = [
  { id: "f1", client_id: "c1", firm_id: "firm-1", financial_year: "2025-26", quarter: "Q1", tds_forms: ["26Q"], work_status: "Not Started", date_of_filing: null, acknowledgment_number: null, prn_no: null, tan: "AAAA11111A", assigned_staff: null, preparer_id: null, checker_id: null, last_updated_by: null, last_updated_at: null, remarks: null, created_at: NOW, ack_file_url: null },
  { id: "f2", client_id: "c2", firm_id: "firm-1", financial_year: "2025-26", quarter: "Q1", tds_forms: ["26Q"], work_status: "Under Process", date_of_filing: null, acknowledgment_number: null, prn_no: null, tan: "BBBB22222B", assigned_staff: null, preparer_id: null, checker_id: null, last_updated_by: null, last_updated_at: null, remarks: null, created_at: NOW, ack_file_url: null },
  { id: "f3", client_id: "c3", firm_id: "firm-1", financial_year: "2025-26", quarter: "Q1", tds_forms: ["26Q"], work_status: "Queries Sent to Client", date_of_filing: null, acknowledgment_number: "ACKQ0001", prn_no: null, tan: "CCCC33333C", assigned_staff: null, preparer_id: "u1", checker_id: null, last_updated_by: null, last_updated_at: null, remarks: null, created_at: NOW, ack_file_url: null },
  { id: "f4", client_id: "c4", firm_id: "firm-1", financial_year: "2025-26", quarter: "Q1", tds_forms: ["26Q"], work_status: "Reviewed", date_of_filing: null, acknowledgment_number: "ACKQ0002", prn_no: null, tan: "DDDD44444D", assigned_staff: null, preparer_id: "u2", checker_id: null, last_updated_by: null, last_updated_at: null, remarks: null, created_at: NOW, ack_file_url: null },
  { id: "f5", client_id: "c5", firm_id: "firm-1", financial_year: "2025-26", quarter: "Q1", tds_forms: ["26Q"], work_status: "Filed", date_of_filing: "2026-07-10", acknowledgment_number: "ACKQ0003", prn_no: "PRN0003", tan: "EEEE55555E", assigned_staff: null, preparer_id: "u1", checker_id: "u3", last_updated_by: null, last_updated_at: null, remarks: null, created_at: NOW, ack_file_url: null },
];

const MOCK_CLIENTS = [
  { id: "c1", name: "Priya Sharma", pan: "AAAAA1111A", tan_number: "AAAA11111A", tds_start_fy: "2025-26", tds_start_quarter: "Q1", tds_forms_applicable: ["26Q"] },
  { id: "c2", name: "Kunal Desai", pan: "BBBBB2222B", tan_number: "BBBB22222B", tds_start_fy: "2025-26", tds_start_quarter: "Q1", tds_forms_applicable: ["26Q"] },
  { id: "c3", name: "Rahul Mehta", pan: "CCCCC3333C", tan_number: "CCCC33333C", tds_start_fy: "2025-26", tds_start_quarter: "Q1", tds_forms_applicable: ["26Q"] },
  { id: "c4", name: "Siddharth Venkataraman (PROP:Venkataraman Trading Co)", pan: "DDDDD4444D", tan_number: "DDDD44444D", tds_start_fy: "2025-26", tds_start_quarter: "Q1", tds_forms_applicable: ["26Q"] },
  { id: "c5", name: "Siddharth Venkataraman", pan: "EEEEE5555E", tan_number: "EEEE55555E", tds_start_fy: "2025-26", tds_start_quarter: "Q1", tds_forms_applicable: ["26Q"] },
];

const MOCK_USERS = [
  { id: "u1", name: "Priya Sharma" },
  { id: "u2", name: "Kunal Desai" },
  { id: "u3", name: "Siddharth Venkataraman" },
];

function jsonResponse(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
}

export default function DevTestTdsFilingsFix() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (url.includes("/rest/v1/tds_filings")) return jsonResponse(MOCK_FILINGS);
      if (url.includes("/rest/v1/clients")) return jsonResponse([]); // deleted-clients lookup — none deleted
      if (url.includes("/rest/v1/tds_ack_files")) return jsonResponse([]);
      if (url.includes("/rest/v1/tds_filing_audit_log")) return jsonResponse([]);
      return originalFetch(input, init);
    }) as typeof window.fetch;
    setReady(true);
    return () => { window.fetch = originalFetch; };
  }, []);

  if (!ready) return null;

  return (
    <div style={{ padding: 24 }}>
      <TdsFilingsManager
        clients={MOCK_CLIENTS as any}
        users={MOCK_USERS as any}
        isSuperadmin={true}
        resolveFirmId={async () => "firm-1"}
        fyFilter="2025-26"
        quarterFilter="Q1"
        clientFilter="all"
        formFilter="all"
      />
    </div>
  );
}
