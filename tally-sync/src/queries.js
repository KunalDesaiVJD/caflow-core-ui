/**
 * queries.js — Tally XML Request Builders
 * All Tally XML API queries in one place.
 * Tally listens on http://localhost:9000 by default.
 */

/**
 * Build the XML envelope to fetch all Groups from Tally master.
 * Returns: name, parent, is_primary_group
 */
function buildGroupsQuery(company = '') {
  const companyTag = company
    ? `<SVCURRENTCOMPANY>${escapeXml(company)}</SVCURRENTCOMPANY>`
    : '';
  return `<?xml version="1.0" encoding="utf-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <STATICVARIABLES>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
          ${companyTag}
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <COLLECTION ISMODIFY="No" ENCODING="UNICODE">
            <TYPE>Group</TYPE>
            <FETCH>Name,Parent,_IsRevenue,_IsDebtors,_IsCreditors,BasicGroupIsCalculated,BasicPrimaryGroup</FETCH>
          </COLLECTION>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>`;
}

/**
 * Build the XML envelope to fetch all Ledgers from Tally master
 * with their balances for the given date range.
 * Returns: name, parent group, opening balance, closing balance
 */
function buildLedgersQuery(fromDate, toDate, company = '') {
  const companyTag = company
    ? `<SVCURRENTCOMPANY>${escapeXml(company)}</SVCURRENTCOMPANY>`
    : '';
  return `<?xml version="1.0" encoding="utf-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <STATICVARIABLES>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
          <SVFROMDATE>${fromDate}</SVFROMDATE>
          <SVTODATE>${toDate}</SVTODATE>
          ${companyTag}
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <COLLECTION ISMODIFY="No" ENCODING="UNICODE">
            <TYPE>Ledger</TYPE>
            <FETCH>Name,Parent,OpeningBalance,ClosingBalance,
                   CreditLimit,BillAllocations,IsBillWiseOn,
                   AffectsStock,IsRevenue,_IsDebtors,_IsCreditors,
                   CurrencyName,PrimaryGroup,TaxType,
                   RegistrationType,GSTDetails,
                   OpeningBalanceAmt,ClosingBalanceAmt</FETCH>
            <COMPUTE>
              <COMPUTEVAR>ClosingBalance:$$ClosingBalance:$Name</COMPUTEVAR>
              <COMPUTEVAR>OpeningBalance:$$OpeningBalance:$Name</COMPUTEVAR>
            </COMPUTE>
          </COLLECTION>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>`;
}

// NOTE: buildTrialBalanceQuery was removed. Trial Balance must NOT be fetched
// from Tally — the "Trial Balance" REPORTNAME returns "Unknown Request" on
// this Tally build, and any COLLECTION-based substitute using $OpeningBalance
// freezes Tally's XML server on large companies. Derive TB from ledgers +
// vouchers instead. See tally-sync/SOP.md.

/**
 * Build the XML to fetch all Vouchers (transactions) for a ledger/date range.
 * Used for detailed transaction fetch.
 */
function buildVouchersQuery(fromDate, toDate, company = '') {
  const companyTag = company
    ? `<SVCURRENTCOMPANY>${escapeXml(company)}</SVCURRENTCOMPANY>`
    : '';
  return `<?xml version="1.0" encoding="utf-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <STATICVARIABLES>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
          <SVFROMDATE>${fromDate}</SVFROMDATE>
          <SVTODATE>${toDate}</SVTODATE>
          ${companyTag}
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <COLLECTION ISMODIFY="No" ENCODING="UNICODE">
            <TYPE>Voucher</TYPE>
            <FETCH>Date,VoucherTypeName,VoucherNumber,Narration,
                   PartyledgerName,LedgerEntries,AllledgerEntries</FETCH>
          </COLLECTION>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>`;
}

/**
 * Build the XML to get the list of companies currently open in Tally.
 */
function buildCompanyListQuery() {
  return `<?xml version="1.0" encoding="utf-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <STATICVARIABLES>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <COLLECTION ISMODIFY="No" ENCODING="UNICODE">
            <TYPE>Company</TYPE>
            <FETCH>Name,StartingFrom,Books,FormalName,GSTNumber,PANNumber,IsSimpleGSTVoucher</FETCH>
          </COLLECTION>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>`;
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = {
  buildGroupsQuery,
  buildLedgersQuery,
  buildVouchersQuery,
  buildCompanyListQuery,
  escapeXml,
};
