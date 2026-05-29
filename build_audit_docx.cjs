const path = require("path");
const fs = require("fs");
const docx = require(path.join("C:", "Users", "kvdes", "AppData", "Roaming", "npm", "node_modules", "docx"));
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, TabStopType, TabStopPosition,
  TableOfContents, HeadingLevel, BorderStyle, WidthType, ShadingType,
  VerticalAlign, PageNumber, PageBreak, Header, Footer,
} = docx;

// ---- A4 geometry ----
const PAGE_W = 11906, PAGE_H = 16838, MARGIN = 1440;
const CONTENT_W = PAGE_W - MARGIN * 2; // 9026

// ---- helpers ----
const t = (text, opts = {}) => new TextRun({ text, ...opts });
const b = (text, opts = {}) => new TextRun({ text, bold: true, ...opts });
const mono = (text) => new TextRun({ text, font: "Consolas", size: 19 });
const ital = (text) => new TextRun({ text, italics: true });

const P = (children, opts = {}) =>
  new Paragraph({ children: Array.isArray(children) ? children : [t(children)], spacing: { after: 120 }, ...opts });

const H1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [t(text)] });
const H2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [t(text)] });
const H3 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [t(text)] });

// bullet accepts an array of TextRuns OR a string
const BUL = (children, level = 0) =>
  new Paragraph({
    numbering: { reference: "bullets", level },
    spacing: { after: 60 },
    children: Array.isArray(children) ? children : [t(children)],
  });
const NUM = (children) =>
  new Paragraph({
    numbering: { reference: "qwins", level: 0 },
    spacing: { after: 80 },
    children: Array.isArray(children) ? children : [t(children)],
  });

const border = { style: BorderStyle.SINGLE, size: 1, color: "BBBBBB" };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 60, bottom: 60, left: 110, right: 110 };

const sevColor = (sev) => {
  const s = sev.toUpperCase();
  if (s.startsWith("CRITICAL")) return "F4CCCC";
  if (s.startsWith("HIGH")) return "FCE5CD";
  if (s.startsWith("MEDIUM")) return "FFF2CC";
  if (s.startsWith("LOW")) return "EFEFEF";
  return "FFFFFF";
};

function cell(text, width, { bold = false, fill = null, align = AlignmentType.LEFT, size = 19 } = {}) {
  return new TableCell({
    borders, width: { size: width, type: WidthType.DXA }, margins: cellMargins,
    verticalAlign: VerticalAlign.CENTER,
    shading: fill ? { fill, type: ShadingType.CLEAR } : undefined,
    children: [new Paragraph({ alignment: align, children: [new TextRun({ text, bold, size })] })],
  });
}

// ================= PRIORITY MATRIX DATA =================
const matrixCols = [520, 3650, 1180, 2496, 1180]; // = 9026
const matrixRows = [
  ["1", "users/clients/fa_categories queries with no explicit tenant filter — VERIFY RLS (§2.1)", "CRITICAL*", "Possible cross-tenant data exposure if RLS gaps exist", "Low (audit)"],
  ["2", "IT Returns loads all ~708 clients + all profiles, no .limit() (§2.2)", "HIGH", "Slow first paint, memory spikes, worsens yearly", "Med"],
  ["3", "Clients list unbounded fetch + unmemoized filter/tab-counts (§2.2, 2.3)", "HIGH", "Sluggish typing/scrolling on large firms", "Med"],
  ["4", "Silent query failures: { data } w/o error + empty catch{} (§3.2)", "HIGH", "Blank/stale screens, no feedback on failure", "Med"],
  ["5", "N+1 write loops (ClientDetail, Depreciation, TDS migration, Billing) (§2.1)", "HIGH", "Multi-second freezes / partial writes on bulk ops", "Med"],
  ["6", "TallySyncPage unmemoized reductions over thousands of TB rows (§2.3)", "HIGH", "Laggy scroll/typing on the Tally screen", "Med"],
  ["7", "Hardcoded firm name 'V J Desai & Co.' in client-creation logic (§3.3)", "HIGH", "Breaks correctness for a 2nd tenant", "Low"],
  ["8", "Filter-change effects fire writes/queries with no debounce (§2.3, 2.5)", "MEDIUM", "Redundant network churn, UI jank", "Med"],
  ["9", "Hardcoded FY_OPTIONS / default FY in ~8 files (§3.3)", "MEDIUM", "Stale year choices each April", "Low"],
  ["10", "Heavy export libs statically imported into page chunks (§2.4)", "MEDIUM", "Slower page-open even without exporting", "Med"],
  ["11", "Page H1 typography drift (text-lg→2xl, font-display ~60%) (§1.5)", "MEDIUM", "Inconsistent, less polished feel", "Low"],
  ["12", "No shared EmptyState / loading convention (3 patterns) (§1.8, 1.9)", "MEDIUM", "Inconsistent 'no data' / loading UX", "Med"],
  ["13", "~28 raw <table> in NotesToAccounts + admin pages (§1.4)", "MEDIUM", "Header/hover/padding inconsistency", "Med"],
  ["14", "215 hardcoded hex colors; bg-white over bg-card (§1.1)", "MEDIUM", "Dark-mode / theme breakage", "Med"],
  ["15", "16 content pages with zero responsive classes (§1.10)", "MEDIUM", "Overflow / unusable on mobile", "High"],
  ["16", "errorUtils.ts exists but used once; 234 ad-hoc toast.error (§3.2)", "MEDIUM", "Inconsistent error messaging", "Med"],
  ["17", "~25 duplicate date + 5 currency formatters (§3.1)", "LOW", "No visible impact; maintenance drag", "Med"],
  ["18", "Hardcoded GST 18% / FY-specific TDS tables (§3.3)", "MEDIUM", "Wrong tax math after a Finance Act change", "Med"],
  ["19", "8 component files >2,000 lines (§2.6)", "LOW", "Maintainability only", "High"],
  ["20", "Hand-rolled destructive/default buttons; 109 raw <button> (§1.2)", "LOW", "Minor focus/hover inconsistency", "Low"],
];

function matrixTable() {
  const head = new TableRow({
    tableHeader: true,
    children: ["#", "Issue", "Severity", "Impact on User", "Effort"].map((h, i) =>
      cell(h, matrixCols[i], { bold: true, fill: "D9D9D9", align: i === 0 ? AlignmentType.CENTER : AlignmentType.LEFT })),
  });
  const rows = matrixRows.map((r) =>
    new TableRow({
      children: r.map((val, i) => {
        if (i === 0) return cell(val, matrixCols[i], { align: AlignmentType.CENTER });
        if (i === 2) return cell(val, matrixCols[i], { bold: true, fill: sevColor(val), align: AlignmentType.CENTER });
        return cell(val, matrixCols[i]);
      }),
    }));
  return new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: matrixCols, rows: [head, ...rows] });
}

// ================= LARGE FILES TABLE =================
const lfCols = [6526, 2500];
const lfData = [
  ["src/components/pipeline/PipelineFinancialStatements.tsx", "7,771"],
  ["src/components/pipeline/PipelineStage3.tsx", "4,434"],
  ["src/components/stage8/NCEDetailedNotes.tsx", "2,805"],
  ["src/pages/Depreciation.tsx", "2,741"],
  ["src/pages/TallySyncPage.tsx", "2,675"],
  ["src/components/billing/LedgerTab.tsx", "2,523"],
  ["src/components/tds/TdsDataEntry.tsx", "2,187"],
  ["src/pages/Billing.tsx", "2,105"],
];
function largeFilesTable() {
  const head = new TableRow({
    tableHeader: true,
    children: [cell("File", lfCols[0], { bold: true, fill: "D9D9D9" }), cell("Lines", lfCols[1], { bold: true, fill: "D9D9D9", align: AlignmentType.CENTER })],
  });
  const rows = lfData.map((r) => new TableRow({
    children: [
      new TableCell({ borders, width: { size: lfCols[0], type: WidthType.DXA }, margins: cellMargins,
        children: [new Paragraph({ children: [mono(r[0])] })] }),
      cell(r[1], lfCols[1], { align: AlignmentType.CENTER }),
    ],
  }));
  return new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: lfCols, rows: [head, ...rows] });
}

// ================= DOCUMENT BODY =================
const body = [];

// Title block
body.push(new Paragraph({ spacing: { before: 1800, after: 0 }, alignment: AlignmentType.CENTER,
  children: [new TextRun({ text: "CAFlow", bold: true, size: 64, font: "Arial" })] }));
body.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 },
  children: [new TextRun({ text: "Full Application Audit", size: 40, color: "555555" })] }));
body.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 },
  children: [new TextRun({ text: "UI/UX Consistency • Performance • Architecture", size: 24, color: "777777" })] }));
body.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 600, after: 40 },
  children: [b("Prepared for: "), t("Kunal Desai")] }));
body.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 },
  children: [b("Date: "), t("29 May 2026")] }));
body.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 },
  children: [b("Scope: "), t("367 source files, ~175k lines — React + Supabase")] }));
body.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 },
  children: [b("Status: "), t("Read-only audit — no files modified, app not run")] }));
body.push(new Paragraph({ children: [new PageBreak()] }));

// TOC
body.push(new Paragraph({ children: [new TextRun({ text: "Contents", bold: true, size: 32, font: "Arial" })], spacing: { after: 160 } }));
body.push(new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-2" }));
body.push(new Paragraph({ children: [new PageBreak()] }));

// Intro
body.push(H1("Overview & Methodology"));
body.push(P([
  t("This is a read-only audit of CAFlow (an AI-powered audit SaaS for Indian CA firms). "),
  b("No files were modified and the app was not run. "),
  t("I read the design-system foundations (Tailwind config, index.css, shadcn primitives) and the highest-traffic pages in full, and ran exhaustive grep scans across the whole tree. All findings cite exact file:line references."),
]));
body.push(P([
  b("Honest caveat: "),
  t("with 826 .from() calls across 100+ files, the heaviest pages were sampled rather than every query read line-by-line. Flagged items are confirmed; “verify RLS” items need your confirmation of row-level-security coverage."),
]));
body.push(H2("Design-system baseline (the good news first)"));
body.push(P([
  t("CAFlow has a proper token system — HSL CSS variables in "), mono("index.css:8-54"),
  t(" mapped to Tailwind tokens in "), mono("tailwind.config.ts:18-65"),
  t(", a gold primary ("), mono("42 52% 54%"), t("), Inter/Space Grotesk fonts, a full shadcn primitive set, route-level code-splitting ("),
  mono("App.tsx"), t(" — 66 lazy()/Suspense), and a solid "), mono("ErrorBoundary.tsx"),
  t(". The problems below are "), b("drift from a good system, not the absence of one."),
]));

// ---------- SECTION 1 ----------
body.push(new Paragraph({ children: [new PageBreak()] }));
body.push(H1("Section 1 — UI/UX Audit Findings"));

body.push(H2("1.1 Design Token Issues"));
body.push(BUL([b("215 hardcoded hex colors across 31 .tsx files. "), t("Worst: "), mono("EmailTemplatesTab.tsx"), t(" (80, partly justified email HTML), "), mono("AuditTrackerLayout.tsx"), t(" (26), "), mono("TdsFilingsManager.tsx"), t(" (12), "), mono("NotesMismatchPanel.tsx"), t(" (10), "), mono("Clients.tsx"), t(" (9). Many should be "), mono("text-destructive"), t(" / "), mono("bg-primary"), t(" tokens; hardcoded hex breaks dark mode and theme-studio overrides.")]));
body.push(BUL([b("bg-white instead of token bg-card "), t("— "), mono("Clients.tsx:635"), t(", several in "), mono("TallySyncPage.tsx"), t(", "), mono("LedgerVouchersView.tsx"), t(". Only survive dark mode where a "), mono("dark:"), t(" override was hand-added.")]));
body.push(BUL([b("Magic number "), mono("h-[calc(100vh-4rem)]"), t(" repeated in 3+ full-height pages ("), mono("AuditPipeline.tsx:958"), t(", "), mono("TdsFilings.tsx:153"), t(", NotesToAccounts) rather than a shared layout constant.")]));

body.push(H2("1.2 Button Inconsistencies"));
body.push(BUL([t("Shared "), mono("<Button>"), t(" (canonical gold default, "), mono("button.tsx:12"), t(") is used widely — good. But:")]));
body.push(BUL([b("Default variant re-implemented by hand: "), mono("Login.tsx:267"), t(" & "), mono("Login.tsx:302"), t(" use "), mono("bg-primary text-primary-foreground hover:bg-primary/90"), t(" instead of the default variant. Brittle if the token changes.")], 1));
body.push(BUL([b("Destructive variant bypassed: "), mono("Clients.tsx:1089"), t(" & "), mono("Clients.tsx:1106"), t(" hand-roll "), mono("bg-destructive…"), t(" on AlertDialogAction instead of "), mono("variant=\"destructive\""), t(".")], 1));
body.push(BUL([b("~109 raw <button> elements across 34 page files "), t("(heaviest: NotesToAccounts ~28, Clients ~10) — segmented toggles, tabs, chips ("), mono("Clients.tsx:578-599"), t(", "), mono("ServiceMasters.tsx:365"), t(", "), mono("TdsFilings.tsx:163"), t("). Inconsistent focus rings/hover vs "), mono("<Button>"), t(".")], 1));

body.push(H2("1.3 Card / Panel Inconsistencies"));
body.push(BUL([t("Shared "), mono("<Card>"), t(" is "), mono("rounded-lg border bg-card shadow-sm"), t(" ("), mono("card.tsx:6"), t("). Hand-rolled panels drift: "), b("rounded-lg vs rounded-md vs rounded-xl"), t(" mixed within a single page ("), mono("Clients.tsx:544/577/635/863"), t(").")]));
body.push(BUL([b("Stat-card inner padding inconsistent for the same pattern: "), mono("p-5"), t(" ("), mono("Index.tsx:283"), t("), "), mono("p-4"), t(" ("), mono("Billing.tsx:1108"), t("), "), mono("pt-4"), t(" only ("), mono("NoticeTracker.tsx:296"), t(").")]));

body.push(H2("1.4 Table Inconsistencies"));
body.push(BUL([t("Split between shared "), mono("<Table>"), t(" ("), mono("table.tsx"), t(", TableHead "), mono("h-12 px-4"), t(", TableCell "), mono("p-4"), t(", row "), mono("hover:bg-muted/50"), t(") and "), b("raw <table className=\"w-full text-sm\">"), t(".")]));
body.push(BUL([b("Raw tables (no shared styling): "), mono("AccessPermissions.tsx:253/616"), t(", "), mono("RolesPermissions.tsx:300"), t(", "), mono("AdminFirmAccess.tsx:405"), t(", "), mono("InternalTeam.tsx:278"), t(", "), mono("ImportTrialBalance.tsx:814"), t(", "), mono("LedgerVouchersView.tsx:348"), t(", 3× in TallySyncPage, and "), b("~28 raw tables in NotesToAccounts"), t(".")]));
body.push(BUL([b("Header bg inconsistent: "), t("raw tables use "), mono("bg-muted/50"), t("; "), mono("ItReturns.tsx:1008"), t(" uses sticky "), mono("bg-background"), t("; Clients adds none. "), b("Cell padding differs "), t("("), mono("py-2 px-2"), t(" raw vs "), mono("p-4"), t(" shared) → column rhythm changes page-to-page. Row hover present only on some.")]));

body.push(H2("1.5 Typography Hierarchy Issues"));
body.push(P([t("Page H1 has "), b("no single standard"), t(" — ranges "), mono("text-lg"), t(" → "), mono("text-2xl"), t(" → "), mono("text-3xl/4xl"), t(":")]));
body.push(BUL([b("Canonical (text-2xl font-display font-bold): "), t("Clients:572, Index:222, ItReturns:620, ServiceMasters:277, FirmSettings:295, ClientDetail:872, Documents:246.")]));
body.push(BUL([b("Dropped font-display (subtle font-family mismatch): "), mono("Billing.tsx:235"), t(", "), mono("NoticeTracker.tsx:201"), t(", "), mono("AuditScrutiny.tsx:263"), t(", "), mono("EngagementDetail.tsx:150"), t(", "), mono("TallySyncPage.tsx:1414"), t(", "), mono("ComparativeStatements.tsx:252"), t(".")]));
body.push(BUL([b("Noticeably smaller (text-lg) editor/stage pages: "), mono("AuditPipeline.tsx:984"), t(", "), mono("NotesToAccounts.tsx:450"), t(", "), mono("NewInvoice.tsx:1022"), t(", "), mono("Form3CD.tsx:387"), t(". font-semibold vs font-bold also varies.")]));
body.push(BUL([t("Note: shadcn "), mono("CardTitle"), t(" is "), mono("text-2xl"), t(" ("), mono("card.tsx:19"), t(") — same size as some page titles, so card headers can visually compete with the page H1.")]));

body.push(H2("1.6 Spacing Inconsistencies"));
body.push(BUL([b("Vertical rhythm: "), t("most pages use "), mono("<div className=\"space-y-6\">"), t(". Outliers: "), mono("ItReturns.tsx:616"), t(" uses "), mono("mb-4"), t(" on the header with no "), mono("space-y-*"), t(" wrapper; Depreciation trends to "), mono("space-y-4"), t(".")]));
body.push(BUL([b("Double-inset risk: "), mono("AppLayout"), t(" <main> already pads "), mono("p-6"), t(" desktop / "), mono("p-3"), t(" mobile ("), mono("AppLayout.tsx:42"), t("). Full-height flex pages ("), mono("TdsFilings.tsx:153"), t(") sit inside that padding → inconsistent inset vs card pages.")]));

body.push(H2("1.7 Form Inconsistencies"));
body.push(BUL([t("Inputs largely use shared "), mono("<Input>"), t(" ("), mono("h-10"), t(") — consistent height/border/focus. But many filter inputs hardcode "), mono("h-8 text-xs"), t(" ("), mono("NoticeTracker.tsx:358"), t(", worksheet masters) → mixed input heights within the same screen.")]));
body.push(BUL([b("No consistent required-field (*) convention "), t("and "), b("no shared error-display pattern"), t(" — forms rely on ad-hoc "), mono("toast.error"), t(" rather than inline field errors (react-hook-form + zod are installed but unevenly applied).")]));

body.push(H2("1.8 Empty-State Issues"));
body.push(BUL([b("No shared <EmptyState> component "), t("— every list reinvents it. Polished (icon + message in a Card): "), mono("Clients.tsx:843-859"), t(", "), mono("Depreciation.tsx:2103"), t(". "), b("Bare text only: "), mono("NoticeTracker.tsx:383"), t(", "), mono("ItReturns.tsx:1098"), t(", "), mono("Billing.tsx:1683"), t(", "), mono("Timesheets.tsx:519"), t(", "), mono("ErpLedger.tsx:94"), t(". Padding for the same concept varies "), mono("py-4 / py-8 / py-10 / py-16"), t(".")]));

body.push(H2("1.9 Loading-State Issues"));
body.push(BUL([b("Three coexisting patterns, no rule: "), mono("<Skeleton>"), t(" (75 uses / 36 files), "), mono("Loader2 animate-spin"), t(" spinner (74 uses / 30 files), and "), b("nothing"), t(" (raw admin tables render blank during load). Mixed even within one page: "), mono("ServiceMasters.tsx:271"), t(" skeleton on load but "), mono("ServiceMasters.tsx:380"), t(" spinner in button; "), mono("FirmSettings.tsx:288"), t(" full-page spinner where list pages use skeleton rows.")]));

body.push(H2("1.10 Mobile Responsiveness Gaps"));
body.push(BUL([t("Responsive classes appear in only "), b("38 of ~54 page files."), t(" Pages with "), b("zero "), mono("sm:/md:/lg:"), t(": Depreciation, NotesToAccounts, ComparativeStatements, Form3CD, Form3Reports, TdsFilings, Timesheets, UserManagement, RolesPermissions, AccessPermissions, NewClientWizard, NewInvoice, ErpLedger, LedgerVouchersView, AuditReportEngine, and most worksheet masters — these will overflow on mobile.")]));
body.push(BUL([b("Mitigations exist: "), t("MobileBottomNav / MobileDrawer / MobileFAB, "), mono("use-mobile"), t(" hook, and "), mono(".table-scroll-mobile"), t(" ("), mono("index.css:133"), t("). So "), b("navigation"), t(" is mobile-aware but "), b("content/tables/forms"), t(" on the above pages are not.")]));

// ---------- SECTION 2 ----------
body.push(new Paragraph({ children: [new PageBreak()] }));
body.push(H1("Section 2 — Performance Audit Findings"));

body.push(H2("2.1 Dangerous Queries (Priority: CRITICAL)"));
body.push(BUL([b("select('*') is the dominant pattern "), t("(100+ call sites). Costly on wide tables: "), mono("ClientDetail.tsx:239-260"), t(" (clients, client_services, client_service_packages, scrutiny_findings, itr_profiles all *), "), mono("Billing.tsx:370"), t(" (invoices.*), "), mono("TdsFilingsManager.tsx:296/581"), t(", "), mono("Depreciation.tsx:201-278"), t(" (fa_assets.*).")]));
body.push(BUL([b("N+1 write/read loops:")]));
body.push(BUL([mono("ClientDetail.tsx:720-723"), t(" — one UPDATE per filing in a for loop.")], 1));
body.push(BUL([mono("Depreciation.tsx:543-559"), t(" — one UPDATE per asset on finalize.")], 1));
body.push(BUL([mono("TdsFilingsManager.tsx:597-615"), t(" — nested per-challan/per-deductee serial insert+select+update (heavy N×M).")], 1));
body.push(BUL([mono("Billing.tsx:741-786"), t(" — handleBulkSend invokes the edge function once per invoice serially.")], 1));
body.push(BUL([mono("Clients.tsx:280-307"), t(" — outer batch loop + inner while paging memberships + per-batch services query, all serial.")], 1));
body.push(BUL([b("Verify-RLS (no explicit tenant filter): "), mono("ItReturns.tsx:422"), t(" (users — all rows), "), mono("ClientDetail.tsx:243"), t(" (users), "), mono("Documents.tsx:98"), t(" (clients), "), mono("Depreciation.tsx:190"), t(" (fa_categories). If RLS scopes these, fine; if not, this is a "), b("cross-tenant data-leak risk"), t(" — please confirm.")]));

body.push(H2("2.2 Missing Pagination (Priority: HIGH)"));
body.push(BUL([b("IT Returns loads everything: "), mono("ItReturns.tsx:378-389"), t(" fetches "), b("all"), t(" active clients (no .limit()), then "), mono("ItReturns.tsx:391"), t(" all itr_profiles. Client-side pagination ("), mono("ItReturns.tsx:754"), t(") only slices after all ~708 rows are in memory. "), b("Confirmed."), t("")]));
body.push(BUL([mono("Clients.tsx:240"), t(" main query has "), b("no .limit()"), t("; drafts/archived also unbounded ("), mono("Clients.tsx:336/355"), t("); draft query uses "), mono(".limit(2000)"), t(" = effectively unbounded.")]));
body.push(BUL([mono("Billing.tsx:370"), t(" invoices/clients/firms all unbounded; "), mono("Depreciation.tsx:168"), t(" all company clients.")]));
body.push(BUL([b("Coarse caps that silently truncate: "), mono("TdsFilingsManager.tsx:296"), t(" .limit(500), "), mono("Documents.tsx:120"), t(" .limit(500), "), mono("Billing.tsx:1975"), t(" timesheets .limit(1000).")]));

body.push(H2("2.3 Re-render Problems (Priority: HIGH)"));
body.push(BUL([b("Unmemoized filtering/sorting in render body "), t("(recomputes every keystroke/render):")]));
body.push(BUL([mono("Clients.tsx:465-499"), t(" filtered + pagination slice; "), mono("Clients.tsx:680-694"), t(" six clients.filter() tab-count passes per render.")], 1));
body.push(BUL([mono("TallySyncPage.tsx:660-681"), t(" filteredGroups/Ledgers/TB/Vouchers over thousands of rows; "), mono("TallySyncPage.tsx:757-827"), t(" large TB total reductions, all unmemoized. "), b("Worst render-cost page.")], 1));
body.push(BUL([mono("Documents.tsx:129-157"), t(" folder counts + filter; "), mono("ClientDetail.tsx:1044-1067"), t(" Services-tab IIFE.")], 1));
body.push(BUL([b("Effects firing queries without debounce: "), mono("Documents.tsx:104"), t(" (refetch on every folder click), "), mono("TdsFilingsManager.tsx:323"), t(" (filter change → write-backfill + refetch), "), mono("Billing.tsx:435-450"), t(". "), mono("TallySyncPage.tsx:504-532"), t(" recreates its polling interval whenever batches changes (dep churn).")]));
body.push(BUL([b("Good news: "), t("no effect runs every render (none missing a dep array); Billing's stats/filtered/grouped are memoized.")]));

body.push(H2("2.4 Bundle-Size Issues (Priority: MEDIUM)"));
body.push(BUL([b("No lodash/moment "), t("(good). date-fns is tree-shakeable.")]));
body.push(BUL([b("Heavy export libs imported statically at module top "), t("in lazy-loaded pages: xlsx ("), mono("Clients.tsx:21"), t(", "), mono("Billing.tsx:52"), t(", "), mono("Depreciation.tsx:23"), t("), exceljs, jspdf, docx, jszip, html2pdf, html2canvas, recharts. Routes are code-split so they miss the main bundle — but they load the moment you open the page, even if you never export. Should be "), mono("await import()"), t(" inside the export handler. "), mono("PipelineFinancialStatements.tsx"), t(" (7,771 lines) pulls both xlsx and exceljs.")]));
body.push(BUL([t("Icons (lucide) and images are fine — only user-uploaded logos/chat attachments, no bundled raster assets.")]));

body.push(H2("2.5 Waterfall API Calls (Priority: MEDIUM)"));
body.push(BUL([mono("ClientDetail.tsx:258-260"), t(" — three independent awaits run serially in separate try/catch blocks after the Promise.all at line 238; should fold into the Promise.all.")]));
body.push(BUL([mono("ItReturns.tsx:386→394→402→422"), t(" — clients → profiles → classifications → users run sequentially; users + classifications are independent.")]));
body.push(BUL([mono("TdsFilingsManager.tsx:287-321"), t(" — syncMissingFilings (itself several serial queries) is fully awaited before the main fetch, on every filter change.")]));

body.push(H2("2.6 Large Component Files (Priority: MEDIUM)"));
body.push(P([t("Files over 300 lines doing too much (top of a long list; "), mono("integrations/supabase/types.ts"), t(" at 8,773 is generated — excluded):")]));
body.push(largeFilesTable());

// ---------- SECTION 3 ----------
body.push(new Paragraph({ children: [new PageBreak()] }));
body.push(H1("Section 3 — Architecture Issues"));

body.push(H2("3.1 Duplicate Logic"));
body.push(BUL([b("~25+ near-identical local fmtDate/formatDate functions "), t("(TaxAuditMaster:62, StatutoryAuditMaster:58, MergedAuditMaster:47, InternalAuditMaster:58, LedgerSidePanel:106, AuditReportGenerator:50, plus tds-recon, ntaDocx, mrlDocx, PortalQueries:76, TallySyncPage:124…) plus renamed variants (formatDateDDMMYYYY, fmtDateDisplay, formatDateTime). No shared date util.")]));
body.push(BUL([b("≥5 distinct INR/currency formatters: "), mono("fsUnits.tsx:53"), t(" formatINRWhole (most complete), plus formatINR in EditableCell:32, PortalHome:31, PipelineFinancialStatements:253, TdsReports:41; inline "), mono("toLocaleString(\"en-IN\")"), t(" across ~89 files.")]));
body.push(BUL([b("FY parsing duplicated despite existing helpers "), t("in "), mono("entityUtils.ts"), t("/"), mono("classificationUtils.ts"), t(": getCurrentFY() redefined in 5 files, generateFYOptions() twice, 'prev FY' string math copy-pasted ~10× in PipelineStage3 / PipelineFinancialStatements.")]));
body.push(BUL([b("Repeated raw fetches with no shared hook: "), t("clients queried in ~48 files, audit_engagements ~50, firms ~38, users ~48. Shared hooks exist only in "), mono("audit-tracker/hooks/"), t(". Centralized & clean (good): "), mono("normalise-ledger-name.ts"), t(", "), mono("gstinUtils.ts"), t(", "), mono("firmName.ts"), t("/"), mono("firmResolver.ts"), t(".")]));

body.push(H2("3.2 Missing Error Handling"));
body.push(BUL([b("~40+ { data } destructured without error "), t("(silent failures) — e.g. PipelineStage4:83/97/111/143, PipelineStage3:466/476/522, AuditPipeline:186/442/483, ReceiptsTab:179/187/195. On failure the user gets stale/empty state and no toast.")]));
body.push(BUL([b("Empty catch{} swallowing Supabase errors "), t("— most damaging at "), mono("ClientDetail.tsx:258-260"), t(" (failed scrutiny_findings/itr_profiles silently → []/null); also Clients:350/365, ComparativeStatements:226.")]));
body.push(BUL([b("A clean helper "), mono("errorUtils.ts"), t(" (mapSupabaseError/showErrorToast) exists but is used in only 1 file (itself). "), t("Real code uses raw "), mono("toast.error(...)"), t(" in ~234 places / 70 files with inconsistent wording.")]));
body.push(BUL([b("Manual fetching dominates: "), t("react-query in ~21 files vs ~100 files doing manual await supabase → larger silent-failure surface, no retry/caching. ErrorBoundary catches render throws only, not rejected query promises.")]));

body.push(H2("3.3 Hardcoded Values"));
body.push(BUL([b("Hardcoded FY_OPTIONS arrays + default FY (go stale every April): "), mono("AuditScrutiny.tsx:23"), t(", "), mono("AuditPreliminary.tsx:58"), t(", "), mono("AuditPipeline.tsx:67"), t(", "), mono("AuditTrackerLayout.tsx:31-33"), t(", "), mono("ClientAuditorsTab.tsx:21"), t(", "), mono("AuditQueryTracker.tsx:72/93/439"), t(", "), mono("Documents.tsx:48"), t(". The TDS module generates options ("), mono("TdsFilingsManager.tsx:75"), t(") — the pattern to copy.")]));
body.push(BUL([b("Hardcoded firm identity: "), t("firm name 'V J Desai & Co.' in logic/comments ("), mono("NewClientWizard.tsx:136"), t("), email accounts@vjdesai.com ("), mono("EmailTemplateEngine.ts:106"), t(", "), mono("UserManagement.tsx:697"), t("), project ref fallback 'hubyywmodekfdzhwiumb' ("), mono("UserManagement.tsx:69"), t("). "), b("For a multi-tenant SaaS, a hardcoded firm name in client-creation logic is a correctness risk"), t(" if you onboard a second firm.")]));
body.push(BUL([b("Supabase URL + anon key hardcoded "), t("in "), mono("client.ts:5-6"), t(" (not import.meta.env). "), b("Not a secret leak"), t(" — it's the publishable anon JWT, designed to be public and gated by RLS — but you can't switch environments without a code edit. File is Lovable-generated ('do not edit').")]));
body.push(BUL([b("Hardcoded GST rate 18%/0.18 "), t("("), mono("NewInvoice.tsx:176/289/531/685"), t(") and "), b("FY-specific TDS rate/threshold tables baked in source "), t("("), mono("TdsRateMaster.tsx:55+"), t(", "), mono("tdsEngine.ts:64/489-499"), t(") — these change with each Finance Act and should be DB/config-driven.")]));
body.push(BUL([t("Fallback site URL "), mono("https://caflow-core-ui.vercel.app"), t(" in "), mono("ForgotPassword.tsx:20"), t(".")]));

// ---------- SECTION 4 ----------
body.push(new Paragraph({ children: [new PageBreak()] }));
body.push(H1("Section 4 — Priority Matrix"));
body.push(P([b("Severity: "), t("CRITICAL = data loss/exposure possible • HIGH = noticeable slowness or broken feature • MEDIUM = visual inconsistency • LOW = minor polish.")]));
body.push(matrixTable());
body.push(P([ital("* #1 is CRITICAL only if RLS does not already scope those tables — needs your confirmation (Q1 below). If RLS is solid, downgrade to LOW.")], { spacing: { before: 120 } }));

// ---------- SECTION 5 ----------
body.push(new Paragraph({ children: [new PageBreak()] }));
body.push(H1("Section 5 — Quick Wins (each <~1 hour)"));
body.push(NUM([b("Standardize page H1 "), t("to one class — text-2xl font-display font-bold text-foreground — across the ~10 drifting pages (§1.5).")]));
body.push(NUM([b("Swap hand-rolled destructive buttons "), t("at Clients.tsx:1089/1106 to variant=\"destructive\"; Login buttons to default variant.")]));
body.push(NUM([b("Replace bg-white → bg-card "), t("at Clients.tsx:635 and TallySyncPage panels for dark-mode safety.")]));
body.push(NUM([b("Add .eq(\"firm_id\", …) "), t("(or confirm RLS) on the users/clients fetches in ItReturns/ClientDetail/Documents — cheap risk reduction.")]));
body.push(NUM([b("Wrap Clients filtered + tab counts in useMemo "), t("(Clients.tsx:465-499/680-694) — instant typing responsiveness.")]));
body.push(NUM([b("Add .limit() + server-side pagination defaults "), t("to the Clients and IT Returns list queries.")]));
body.push(NUM([b("Fold ClientDetail's 3 serial awaits "), t("(ClientDetail.tsx:258-260) into the existing Promise.all and capture error.")]));
body.push(NUM([b("Replace bare 'No data' strings "), t("in NoticeTracker/ItReturns/Billing/Timesheets with one shared <EmptyState>.")]));
body.push(NUM([b("Generate FY options "), t("from the current date (reuse the TDS generateFYOptions pattern) in the ~8 hardcoded files.")]));
body.push(NUM([b("Adopt showErrorToast from errorUtils.ts "), t("in the top ~10 manual fetches that currently swallow errors.")]));

// ---------- SECTION 6 ----------
body.push(new Paragraph({ children: [new PageBreak()] }));
body.push(H1("Section 6 — Questions for Kunal"));
body.push(NUM([b("RLS coverage — "), t("Are clients, users, firms, service_categories, fa_categories, documents protected by row-level-security policies scoped by firm_id? This single answer decides whether finding #1 is CRITICAL or a non-issue. (Most impactful question.)")]));
body.push(NUM([b("Multi-tenant intent — "), t("Is CAFlow genuinely multi-firm, or effectively single-firm (V J Desai & Co.) today? Determines whether the hardcoded firm name (#7) is urgent or cosmetic.")]));
body.push(NUM([b("Mobile priority — "), t("Do CAs actually use the data-heavy pages (Depreciation, Tally sync, Notes-to-Accounts, TDS data entry) on phones, or is mobile only for dashboards/portal? If desktop-only, #15 drops in priority.")]));
body.push(NUM([b("Tax constants source — "), t("Should GST rate and TDS rate/threshold tables move to a DB/config table (editable each Finance Act), or is hardcoding acceptable for now? (Your ledger-scrutiny skill already uses a thresholds.json pattern.)")]));
body.push(NUM([b("client.ts regeneration — "), t("That file is Lovable-generated and marked 'do not edit'. Leave it alone (accepting the hardcoded anon key/URL), or propose an env-var version you maintain manually?")]));
body.push(NUM([b("Pagination strategy — "), t("For the 708-client lists, prefer server-side pagination (best perf, more work) or a generous .limit() cap + client-side paging (quick, keeps current UX)?")]));

body.push(new Paragraph({ spacing: { before: 240 }, children: [
  b("Next step: "), t("This is audit-only — no code changed, app not run. Tell me which findings to tackle and in what order (the Quick Wins are the natural first batch), and I'll implement on a fresh claude/auto-* branch per project rules. Recommend answering Q1 first, since it can promote or eliminate the top CRITICAL item."),
] }));

// ================= ASSEMBLE =================
const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 21 } } }, // ~10.5pt
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 30, bold: true, font: "Arial", color: "1F3864" },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 25, bold: true, font: "Arial", color: "2E5496" },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 22, bold: true, font: "Arial", color: "333333" },
        paragraph: { spacing: { before: 140, after: 80 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: "bullets", levels: [
        { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 460, hanging: 280 } } } },
        { level: 1, format: LevelFormat.BULLET, text: "◦", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 920, hanging: 280 } } } },
      ] },
      { reference: "qwins", levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 460, hanging: 280 } } } },
      ] },
    ],
  },
  sections: [{
    properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } } },
    footers: {
      default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: "CAFlow Audit Report — ", size: 16, color: "888888" }),
          new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "888888" })],
      })] }),
    },
    children: body,
  }],
});

const outPath = path.join("C:", "Users", "kvdes", "OneDrive", "Desktop", "Audit", "caflow-core-ui-main", "CAFlow_Audit_Report.docx");
Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(outPath, buf); console.log("WROTE " + outPath + " (" + buf.length + " bytes)"); });
