/**
 * iarDocx.ts
 *
 * Generates the Independent Auditor's Report (IAR) as a real .docx file
 * using JSZip. Format and wording match the official corporate template:
 *   format/IAR.doc (converted from legacy .doc).
 *
 * Template fingerprint:
 *   • Page size : A4 portrait (11906 x 16838 twips)
 *   • Margins   : top=289 bottom=346 left=1151 right=720 (template's exact values)
 *   • Body font : Cambria 10 pt
 *   • Body      : fully justified, line-rule "atLeast" 282 (≈1.17 line)
 *   • Title     : centred, bold, 12 pt
 *   • Headings  : bold, 10 pt (same size as body)
 *   • One bulleted list (auditor procedures)
 *
 * The standard sections (Opinion, Basis, Management Responsibility,
 * Auditor Responsibility, communication paragraphs) reproduce the
 * template's exact wording with [Company Name] and March 31, 20XX
 * substituted from engagement data. Conditional sections (Qualification,
 * Emphasis of Matter, Key Audit Matters, Going Concern, Audit Trail,
 * Other Legal & Regulatory, CARO 2020, Pending Litigation) are appended
 * only when the auditor has flagged or filled them in.
 *
 * The signature block (firm name, FRN, partner, membership no., UDIN,
 * place, date) is the closing section.
 */

import JSZip from "jszip";

// ─── XML helpers ──────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Run / paragraph builders ─────────────────────────────────────────────────

interface RunOpts {
  bold?:      boolean;
  italic?:    boolean;
  underline?: boolean;
  /** Point size — defaults to 10 (template body). */
  fontSize?:  number;
}

function wRun(text: string, opts: RunOpts = {}): string {
  if (!text) return "";
  const pt = opts.fontSize ?? 10;
  const sz = pt * 2;
  const rPrParts: string[] = [
    `<w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/>`,
    `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`,
  ];
  if (opts.bold)      rPrParts.push("<w:b/><w:bCs/>");
  if (opts.italic)    rPrParts.push("<w:i/><w:iCs/>");
  if (opts.underline) rPrParts.push('<w:u w:val="single"/>');
  return (
    `<w:r><w:rPr>${rPrParts.join("")}</w:rPr>` +
    `<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`
  );
}

interface ParaOpts extends RunOpts {
  centered?:    boolean;
  leftAlign?:   boolean;   // default is justify ("both")
  spaceBefore?: number;    // twips
  spaceAfter?:  number;    // twips
  indLeft?:     number;    // hanging indent left, twips
  indHanging?:  number;    // hanging amount
  keepNext?:    boolean;
}

/** Build a <w:p> with text. Inline "\n" → <w:br/>. */
function wPara(text: string, opts: ParaOpts = {}): string {
  const pPrParts: string[] = [];
  if (opts.centered)      pPrParts.push('<w:jc w:val="center"/>');
  else if (opts.leftAlign) pPrParts.push('<w:jc w:val="left"/>');
  else                     pPrParts.push('<w:jc w:val="both"/>');

  const before = opts.spaceBefore;
  const after  = opts.spaceAfter ?? 0;
  pPrParts.push(
    `<w:spacing${before !== undefined ? ` w:before="${before}"` : ""} w:after="${after}" w:line="282" w:lineRule="atLeast"/>`,
  );
  if (opts.keepNext) pPrParts.push("<w:keepNext/>");
  if (opts.indLeft !== undefined) {
    const hanging = opts.indHanging ?? 0;
    pPrParts.push(
      hanging
        ? `<w:ind w:left="${opts.indLeft}" w:hanging="${hanging}"/>`
        : `<w:ind w:left="${opts.indLeft}"/>`,
    );
  }
  const pPr = `<w:pPr>${pPrParts.join("")}</w:pPr>`;

  const segments = text.split("\n");
  const runs: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    if (i > 0) {
      runs.push(`<w:r><w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/><w:sz w:val="${(opts.fontSize ?? 10) * 2}"/></w:rPr><w:br/></w:r>`);
    }
    if (segments[i]) runs.push(wRun(segments[i], opts));
  }
  return `<w:p>${pPr}${runs.join("")}</w:p>`;
}

/** Empty paragraph for vertical rhythm. */
function blank(): string {
  return `<w:p><w:pPr><w:spacing w:after="0" w:line="282" w:lineRule="atLeast"/></w:pPr></w:p>`;
}

/** Bullet paragraph using a hanging indent + bullet glyph. */
function bullet(text: string): string {
  const indLeft = 720;   // 36 pt
  const indHang = 360;   // 18 pt
  const pPr =
    `<w:pPr>` +
    `<w:jc w:val="both"/>` +
    `<w:spacing w:after="80" w:line="282" w:lineRule="atLeast"/>` +
    `<w:ind w:left="${indLeft}" w:hanging="${indHang}"/>` +
    `</w:pPr>`;
  // Use a literal bullet character; the template renders the same way.
  // The bullet run uses Symbol-like Cambria — close enough for visual parity.
  return `<w:p>${pPr}${wRun("•")}<w:r><w:tab/></w:r>${wRun(text)}</w:p>`;
}

/**
 * Section heading: bold 11pt with template's exact spacing rhythm.
 *
 * Template (IAR.doc) heading runs use `<w:b/><w:sz w:val="22"/>`
 * (11pt) with `<w:spacing w:before="266"/>` and `<w:ind w:left="180"/>`.
 * Earlier code used 10pt with no `before`/`indent`, making headings
 * look indistinguishable from the body — matching the template's 11pt
 * + before/indent restores the visual hierarchy.
 */
function heading(text: string, opts: { underline?: boolean; before?: number } = {}): string {
  // Headings flush-left to match body paragraphs and addressee block.
  // Spacing tightened (before 140 → 80, after 60 → 40) so the full
  // Management's Responsibility section + everything above lands on
  // page 1, matching the template's page-1 contents.
  return wPara(text, {
    leftAlign: true,
    bold: true,
    underline: opts.underline,
    fontSize: 11,
    spaceBefore: opts.before ?? 80,
    spaceAfter:  40,
    keepNext:    true,
  });
}

// ─── Table builder for the litigation annexure ────────────────────────────────

function tableCell(text: string, opts: { bold?: boolean; widthDxa: number } = { widthDxa: 1500 }): string {
  const tcPr =
    `<w:tcPr>` +
    `<w:tcW w:w="${opts.widthDxa}" w:type="dxa"/>` +
    `<w:tcBorders>` +
      `<w:top w:val="single" w:sz="4" w:color="000000"/>` +
      `<w:bottom w:val="single" w:sz="4" w:color="000000"/>` +
      `<w:left w:val="single" w:sz="4" w:color="000000"/>` +
      `<w:right w:val="single" w:sz="4" w:color="000000"/>` +
    `</w:tcBorders>` +
    `</w:tcPr>`;
  const cellPara = wPara(text, { leftAlign: true, bold: opts.bold });
  return `<w:tc>${tcPr}${cellPara}</w:tc>`;
}

function tableRow(cells: string[]): string {
  return `<w:tr>${cells.join("")}</w:tr>`;
}

// ─── Export params ────────────────────────────────────────────────────────────

export interface IarLitigationRow {
  sr:      number;
  statute: string;
  amount:  string;
  fy:      string;
  forum:   string;
}

export interface IarDocxParams {
  companyName:   string;
  financialYear: string;          // "2025-26"
  fyEndDate:     string;          // "March 31, 2026"
  fyEndShort:    string;          // "31st March, 2026"
  profitOrLoss:  "Profit" | "Loss";

  opinionType:       "unmodified" | "qualified" | "adverse" | "disclaimer";
  qualificationPara: string;

  emphasisToggle:    boolean;
  emphasisText:      string;
  kamToggle:         boolean;
  kamText:           string;
  goingConcernStd:   boolean;
  goingConcernText:  string;
  auditTrailText:    string;
  branchText:        string;

  /** Auto-generated fragments from auditReportGenerator.ts */
  pointD:    string;
  pointG:    string;
  caroPara:  string;

  litigationRows: IarLitigationRow[];

  firmName:     string;
  firmRegNo:    string;
  partnerName:  string;
  partnerMemNo: string;
  udin:         string;
  firmCity:     string;
  reportDate:   string;
}

const OPINION_LABEL: Record<IarDocxParams["opinionType"], string> = {
  unmodified: "Opinion",
  qualified:  "Qualified Opinion",
  adverse:    "Adverse Opinion",
  disclaimer: "Disclaimer of Opinion",
};

// ─── Main export function ─────────────────────────────────────────────────────

export async function exportIarToDocx(
  params:   IarDocxParams,
  filename: string,
): Promise<void> {
  const {
    companyName, fyEndDate, profitOrLoss,
    opinionType, qualificationPara,
    emphasisToggle, emphasisText, kamToggle, kamText,
    goingConcernStd, goingConcernText,
    auditTrailText, branchText,
    pointD, pointG, caroPara,
    litigationRows,
    firmName, firmRegNo, partnerName, partnerMemNo, udin,
    firmCity, reportDate,
  } = params;

  const company = companyName || "[ Company Name ]";
  const paras: string[] = [];

  // ── 0. Top-of-page spacing ────────────────────────────────────────────────
  // Template renders the title roughly 2½" below the page top edge.
  // 6 leading blank paragraphs (~1") combined with a 720-twip top page
  // margin (~0.5", set in sectPr below) give the visible 1.5" top
  // whitespace the user is asking for. Tighter than the original 8–10
  // blanks, leaving room for Management's Responsibility to land on
  // page 1 alongside everything before it.
  for (let i = 0; i < 6; i++) paras.push(blank());

  // ── 1. Title ──────────────────────────────────────────────────────────────
  // Template wraps the title with the built-in "Title" pStyle which
  // renders italic + underline + centered + bold. Match by emitting
  // those properties explicitly so the export looks the same regardless
  // of whether the consuming Word installation has Title style defined.
  // Apostrophe is U+2019 (right single quotation mark) — template uses
  // smart quotes throughout; ASCII U+0027 in earlier rounds rendered
  // as a straight tick instead of the curly typographer's apostrophe.
  paras.push(wPara("INDEPENDENT AUDITOR’S REPORT", {
    centered: true, bold: true, italic: true, underline: true,
    fontSize: 12, spaceAfter: 240,
  }));
  paras.push(blank());

  // ── 2. Addressee ──────────────────────────────────────────────────────────
  // Template wording is "The Shareholders of" (NOT "Members"). User
  // requested left-alignment to match the original template's layout.
  // sz=11 keeps the addressee block visually distinct without forcing
  // it to the page centre.
  paras.push(wPara("To",                  { leftAlign: true, fontSize: 11, spaceAfter: 0 }));
  paras.push(wPara("The Shareholders of", { leftAlign: true, fontSize: 11, spaceAfter: 0 }));
  paras.push(wPara(company,               { leftAlign: true, fontSize: 11, bold: true, spaceAfter: 60 }));
  paras.push(blank());

  // ── 3. "Report on the Financial Statements" ─────────────────────────────
  // Template wording is "Report on the Financial Statements" — NOT
  // "Report on the Audit of the Financial Statements" — and is bold
  // only (no underline). Restored verbatim with underline removed.
  paras.push(heading("Report on the Financial Statements"));

  // ── 4. Opinion ────────────────────────────────────────────────────────────
  paras.push(heading(OPINION_LABEL[opinionType]));
  paras.push(wPara(
    // Smart quotes around "the Company"; lowercase "statement"; no "a"
    // before "summary of" — all per template's verbatim wording.
    `We have audited the accompanying financial statements of ${company} (“the Company”), ` +
    `which comprise the Balance Sheet as at ${fyEndDate}, the statement of Profit and Loss and ` +
    `Cash Flow Statement for the year then ended, and notes to the financial statements ` +
    `including summary of significant accounting policies and other explanatory information.`,
    { spaceAfter: 60 },
  ));
  paras.push(wPara(
    `In our opinion and to the best of our information and according to the explanations given to us, ` +
    `the aforesaid financial statements give the information required by the Act in the manner so required ` +
    `and give a true and fair view in conformity with the accounting principles generally accepted in India, ` +
    // Template uses lowercase "company" here ("...state of affairs of the company..."). Restored.
    `of the state of affairs of the company as at ${fyEndDate}, and ${profitOrLoss} and its cash flows ` +
    `for the year ended on that date.`,
    { spaceAfter: 60 },
  ));

  // Optional Qualification para — slotted directly under Opinion
  if (qualificationPara && qualificationPara.trim()) {
    paras.push(wPara(qualificationPara, { italic: true, spaceAfter: 60 }));
  }

  // ── 5. Basis for Opinion ──────────────────────────────────────────────────
  paras.push(heading(`Basis for ${OPINION_LABEL[opinionType]}`));
  paras.push(wPara(
    `We conducted our audit in accordance with the Standards on Auditing (SAs) specified under section 143(10) ` +
    `of the Companies Act, 2013. Our responsibilities under those Standards are further described in the ` +
    `Auditor’s Responsibilities for the Audit of the Financial Statements section of our report. We are ` +
    `independent of the Company in accordance with the Code of Ethics issued by the Institute of Chartered ` +
    `Accountants of India together with the ethical requirements that are relevant to our audit of the ` +
    // Template renders "there under" as TWO words. Restored.
    `financial statements under the provisions of the Companies Act, 2013 and the Rules there under, and we ` +
    `have fulfilled our other ethical responsibilities in accordance with these requirements and the Code of ` +
    `Ethics. We believe that the audit evidence we have obtained is sufficient and appropriate to provide a ` +
    `basis for our opinion.`,
    { spaceAfter: 60 },
  ));

  // ── 6. Emphasis of Matter (optional) ──────────────────────────────────────
  if (emphasisToggle && emphasisText.trim()) {
    paras.push(heading("Emphasis of Matter"));
    paras.push(wPara(emphasisText, { spaceAfter: 60 }));
  }

  // ── 7. Key Audit Matters (optional) ───────────────────────────────────────
  if (kamToggle && kamText.trim()) {
    paras.push(heading("Key Audit Matters"));
    paras.push(wPara(kamText, { spaceAfter: 60 }));
  }

  // ── 8. Management's Responsibility ────────────────────────────────────────
  paras.push(heading("Management's Responsibility for the Financial Statements"));
  paras.push(wPara(
    // Template uses smart-quote 'the act' and lowercase "company" in
    // "cash flows of the company" (the second occurrence is a generic
    // reference, not the defined term "the Company").
    `The management and Board of Directors of the Company are responsible for the matters stated in ` +
    `Section 134(5) of the Companies Act, 2013 (‘the act’) with respect to the preparation of these ` +
    `financial statements that give a true and fair view of the financial position, financial performance ` +
    `and cash flows of the company in accordance with the accounting principles generally accepted in India, ` +
    `including the Accounting Standards specified under Section 133 of the Act. This responsibility also ` +
    `includes maintenance of adequate accounting records in accordance with the provisions of the Act for ` +
    `safeguarding the assets of the Company and for preventing and detecting frauds and other irregularities; ` +
    `selection and application of appropriate accounting policies; making judgments and estimates that are ` +
    `reasonable and prudent; design, implementation and maintenance of adequate internal financial controls, ` +
    `that are operating effectively for ensuring the accuracy and completeness of the accounting records, ` +
    `relevant to the preparation and presentation of the financial statements that give a true and fair view ` +
    `and are free from material misstatement, whether due to fraud or error.`,
    { spaceAfter: 60 },
  ));
  paras.push(wPara(
    `In preparing the financial statements, management is responsible for assessing the Company’s ability to ` +
    `continue as a going concern, disclosing, as applicable, matters related to going concern and using the ` +
    `going concern basis of accounting unless management either intends to liquidate the Company or to cease ` +
    `operations, or has no realistic alternative but to do so.`,
    { spaceAfter: 60 },
  ));
  paras.push(wPara(
    // Template uses lowercase "company's" here (generic, not defined term).
    `That Board of Directors is also responsible for overseeing the company’s financial reporting process.`,
    { spaceAfter: 60 },
  ));

  // ── 9. Auditor's Responsibility ───────────────────────────────────────────
  paras.push(heading("Auditor’s Responsibility"));
  paras.push(wPara(
    `Our objectives are to obtain reasonable assurance about whether the financial statements as a whole ` +
    `are free from material misstatement, whether due to fraud or error, and to issue an auditor’s report ` +
    `that includes our opinion. Reasonable assurance is a high level of assurance but is not a guarantee ` +
    `that an audit conducted in accordance with SAs will always detect a material misstatement when it exists. ` +
    `Misstatements can arise from fraud or error and are considered material if, individually or in aggregate, ` +
    `they could reasonably be expected to influence the economic decisions of users taken on the basis of ` +
    `these financial statements.`,
    { spaceAfter: 60 },
  ));
  paras.push(wPara(
    // Template wording: comma + lowercase "we also" (not period).
    `As part of an audit in accordance with Standards on Auditing, we exercise professional judgment and ` +
    `maintain professional skepticism throughout the audit, we also:`,
    { spaceAfter: 120 },
  ));

  // 5 bullet points
  paras.push(bullet(
    "Identify and assess the risks of material misstatement of the financial statements, whether due to fraud or error, " +
    "design and perform audit procedures responsive to those risks, and obtain audit evidence that is sufficient and " +
    "appropriate to provide a basis for our opinion. The risk of not detecting a material misstatement resulting from " +
    "fraud is higher than for one resulting from error, as fraud may involve collusion, forgery, intentional omissions, " +
    "misrepresentations, or the override of internal control."
  ));
  paras.push(bullet(
    // Template uses "Section 143(3) (i)" with a SPACE before "(i)".
    "Obtain an understanding of internal control relevant to the audit in order to design audit procedures that are " +
    "appropriate in the circumstances. Under Section 143(3) (i) of the Act, we are also responsible for explaining our " +
    "opinion on whether the Company has adequate internal financial controls system in place and the operating " +
    "effectiveness of such controls."
  ));
  paras.push(bullet(
    "Evaluate the appropriateness of accounting policies used and the reasonableness of accounting estimates and related " +
    "disclosures made by management."
  ));
  paras.push(bullet(
    "Conclude on the appropriateness of management’s use of the going concern basis of accounting and, based on the audit " +
    "evidence obtained, whether a material uncertainty exists related to events or conditions that may cast significant " +
    "doubt on the Company’s ability to continue as a going concern. If we conclude that a material uncertainty exists, we " +
    "are required to draw attention in our auditor’s report to the related disclosures in the financial statements or, if " +
    "such disclosures are inadequate, to modify our opinion. Our conclusions are based on the audit evidence obtained up " +
    "to the date of our auditor’s report. However, future events or conditions may cause the Company to cease to continue " +
    "as a going concern."
  ));
  paras.push(bullet(
    "Evaluate the overall presentation, structure and content of the financial statements, including the disclosures, and " +
    "whether the financial statements represent the underlying transactions and events in a manner that achieves fair " +
    "presentation."
  ));

  paras.push(blank());
  paras.push(wPara(
    `We communicate with those charged with governance regarding, among other matters, the planned scope and timing of ` +
    `the audit and significant audit findings, including any significant deficiencies in internal control that we identify ` +
    `during our audit.`,
    { spaceAfter: 60 },
  ));
  paras.push(wPara(
    `We also provide those charged with governance with a statement that we have complied with relevant ethical ` +
    `requirements regarding independence, and to communicate with them all relationships and other matters that may ` +
    `reasonably be thought to bear on our independence, and where applicable, related safeguards.`,
    { spaceAfter: 240 },
  ));

  // ── 10. Going Concern (engagement-specific) ───────────────────────────────
  paras.push(heading("Going Concern"));
  paras.push(wPara(
    goingConcernStd
      ? "We have nothing to report in regard to the Company's ability to continue as a going concern."
      : (goingConcernText.trim() || "We have nothing to report in regard to the Company's ability to continue as a going concern."),
    { spaceAfter: 60 },
  ));

  // ── 11. Audit Trail ───────────────────────────────────────────────────────
  if (auditTrailText && auditTrailText.trim()) {
    paras.push(heading("Audit Trail (Edit Log)"));
    paras.push(wPara(auditTrailText, { spaceAfter: 60 }));
  }

  // ── 12. Other Legal & Regulatory Requirements ─────────────────────────────
  paras.push(heading("Report on Other Legal and Regulatory Requirements"));
  if (branchText && branchText.trim()) {
    paras.push(wPara(branchText, { spaceAfter: 60 }));
  }
  if (pointD && pointD.trim()) {
    paras.push(wPara(pointD, { spaceAfter: 60 }));
  }
  if (pointG && pointG.trim()) {
    paras.push(wPara(pointG, { spaceAfter: 60 }));
  }

  // ── 13. CARO 2020 ─────────────────────────────────────────────────────────
  if (caroPara && caroPara.trim()) {
    paras.push(heading("Annexure to the Auditors' Report — CARO 2020"));
    paras.push(wPara(caroPara, { spaceAfter: 60 }));
  }

  // ── 14. Pending Litigation table ──────────────────────────────────────────
  const liveRows = (litigationRows || []).filter(r => (r.statute || r.amount || r.forum));
  if (liveRows.length > 0) {
    paras.push(heading("Pending Litigation"));

    // Column widths sum to ~9000 dxa; A4 with template's tight margins gives
    // ~9100 dxa of body width, so 9000 fits comfortably.
    const widths = [600, 3400, 1600, 1200, 2200];
    const totalDxa = widths.reduce((a, b) => a + b, 0);

    const header = tableRow([
      tableCell("Sr",               { bold: true, widthDxa: widths[0] }),
      tableCell("Statute / Nature", { bold: true, widthDxa: widths[1] }),
      tableCell("Amount",           { bold: true, widthDxa: widths[2] }),
      tableCell("FY",               { bold: true, widthDxa: widths[3] }),
      tableCell("Forum",            { bold: true, widthDxa: widths[4] }),
    ]);
    const dataRows = liveRows.map(r => tableRow([
      tableCell(String(r.sr),       { widthDxa: widths[0] }),
      tableCell(r.statute || "—",   { widthDxa: widths[1] }),
      tableCell(r.amount  || "—",   { widthDxa: widths[2] }),
      tableCell(r.fy      || "—",   { widthDxa: widths[3] }),
      tableCell(r.forum   || "—",   { widthDxa: widths[4] }),
    ]));

    const tbl =
      `<w:tbl>` +
        `<w:tblPr>` +
          `<w:tblW w:w="${totalDxa}" w:type="dxa"/>` +
          `<w:tblBorders>` +
            `<w:top w:val="single" w:sz="4" w:color="000000"/>` +
            `<w:left w:val="single" w:sz="4" w:color="000000"/>` +
            `<w:bottom w:val="single" w:sz="4" w:color="000000"/>` +
            `<w:right w:val="single" w:sz="4" w:color="000000"/>` +
            `<w:insideH w:val="single" w:sz="4" w:color="000000"/>` +
            `<w:insideV w:val="single" w:sz="4" w:color="000000"/>` +
          `</w:tblBorders>` +
          `<w:tblLayout w:type="fixed"/>` +
        `</w:tblPr>` +
        `<w:tblGrid>${widths.map(w => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>` +
        header + dataRows.join("") +
      `</w:tbl>`;
    paras.push(tbl);
    paras.push(blank());
  }

  // ── 15. Signature Block ───────────────────────────────────────────────────
  paras.push(blank());
  paras.push(wPara(`For ${firmName || "[Firm Name]"},`,                   { leftAlign: true, bold: true, spaceAfter: 0 }));
  paras.push(wPara(`Chartered Accountants`,                                { leftAlign: true, italic: true, spaceAfter: 0 }));
  if (firmRegNo) paras.push(wPara(`Firm Registration No.: ${firmRegNo}`,   { leftAlign: true, spaceAfter: 60 }));
  paras.push(blank());
  paras.push(blank());
  paras.push(wPara(partnerName || "[Partner Name]",                        { leftAlign: true, bold: true, spaceAfter: 0 }));
  paras.push(wPara(`Partner`,                                              { leftAlign: true, spaceAfter: 0 }));
  if (partnerMemNo) paras.push(wPara(`Membership No.: ${partnerMemNo}`,    { leftAlign: true, spaceAfter: 0 }));
  if (udin) paras.push(wPara(`UDIN: ${udin}`,                              { leftAlign: true, spaceAfter: 60 }));
  paras.push(blank());
  paras.push(wPara(`Place: ${firmCity || ""}`,                              { leftAlign: true, spaceAfter: 0 }));
  paras.push(wPara(`Date: ${reportDate || ""}`,                             { leftAlign: true, spaceAfter: 0 }));

  // ─── Build document.xml ──────────────────────────────────────────────────
  // Page margins from template (twips):
  //   top=289 bottom=346 left=1151 right=720
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  mc:Ignorable="">
  <w:body>
    ${paras.join("\n    ")}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838" w:code="9"/>
      <!--
        Top + bottom margins bumped to 720 (~0.5") to give visible
        breathing room at the top and bottom of every page. The leading
        blank paragraphs at the top of the body add ~1" more on top of
        that for the title to sit at ~1.5" from the page edge — close
        to the template's visual mark.
      -->
      <w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="1151"
               w:header="720" w:footer="720" w:gutter="0"/>
      <w:cols w:space="708"/>
      <w:docGrid w:linePitch="360"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  // ─── styles.xml — Cambria 10 pt as document default ──────────────────────
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/>
        <w:sz w:val="20"/>
        <w:szCs w:val="20"/>
        <w:lang w:val="en-IN" w:eastAsia="en-IN" w:bidi="ar-SA"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:jc w:val="both"/>
        <w:spacing w:after="0" w:line="282" w:lineRule="atLeast"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:pPr>
      <w:jc w:val="both"/>
      <w:spacing w:after="0" w:line="282" w:lineRule="atLeast"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/>
      <w:sz w:val="20"/>
      <w:szCs w:val="20"/>
    </w:rPr>
  </w:style>
</w:styles>`;

  // ─── Build ZIP ────────────────────────────────────────────────────────────
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml"  ContentType="application/xml"/>
  <Override PartName="/word/document.xml"
    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml"
    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
    Target="word/document.xml"/>
</Relationships>`;

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"
    Target="styles.xml"/>
</Relationships>`;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypes);
  zip.file("_rels/.rels", rootRels);
  zip.file("word/document.xml", documentXml);
  zip.file("word/styles.xml", stylesXml);
  zip.file("word/_rels/document.xml.rels", docRels);

  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });

  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href    = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
