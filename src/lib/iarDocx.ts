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

  // Indent rules:
  //   - Centered paragraphs (title) get NO indent so they centre on the
  //     full text width.
  //   - Explicit indLeft from caller wins.
  //   - Otherwise apply the template's default body indent
  //     (left=180 right=365) so every body and heading paragraph sits
  //     at the same template-style ~0.125" left / ~0.25" right inset.
  if (opts.indLeft !== undefined) {
    const hanging = opts.indHanging ?? 0;
    pPrParts.push(
      hanging
        ? `<w:ind w:left="${opts.indLeft}" w:hanging="${hanging}"/>`
        : `<w:ind w:left="${opts.indLeft}"/>`,
    );
  } else if (!opts.centered) {
    pPrParts.push(`<w:ind w:left="180" w:right="365"/>`);
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

/** Hard page break paragraph — forces the next paragraph onto a new page. */
function pageBreakPara(): string {
  return `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
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
  // Size lowered from 11pt → 10pt (sz=22 → sz=20) to match the
  // template — most section headings (Basis for Opinion, Management's
  // Responsibility, Auditor's Responsibility, Other Legal & Regulatory)
  // render at body-size 10pt with bold weight as the only differentiator.
  return wPara(text, {
    leftAlign: true,
    bold: true,
    underline: opts.underline,
    fontSize: 10,
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
  // 3 leading blank paragraphs (~½" of additional air) combined with
  // the 720-twip top page margin (~0.5", set in sectPr below) give
  // about 1" of visible top whitespace before the title — closer to
  // the template's ruler position. Earlier 6-blank version pushed the
  // title ~1" too far down vs the template.
  for (let i = 0; i < 3; i++) paras.push(blank());

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
  // Template renders the entire addressee block in BOLD (To / The
  // Shareholders of / [Company Name] all bold). Earlier only the company
  // name was bold, leaving "To" and "The Shareholders of" in regular weight.
  paras.push(wPara("To",                  { leftAlign: true, fontSize: 11, bold: true, spaceAfter: 0 }));
  paras.push(wPara("The Shareholders of", { leftAlign: true, fontSize: 11, bold: true, spaceAfter: 0 }));
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
    // New template wording — drops "Cash Flow Statement" (without-CARO/IFC/CF
    // template excludes the Cash Flow reference entirely).
    `We have audited the accompanying financial statements of ${company} (“the Company”), ` +
    `which comprise the Balance Sheet as at ${fyEndDate}, and the statement of Profit and Loss ` +
    `for the year then ended, and notes to the financial statements ` +
    `including summary of significant accounting policies and other explanatory information.`,
    { spaceAfter: 60 },
  ));
  paras.push(wPara(
    `In our opinion and to the best of our information and according to the explanations given to us, ` +
    `the aforesaid financial statements give the information required by the Act in the manner so required ` +
    `and give a true and fair view in conformity with the accounting principles generally accepted in India, ` +
    // Template drops "and its cash flows" and uses lowercase "company".
    `of the state of affairs of the company as at ${fyEndDate}, and ${profitOrLoss} for the year ended on that date.`,
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

  // Page break before Auditor's Responsibility — template puts a
  // ": :  2  : :" marker between Management's Responsibility and
  // Auditor's Responsibility (i.e. page 2 of the 3-page template).
  paras.push(pageBreakPara());
  paras.push(wPara(": :  2  : :", { centered: true, fontSize: 11, spaceAfter: 240 }));

  // ── 9. Auditor's Responsibility ───────────────────────────────────────────
  // Template renders this heading with TWO spaces between "Auditor's"
  // and "Responsibility" — preserved verbatim.
  paras.push(heading("Auditor’s  Responsibility"));
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

  // ── 10. Report on Other Legal and Regulatory Requirements ────────────────
  // Template emits a fixed paragraph that handles CARO exemption + IFC
  // exemption inline, plus a lettered (a)-(h) list with sub-items i-iv
  // for Rule 11 reporting. No separate Going Concern, Audit Trail, or
  // CARO sections — they're integrated here per the new corporate
  // template (FORMAT_AR2526 without CARO, IFC and Cash Flow).
  //
  // Page break before this section — template marks page 3 with a
  // literal ": :  3  : :" centered band immediately before "Report on
  // Other Legal and Regulatory Requirements".
  paras.push(pageBreakPara());
  paras.push(wPara(": :  3  : :", { centered: true, fontSize: 11, spaceAfter: 240 }));
  paras.push(heading("Report on Other Legal and Regulatory Requirements"));
  paras.push(wPara(
    `The Company is a private limited and falls within exemptions specified under paragraph 2(iv) of the ` +
    `Companies (Auditor’s Report) Order, 2020. Hence matters specified in paragraph 3 and 4 of the said order ` +
    `issued by the Central Government of India in terms of sub-section (11) of section143 of the Act, are not enclosed`,
    { spaceAfter: 100 },
  ));
  paras.push(wPara(
    `As required by section 143(3) of the Act, we further report that:`,
    { spaceAfter: 80 },
  ));

  // (a)-(h) lettered list — literal text prefixes per template style.
  const letterItem = (label: string, text: string): string =>
    wPara(`${label} ${text}`, { spaceAfter: 60, indLeft: 360, indHanging: 360 });

  paras.push(letterItem("a)",
    `We have sought and obtained all the information and explanations which to the best of our knowledge and ` +
    `belief were necessary for the purpose of our audit;`));
  paras.push(letterItem("b)",
    `In our opinion proper books of account as required by law have been kept by the Company so far as it ` +
    `appears from our examination of those books;`));
  paras.push(letterItem("c)",
    branchText && branchText.trim()
      ? branchText
      : `The company does not have any branch, this para is not applicable.`));
  paras.push(letterItem("d)",
    `The Balance Sheet and Statement of Profit and Loss dealt with by this Report are in agreement with the ` +
    `books of account;`));
  paras.push(letterItem("e)",
    `In our opinion, the aforesaid financial statements comply with the Accounting Standards specified under ` +
    `Section 133 of the Act, read with Rule 7 of the Companies (Accounts) Rules 2014.`));
  paras.push(letterItem("f)",
    `On the basis of written representations received from the directors as on ${fyEndDate}, and taken on record ` +
    `by the Board of Directors, none of the directors is disqualified as on ${fyEndDate}, from being appointed ` +
    `as a director in terms of Section 164(2) of the Act.`));
  paras.push(letterItem("g)",
    `The report on adequacy of the internal financial control over financial reporting is not applicable as the ` +
    `company is falls within the exemptions specified under sub-section 3(1) of section 143 of the Act.`));
  paras.push(letterItem("h)",
    `In our opinion and to the best of our information and according to the explanations given to us, we report ` +
    `with respect to other matters to be included in the Auditor’s Report in accordance with Rule 11 of the ` +
    `Companies (Audit and Auditors) Rules, 2014 as under:`));

  // Roman sub-items i. - iv. under (h)
  const romanItem = (label: string, text: string): string =>
    wPara(`${label} ${text}`, { spaceAfter: 60, indLeft: 720, indHanging: 360 });

  paras.push(romanItem("i.",
    `The Company does not have any pending litigations which would impact on its financial position.`));
  paras.push(romanItem("ii.",
    `The Company did not have any long-term contracts including derivative contracts for which there were any ` +
    `material foreseeable losses.`));
  paras.push(romanItem("iii.",
    `There were no amounts which were required to be transferred to the Investor Education and Protection Fund ` +
    `by the Company.`));
  paras.push(romanItem("iv.",
    auditTrailText && auditTrailText.trim()
      ? `Based on our examination, ${auditTrailText}`
      : `Based on our examination, the Company has used accounting software for maintaining its books of account, ` +
        `which has a feature of recording audit trail (edit log) facility and as informed by the management the ` +
        `same has operated throughout the year for all relevant transactions recorded in the software.`));

  paras.push(blank());
  paras.push(blank());

  // ── 11. Signature block — 2-column borderless table ──────────────────────
  // Template uses a 2-column borderless table:
  //   Left  | Right
  //   For, V. J. Desai & Co. | (empty)
  //   Chartered Accountants  | (empty)
  //   Firm Regi.No.<frn>     | (empty)
  //   (empty)                | Place:  <city>
  //   (empty)                | Date:   <date>
  //   <partner name>         | (empty)
  //   Partner                | UDIN: <udin>
  //   Membership No.<memno>  | (empty)
  const sigCell = (text: string, widthDxa: number): string => {
    const tcPr =
      `<w:tcPr>` +
      `<w:tcW w:w="${widthDxa}" w:type="dxa"/>` +
      `<w:tcBorders>` +
        `<w:top    w:val="nil"/>` +
        `<w:left   w:val="nil"/>` +
        `<w:bottom w:val="nil"/>` +
        `<w:right  w:val="nil"/>` +
      `</w:tcBorders>` +
      `</w:tcPr>`;
    const para = wPara(text, { leftAlign: true, bold: true, fontSize: 11, spaceAfter: 0 });
    return `<w:tc>${tcPr}${para}</w:tc>`;
  };
  const sigRow2 = (left: string, right: string): string =>
    `<w:tr>${sigCell(left, 6030)}${sigCell(right, 3526)}</w:tr>`;

  const firmDisplay     = firmName    ? `For, ${firmName}`               : `For, [Firm Name]`;
  const frnLine         = firmRegNo   ? `Firm Regi.No.${firmRegNo}`      : `Firm Regi.No.____`;
  const partnerDisplay  = partnerName || `[Partner Name]`;
  const memberDisplay   = partnerMemNo ? `Membership No.${partnerMemNo}` : `Membership No.____`;
  const placeLine       = `Place:  ${firmCity || ""}`;
  const dateLine        = `Date:   ${reportDate || ""}`;
  const udinLine        = udin ? `UDIN: ${udin}` : `UDIN:`;

  const sigTbl =
    `<w:tbl>` +
      `<w:tblPr>` +
        `<w:tblW w:w="9556" w:type="dxa"/>` +
        `<w:tblBorders>` +
          `<w:top    w:val="nil"/>` +
          `<w:left   w:val="nil"/>` +
          `<w:bottom w:val="nil"/>` +
          `<w:right  w:val="nil"/>` +
          `<w:insideH w:val="nil"/>` +
          `<w:insideV w:val="nil"/>` +
        `</w:tblBorders>` +
        `<w:tblLayout w:type="fixed"/>` +
      `</w:tblPr>` +
      `<w:tblGrid><w:gridCol w:w="6030"/><w:gridCol w:w="3526"/></w:tblGrid>` +
      sigRow2(firmDisplay,         "") +
      sigRow2("Chartered Accountants", "") +
      sigRow2(frnLine,             "") +
      sigRow2("",                  placeLine) +
      sigRow2("",                  dateLine) +
      sigRow2(partnerDisplay,      "") +
      sigRow2("Partner",           udinLine) +
      sigRow2(memberDisplay,       "") +
    `</w:tbl>`;
  paras.push(sigTbl);

  // Trailing whitespace at the bottom of the last page — user asked
  // for visible space at the bottom matching the template.
  paras.push(blank());
  paras.push(blank());
  paras.push(blank());

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
      <!--
        Headers removed — replaced with a literal ": : 2 : :" band
        emitted inline as a centered paragraph immediately after the
        page break (see "Page-number band" comment in the body
        builder above). This matches how the template encodes its
        page numbers (typed text, not a Word PAGE field — fields
        sometimes fail to render in protected-view / non-Word viewers
        and show the static fallback instead of the live page number).
      -->
      <w:pgSz w:w="11906" w:h="16838" w:code="9"/>
      <w:pgMar w:top="720" w:right="720" w:bottom="1080" w:left="1151"
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
  // Header parts not used — page-number band is emitted inline as a
  // body paragraph immediately after the page break, matching the
  // template's literal ": : 2 : :" idiom.
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
