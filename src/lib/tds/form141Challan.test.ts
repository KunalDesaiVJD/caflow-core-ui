import { describe, it, expect } from "vitest";
import {
  parseForm141Challan,
  mergeChallanDocuments,
  reconcileChallan,
  challanFilingUpdate,
  challanPeriod,
} from "./form141Challan";
import type { Form141Statement } from "./form141ScheduleB";

/**
 * Pinned against the REAL text layer of the two documents the department
 * returned for acknowledgement BTA0188370 — the Challan Receipt and the
 * Form 141 Challan-cum-statement, both filed 02-Sep-2026 (CIN
 * 26090200117177ICIC, BSR 6390009, challan 07718).
 *
 * The fixtures below are those PDFs' extracted text, verbatim apart from PAN
 * digits, which are masked. Masking does not change what the parser has to
 * do: a PAN is still five letters, four digits and a letter.
 *
 * Keeping the awkward parts of the real layout is the whole point — the
 * label/colon/value split across three lines, the minor head containing its
 * own " :- ", the four-heading column block, and the value that wraps mid
 * phrase ("...Sale of / immovable Property (800)"). Each of those broke a
 * simpler parser.
 */

const RECEIPT = `INCOME TAX DEPARTMENT
Challan Receipt
PAN
:
ADFPB0000E
Name
:
GIRISHBHAI MADHAVJI BAROCHIA
Tax Year
:
2026-27
Major Head
:
Income Tax (Other than Companies) (0021)
Minor Head
:
Schedule B :- TDS on payment of  Sale of immovable Property (800)
Amount (in Rs.)
:
₹ 1,28,000
Amount (in words)
:
Rupees One Lakh Twenty Eight Thousand Only
CIN
:
26090200117177ICIC
Acknowledgement Number
:
BTA0188370
Mode of Payment
:
Net Banking
Bank Name
:
ICICI Bank
Bank Reference Number
:
2073106619
Date of Deposit
:
02-Sep-2026
BSR code
:
6390009
Challan No
:
07718
Tender Date
:
02/09/2026
Tax Breakup Details (Amount In ₹)
(a) Amount deducted
₹ 1,28,000
(b) Interest
₹ 0
(c) Fee
₹ 0
Total (a + b + c)
₹ 1,28,000
In words
Rupees One Lakh Twenty Eight Thousand Rupees Only
Thanks for being a committed taxpayer!`;

const STATEMENT = `Form 141 (Challan-cum-statement of deduction of tax under section 393(1)) [Table Sl. No. 2(i), 3(i), 6(ii) and 8(vi)]
[See rules 218(3) and 219(5)]
Schedule B - TDS on payment of Sale/Transfer of immovable Property under section 393(1) [Table Sl. No. 3(i)]
Acknowledgement Number: BTA0188370
Challan Identification Number (CIN): 26090200117177ICIC
Date of e-Filing: 02-Sep-2026
PAN: ADFPB0000E
Part A: Particulars of the Deductor
PAN
Name
Country/Region
ADFPB0000E
GIRISHBHAI MADHAVJI BAROCHIA
India
Address
Contact Number
Email ID
1, MALBAR HILS, M G ROAD, NIKOL, Ahmadabad
City, Khodiyarnagar S.O, AHMEDABAD, 382350
9879586742
info@example.com
Payment Details
Tax year of transaction
Month of Deduction
Tax Applicable (Major Head)
Type of Payment (Minor Head)
2026-27
Sep-2026
Income Tax (Other than Companies)
(0021)
Schedule B :- TDS on payment of  Sale of
immovable Property (800)
Residential Status of the Deductee
Type of Deductee
Payment Mode
Bank Name
Resident
Non Corporate Deductee(s)
Net Banking
ICICI Bank
Part C: Summary of Transactions and Details of Tax, Interest and Fee
Total amount on which tax is required to be deducted
₹ 1,28,00,000
Total amount of tax deducted
₹ 1,28,000
Tax Deposit Details
Amount on which TDS to be deducted
₹ 1,28,00,000
(a) Amount deducted
₹ 1,28,000
(b) Interest
₹ 0
(c) Fee
₹ 0
Total (a + b + c)
₹ 1,28,000
In words
Rupees One Lakh Twenty Eight Thousand Only
(This is a computer generated Acknowledgement Receipt and needs no signature)`;

/** What the engine computes for this transaction — see form141ScheduleB.test.ts. */
const COMPUTED: Form141Statement = {
  instalmentSeq: 1,
  taxYear: "2026-27",
  month: "Sep-2026",
  dueDate: "2026-10-30",
  rows: [],
  totalAmountLiable: 12800000,
  totalTds: 128000,
  interest: 0,
  interestBreakdown: { lateDeduction: 0, lateDeductionMonths: 0, lateDeposit: 0, lateDepositMonths: 0 },
  fee: 0,
  feeDays: 0,
  totalPayable: 128000,
};

describe("parsing the real challan receipt", () => {
  const f = parseForm141Challan(RECEIPT);

  it("recognises it as a receipt", () => {
    expect(f.documentKind).toBe("receipt");
  });

  it("reads the government-assigned identifiers", () => {
    expect(f.acknowledgementNumber).toBe("BTA0188370");
    expect(f.cin).toBe("26090200117177ICIC");
    expect(f.bsrCode).toBe("6390009");
    expect(f.challanNo).toBe("07718");
    expect(f.bankReferenceNumber).toBe("2073106619");
  });

  it("reads label/colon/value split across three lines", () => {
    expect(f.pan).toBe("ADFPB0000E");
    expect(f.name).toBe("GIRISHBHAI MADHAVJI BAROCHIA");
    expect(f.bankName).toBe("ICICI Bank");
    expect(f.modeOfPayment).toBe("Net Banking");
  });

  it("does not read 'Bank Name' as the deductor's Name", () => {
    // Both lines end in "Name"; only one is anchored at the start.
    expect(f.name).not.toBe("ICICI Bank");
  });

  it("reads the head codes out of their surrounding prose", () => {
    expect(f.majorHeadCode).toBe("0021");
    expect(f.minorHeadCode).toBe("800");
  });

  it("handles both date formats the SAME document prints", () => {
    expect(f.dateOfDeposit).toBe("2026-09-02"); // "02-Sep-2026"
    expect(f.tenderDate).toBe("2026-09-02");    // "02/09/2026"
  });

  it("reads the Tax Year without mistaking a date for one", () => {
    expect(f.taxYear).toBe("2026-27");
  });

  it("reads the (a)/(b)/(c) breakup, with zeros as zeros", () => {
    expect(f.amountDeducted).toBe(128000);
    expect(f.interest).toBe(0);
    expect(f.fee).toBe(0);
    expect(f.total).toBe(128000);
  });
});

describe("parsing the real Form 141 statement", () => {
  const f = parseForm141Challan(STATEMENT);

  it("recognises it as the statement", () => {
    expect(f.documentKind).toBe("statement");
  });

  it("reads the header identifiers, which sit as label: value on one line", () => {
    expect(f.acknowledgementNumber).toBe("BTA0188370");
    expect(f.cin).toBe("26090200117177ICIC");
    expect(f.dateOfEFiling).toBe("2026-09-02");
  });

  it("takes the DEDUCTOR's PAN, not a party's, from the header", () => {
    expect(f.pan).toBe("ADFPB0000E");
  });

  it("reads the Month of Deduction out of a four-column header block", () => {
    // "Tax year of transaction / Month of Deduction / Tax Applicable / Type of
    // Payment" then four values — positional reading breaks the moment one
    // wraps, so this is matched on the value's own shape instead.
    expect(f.monthOfDeduction).toBe("Sep-2026");
    expect(f.taxYear).toBe("2026-27");
  });

  it("reads a minor head whose value WRAPS across two lines", () => {
    // "...Sale of \n immovable Property (800)"
    expect(f.minorHeadCode).toBe("800");
    expect(f.majorHeadCode).toBe("0021");
  });

  it("reads Part C", () => {
    expect(f.totalAmountLiable).toBe(12800000);
    expect(f.amountDeducted).toBe(128000);
    expect(f.total).toBe(128000);
  });

  it("returns everything null for an empty or image-only document", () => {
    const blank = parseForm141Challan("");
    expect(blank.cin).toBeNull();
    expect(blank.amountDeducted).toBeNull();
    expect(blank.documentKind).toBe("unknown");
  });
});

describe("merging the pair", () => {
  const receipt = parseForm141Challan(RECEIPT);
  const statement = parseForm141Challan(STATEMENT);

  it("agrees on everything both documents carry", () => {
    const { conflicts } = mergeChallanDocuments(receipt, statement);
    expect(conflicts).toEqual([]);
  });

  it("fills each document's gaps from the other", () => {
    const { fields } = mergeChallanDocuments(receipt, statement);
    expect(fields.bsrCode).toBe("6390009");            // receipt only
    expect(fields.totalAmountLiable).toBe(12800000);   // statement only
    expect(fields.monthOfDeduction).toBe("Sep-2026");
  });

  it("catches a receipt and statement from DIFFERENT payments", () => {
    const otherPayment = parseForm141Challan(
      STATEMENT.replace("26090200117177ICIC", "26090200999999HDFC"),
    );
    const { conflicts } = mergeChallanDocuments(receipt, otherPayment);
    expect(conflicts.map((c) => c.field)).toContain("cin");
  });

  it("works in either upload order", () => {
    const a = mergeChallanDocuments(receipt, statement);
    const b = mergeChallanDocuments(statement, receipt);
    expect(a.fields).toEqual(b.fields);
  });
});

describe("reconciling against the computed statement", () => {
  const { fields } = mergeChallanDocuments(parseForm141Challan(RECEIPT), parseForm141Challan(STATEMENT));
  const CTX = { filingBuyerPan: "ADFPB0000E", clientName: "GIRISHBHAI MADHAVJI BAROCHIA" };

  it("passes the real pair against the real computation", () => {
    expect(reconcileChallan(fields, COMPUTED, CTX)).toEqual([]);
  });

  it("blocks a challan paid under a different PAN", () => {
    const r = reconcileChallan(fields, COMPUTED, { ...CTX, filingBuyerPan: "ZZZPZ9999Z" });
    const hit = r.find((x) => x.code === "challan_pan_mismatch");
    expect(hit?.severity).toBe("blocking");
  });

  it("blocks a challan paid to the wrong minor head", () => {
    const wrongHead = { ...fields, minorHeadCode: "400" };
    const hit = reconcileChallan(wrongHead, COMPUTED, CTX).find((x) => x.code === "challan_minor_head_wrong");
    expect(hit?.severity).toBe("blocking");
    expect(hit?.message).toContain("wrong head");
  });

  it("blocks a short payment of tax", () => {
    const short = { ...fields, amountDeducted: 100000, total: 100000 };
    const hit = reconcileChallan(short, COMPUTED, CTX).find((x) => x.code === "challan_tds_short");
    expect(hit?.severity).toBe("blocking");
    expect(hit?.message).toContain("₹28,000");
  });

  it("blocks short-paid INTEREST, which a completed-looking challan hides", () => {
    const owed: Form141Statement = { ...COMPUTED, interest: 7680, totalPayable: 135680 };
    const hit = reconcileChallan(fields, owed, CTX).find((x) => x.code === "challan_interest_short");
    expect(hit?.severity).toBe("blocking");
    expect(hit?.message).toContain("₹7,680");
  });

  it("only warns on an overpayment", () => {
    const over = { ...fields, amountDeducted: 130000, total: 130000 };
    const hit = reconcileChallan(over, COMPUTED, CTX).find((x) => x.code === "challan_tds_excess");
    expect(hit?.severity).toBe("warning");
  });

  it("blocks a challan for the wrong month", () => {
    const wrongMonth = { ...fields, monthOfDeduction: "Aug-2026" };
    expect(
      reconcileChallan(wrongMonth, COMPUTED, CTX).map((x) => x.code),
    ).toContain("challan_month_mismatch");
  });

  it("blocks a challan whose own breakup does not add up", () => {
    // The same class of intra-document arithmetic defect the filed sample
    // already proved the portal will accept.
    const inconsistent = { ...fields, amountDeducted: 128000, interest: 500, fee: 0, total: 128000 };
    const hit = reconcileChallan(inconsistent, COMPUTED, CTX).find((x) => x.code === "challan_breakup_inconsistent");
    expect(hit?.severity).toBe("blocking");
  });

  it("only WARNS when the deductor's name differs — PAN settles identity", () => {
    const r = reconcileChallan(fields, COMPUTED, { ...CTX, clientName: "NEW FORTUNE TYRE" });
    const hit = r.find((x) => x.code === "challan_name_differs");
    expect(hit?.severity).toBe("warning");
  });

  it("warns about a late deposit", () => {
    const late = { ...fields, dateOfDeposit: "2026-11-15" };
    const hit = reconcileChallan(late, COMPUTED, CTX).find((x) => x.code === "challan_deposited_late");
    expect(hit?.severity).toBe("warning");
  });

  it("reports document conflicts as blocking", () => {
    const r = reconcileChallan(fields, COMPUTED, CTX, [
      { field: "cin", receipt: "A", statement: "B" },
    ]);
    expect(r[0].code).toBe("challan_documents_disagree");
    expect(r[0].severity).toBe("blocking");
  });

  it("says NOTHING about fields it could not read", () => {
    // An image-only scan comes back all-null. Treating that as a mismatch
    // would reject correct filings for exactly the documents most in need of
    // checking.
    const unread = parseForm141Challan("");
    expect(reconcileChallan(unread, COMPUTED, CTX)).toEqual([]);
  });
});

describe("what gets written onto the filing", () => {
  const { fields } = mergeChallanDocuments(parseForm141Challan(RECEIPT), parseForm141Challan(STATEMENT));

  it("carries the facts no computation can reproduce", () => {
    const u = challanFilingUpdate(fields);
    expect(u.acknowledgement_number).toBe("BTA0188370");
    expect(u.cin).toBe("26090200117177ICIC");
    expect(u.bsr_code).toBe("6390009");
    expect(u.challan_no).toBe("07718");
    expect(u.date_of_deposit).toBe("2026-09-02");
    expect(u.total_tds).toBe(128000);
    expect(u.status).toBe("filed");
  });

  it("derives the period for attaching the challan to the right payment", () => {
    expect(challanPeriod(fields)).toEqual({ taxYear: "2026-27", month: "Sep-2026" });
  });

  it("falls back to the deposit date when the period is not stated", () => {
    const sparse = { ...fields, taxYear: null, monthOfDeduction: null };
    expect(challanPeriod(sparse)).toEqual({ taxYear: "2026-27", month: "Sep-2026" });
  });
});
