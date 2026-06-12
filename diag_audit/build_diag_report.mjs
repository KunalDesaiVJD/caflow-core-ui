import fs from "fs";
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
         Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
         ShadingType, PageNumber, PageBreak, LevelFormat } from "docx";
const BG = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" };
const BORDERS = { top: BG, bottom: BG, left: BG, right: BG };
const GREEN="008000", BLUE="1F4E79", GREY="595959", RED="C00000", AMBER="B45309";
const P=(t,o={})=>new Paragraph({alignment:o.align??AlignmentType.LEFT,spacing:o.spacing??{after:100},children:[new TextRun({text:t,bold:o.bold,size:o.size??21,color:o.color,italics:o.italics,font:"Arial"})]});
const H1=t=>new Paragraph({heading:HeadingLevel.HEADING_1,spacing:{before:240,after:180},children:[new TextRun({text:t,bold:true,size:30,color:BLUE,font:"Arial"})]});
const H2=t=>new Paragraph({heading:HeadingLevel.HEADING_2,spacing:{before:170,after:120},children:[new TextRun({text:t,bold:true,size:24,color:BLUE,font:"Arial"})]});
const C=(t,o={})=>new TableCell({borders:BORDERS,width:{size:o.width??1500,type:WidthType.DXA},shading:o.shade?{fill:o.shade,type:ShadingType.CLEAR,color:"auto"}:undefined,margins:{top:40,bottom:40,left:70,right:70},children:[new Paragraph({alignment:o.align??AlignmentType.LEFT,children:[new TextRun({text:String(t??""),bold:o.bold,color:o.color,size:o.size??15,font:"Arial"})]})]});
const R=cells=>new TableRow({children:cells});
const PB=()=>new Paragraph({children:[new PageBreak()]});
const BLT=t=>new Paragraph({numbering:{reference:"b",level:0},children:[new TextRun({text:t,size:20,font:"Arial"})]});

const lines = fs.readFileSync("diag_audit/MASTER_ASSURANCE_TABLE.csv","utf8").split(/\r?\n/).filter(l=>l.trim());
const hdr = lines[0].split(",");
const parse = l => { const out=[]; let cur=""; let q=false;
  for (const ch of l) { if (ch === '"') q=!q; else if (ch===',' && !q) { out.push(cur); cur=""; } else cur+=ch; }
  out.push(cur); return out; };
const rows = lines.slice(1).map(parse).map(p=>Object.fromEntries(hdr.map((h,i)=>[h,p[i]??""])));

const title=[
  new Paragraph({spacing:{before:1400,after:280},alignment:AlignmentType.CENTER,children:[new TextRun({text:"CAFlow — Full-Database FS Reconciliation",bold:true,size:44,color:BLUE,font:"Arial"})]}),
  new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:160},children:[new TextRun({text:"DIAGNOSTIC AUDIT REPORT (READ-ONLY)",bold:true,size:34,color:BLUE,font:"Arial"})]}),
  P("Scope: every engagement in audit_engagements — 122 engagements, all financial years, no sampling",{align:AlignmentType.CENTER,size:22}),
  P("Date: 13 June 2026 - Four-reader verification doctrine - NO FIXES APPLIED",{align:AlignmentType.CENTER,size:22,italics:true}),
  P("Read-only compliance: every SQL was a pure SELECT; no source files edited; no commits; no deploys; no state-changing browser clicks.",{align:AlignmentType.CENTER,size:18,color:GREY}),
  PB(),
];

const verdict=[
  H1("Executive summary — VERDICT"),
  P("NCE TRACK (the audit-intelligence partnership/proprietorship book): TALLIED.",{bold:true,color:GREEN}),
  BLT("All 27 NCE engagements with financial statements: BS CHECK CY and PY ticked on screen, green FS Health banners. 22 fully green; 5 carry only amber manual-adjustment rows (legitimate); AMBER GUM shows 1 phantom drift caused by a case-mismatch in the panel anchor (RC-16) — its notes and BS are correct and balanced."),
  BLT("Database sweep: 0 in-scope drift cells across all NCE notes, both years; 0 plug rows anywhere; 0 renderer-invisible keys; 0 string-typed values; COGS inventory identity holds everywhere."),
  P("CORPORATE TRACK: NOT TALLIED — 8 corporates have unbalanced Balance Sheets and 12 carry stage5_notes diverging from COA. This track was never part of the previous remediation (NCE-only) and the failures are pre-existing. See F-4/F-5.",{bold:true,color:RED}),
  P("Tooling verdict: 3 NEW root-cause classes discovered THIS run (RC-14 corporate sign fallback, RC-15 note-number source divergence, RC-16 case-mismatched PY ledger names). All documented with file:line evidence and proposed — but NOT applied — fixes."),
  PB(),
];

const cw=[2350,560,720,540,540,620,620,620,540,540,1340,1100];
const thead=R(["Client","FY","Track","TB","Map","DupKeys","DriftCY","DriftPY","Plugs","BareK","FS Health banner","Status"].map((h,j)=>C(h,{width:cw[j],bold:true,shade:"DDEBF7",size:14})));
const fsrows=rows.filter(r=>r.track==="NCE-FULL"||r.track==="CORP-FULL");
const trows=fsrows.map(r=>R([
  C(r.client.slice(0,34),{width:cw[0]}),C(r.fy,{width:cw[1]}),C(r.track.replace("-FULL",""),{width:cw[2]}),
  C(r.tb_rows,{width:cw[3],align:AlignmentType.RIGHT}),C(r.mapped,{width:cw[4],align:AlignmentType.RIGHT}),
  C(r.dup_keys+(r.dup_conflicts!=="0"?"!":""),{width:cw[5],align:AlignmentType.CENTER,color:r.dup_keys!=="0"?AMBER:undefined}),
  C(r.drift_cells_cy||"0",{width:cw[6],align:AlignmentType.CENTER,color:(r.drift_cells_cy&&r.drift_cells_cy!=="0")?RED:GREEN}),
  C(r.drift_cells_py||"0",{width:cw[7],align:AlignmentType.CENTER,color:(r.drift_cells_py&&r.drift_cells_py!=="0")?RED:GREEN}),
  C(r.plug_rows,{width:cw[8],align:AlignmentType.CENTER,color:r.plug_rows!=="0"?RED:GREEN}),
  C(r.bare_keys,{width:cw[9],align:AlignmentType.CENTER,color:r.bare_keys!=="0"?RED:GREEN}),
  C((r.banner||"").replace("FS Health: ","").slice(0,42),{width:cw[10],size:13}),
  C(r.status,{width:cw[11],align:AlignmentType.CENTER,bold:true,color:r.status==="VERIFIED"?GREEN:(r.status.indexOf("FINDING")===0?RED:GREY),size:14}),
]));

const tableSection=[
  H1("Section A — Assurance table: every engagement with financial statements (100% browser-verified)"),
  P("Drift cells counted per the app's own semantics (TB-row iteration, exact-then-trim lookup). NCE drift counts shown on corporates refer to vestigial NCE-note rows the corporate FS does NOT read (F-7). Banner text captured live this run; screenshots on file for all 52."),
  new Table({width:{size:10100,type:WidthType.DXA},columnWidths:cw,rows:[thead,...trows]}),
  P(" "),
  H2("Remaining 70 engagements"),
  P("44 PY-SHELL rows (verified indirectly as PY source of the CY twin), 3 NOT-AT-STAGE-7 (TB/COA present, FS not generated), 23 EMPTY. Full 122-row table with every column: diag_audit/MASTER_ASSURANCE_TABLE.csv."),
  PB(),
];

const findings=[
  H1("Section B — Findings register (NO FIXES APPLIED — awaiting approval per finding)"),
  H2("F-1 / RC-14 (NEW, HIGH) — Corporate sign fallback inverts asset codes in the panel anchor"),
  P("computeCOATotals resolves Dr/Cr nature via NOTE_NATURE only (fsSignConvention.ts:156-160); corporate codes are absent and default to CR — asset codes flip sign in the corporate FsHealthPanel anchor, producing phantom drift banners on every corporate with mapped assets (AMBER DYE 14 notes, KWIKTEAM 14, AUSTOMEC 6, LIMBABLE 6, SIX VISION 7, SWADESHI HERBS 8). Proposed: resolveNature() consults FS_CODE_NATURE before defaulting; one-line change + regression test."),
  H2("F-2 / RC-16 (NEW, MEDIUM) — Case-mismatched PY TB ledger names blind the COA anchor"),
  P("AMBER GUM: PY-shell TB ledger Interest on Car Loan vs mapping key INTEREST ON CAR LOAN (Rs 7,25,603.38). The exact-then-trim lookup misses it; the note carries the correct figure, so the panel shows 1 note have drift that is NOT a data error. Same class: MAHIL other_cl PY Rs 42,468 (amber manual-adj). Proposed: case-insensitive final fallback in computeCOATotals, or key normalisation at sync."),
  H2("F-3 / RC-15 (NEW, MEDIUM) — Note-number map and note data have different sources"),
  P("Numbering derives from TB/COA face amounts while note content derives from cy_data/py_data; a note can get a number with no data or hold data with no number. Latent — no live instance found this run. Proposed: numbering also considers getNCENoteFaceTotal."),
  H2("F-4 / CORPORATE BS IMBALANCE (PRE-EXISTING, HIGH) — 8 corporates"),
  BLT("ACCU PANELS: BS CY out Rs 6,18,07,932 (E+L 28.31cr vs Assets 22.13cr)"),
  BLT("CROWNGLOBE: CY out Rs 4,97,312; PY out Rs 5,90,091"),
  BLT("MICROCIRCUITS: CY out Rs 1,55,107; PY out Rs 74,60,699 — assets never mapped"),
  BLT("ORVIX: PY out Rs 1,26,29,174 — PY shell never synced"),
  BLT("PRINCESS GEMS: CY out Rs 7,59,462; PY out Rs 24,449"),
  BLT("SWADESHI LABORATORIES: CY out Rs 23,87,492; PY out Rs 23,35,296 — assets barely mapped"),
  BLT("SWADESHI COSMETICS: CY out Rs 649; PY out Rs 13,049"),
  BLT("GROWQ: CY out Rs 7,328"),
  P("Root-cause mix: incomplete COA mappings, unsynced PY shells, corporate auto-credit heuristic. The corporate track never received the reconciliation programme that fixed the NCE book. Proposed: corporate-track remediation mirroring the NCE one."),
  H2("F-5 / CORPORATE NOTES STALENESS (PRE-EXISTING, MEDIUM) — 78 DB cells across 12 corporates"),
  P("stage5_notes breakup sums diverge from COA-derived totals (correct signs) — e.g. MICROCIRCUITS revenue note off Rs 3.12cr CY / 4.76cr PY. On-screen banner counts further inflated by F-1 phantom. Full per-cell list: diag_audit/p1_corp_cells.csv."),
  H2("F-6 / RC-L DATA HYGIENE — duplicate COA mapping keys"),
  P("MAHIL INFRA: 32 case-duplicate groups, 17 with CONFLICTING codes. ACCU PANELS: 5 groups, 1 conflicting. App behaviour is deterministic (exact-name pick) but conflicting dupes are a misclassification risk on every re-sync. Proposed: mapping clean-up (COA mapping is user-owned; untouched this run)."),
  H2("F-7 / Vestigial NCE notes on corporates (LOW)"),
  P("7 corporates carry nce_financial_notes rows (historic Pattern-G spillover). Corporate FS does NOT read them (isNonCorporate gating verified). Optional cleanup."),
  H2("F-8 / Unmapped ledgers carrying balances (DISCLOSURE)"),
  P("42 engagements hold TB ledgers with balances absent from coa_mapping (largest CY: ACCURATE PMS 618, ELENZA CALLISTA 484, SWENI 273). Completeness gaps in workflow, not reconciliation drift. Full list: diag_audit/p0_hygiene.csv."),
  H2("F-9 / UMIYA inventory opening mismatch (DISCLOSED BY THE APP)"),
  P("App banners: OPENING STOCK CY Rs 61,07,563.7 vs PY-shell closing Rs 54,23,439.41 (diff Rs 6,84,124.29). Client-book inconsistency; FS uses CY opening per the accounting identity."),
  H2("F-10 / Cosmetic (LOW)"),
  P("SUKIRTI: BS face TOTAL row renders the E+L total in parentheses while stat cards agree and balance. Formatting only."),
  PB(),
];

const codecheck=[
  H1("Section C — Code-regression checklist (all guards PRESENT)"),
  BLT("RC-E income codes in NCE_LIAB_CODE_SET — fsReconciliation.ts:510"),
  BLT("RC-F PY-shell-first COA anchor (hasPyTb) — fsReconciliation.ts:393"),
  BLT("RC-G CY+PY profit auto-credit + residual absorbers — PipelineFinancialStatements.tsx:3095-3097, 3338-3340, 3365-3369, 3964-3973, 4069-4078"),
  BLT("RC-H orphan-skip lifted for non-zero notes — PipelineFinancialStatements.tsx:4048"),
  BLT("RC-I bare-key data clean (0 instances book-wide)"),
  BLT("RC-J self-heal anyPyDefined guard — NCEDetailedNotes.tsx:2331-2334"),
  BLT("RC-K per-column bare decision — nceNoteTotals.ts:110-114"),
  BLT("RC-L legacy-code fold — fsReconciliation.ts:341,397,418"),
  BLT("Exports delegate to canonical aggregator — nceFinancialsDocx.ts:1436-1449, fsExcelTemplateNCE.ts:206-223 (audited clean)"),
  BLT("Lock-preview/readOnly paths same aggregation; Stage-6 COA page totals consistent with anchor (audited clean)"),
  PB(),
];

const closing=[
  H1("Section D — Method, evidence, honest disclosures"),
  H2("Method"),
  P("Phase 0 universe (122 engagements, 6 tracks) — Phase 1 DB sweeps (standing + independent second-opinion + corporate; cross-sweep diff adjudicated) — Phase 2 code regression + parallel new-class hunt — Phase 3 browser verification of 100% of the 52 FS engagements (banner + BS totals + screenshot each; deep dives on flagged) — this report."),
  H2("Evidence files (diag_audit/)"),
  P("MASTER_ASSURANCE_TABLE.csv (122 x 21) - p1_secondopinion_cells.csv (394 NCE cells) - p1_corp_cells.csv (166 corporate cells) - p0_hygiene.csv - p0_universe_classified.csv - p3_results.csv (52 browser rows) - 50+ screenshots in session log."),
  H2("Honest disclosures"),
  BLT("Corporate per-note on-screen totals verified via FS Health banner + BS face, not by expanding every stage5 note row — per-note verification is moot pending F-4 remediation."),
  BLT("PY-SHELL engagements verified indirectly as PY sources of their CY twins."),
  BLT("3 NOT-AT-STAGE-7 and 23 EMPTY engagements have nothing to reconcile; present in the master table with hygiene columns."),
  P(" "),
  P("NO FIXES WERE APPLIED. Awaiting user approval per finding.",{bold:true,color:RED,size:24}),
];

const doc=new Document({
  styles:{default:{document:{run:{font:"Arial",size:21}}},paragraphStyles:[
    {id:"Heading1",name:"Heading 1",basedOn:"Normal",next:"Normal",quickFormat:true,run:{size:30,bold:true,font:"Arial",color:BLUE},paragraph:{spacing:{before:240,after:180},outlineLevel:0}},
    {id:"Heading2",name:"Heading 2",basedOn:"Normal",next:"Normal",quickFormat:true,run:{size:24,bold:true,font:"Arial",color:BLUE},paragraph:{spacing:{before:170,after:120},outlineLevel:1}}]},
  numbering:{config:[{reference:"b",levels:[{level:0,format:LevelFormat.BULLET,text:"•",alignment:AlignmentType.LEFT,style:{paragraph:{indent:{left:620,hanging:300}}}}]}]},
  sections:[{properties:{page:{size:{width:12240,height:15840},margin:{top:1000,right:900,bottom:1000,left:900}}},
    footers:{default:new Footer({children:[new Paragraph({alignment:AlignmentType.CENTER,children:[
      new TextRun({text:"CAFlow Full-Database FS Diagnostic Audit — Page ",size:17,color:"808080",font:"Arial"}),
      new TextRun({children:[PageNumber.CURRENT],size:17,color:"808080",font:"Arial"}),
      new TextRun({text:" — 13 June 2026 — READ-ONLY - NO FIXES APPLIED",size:17,color:"808080",font:"Arial"})]})]})},
    children:[...title,...verdict,...tableSection,...findings,...codecheck,...closing]}],
});
const buf=await Packer.toBuffer(doc);
fs.writeFileSync("CAFlow_FS_Diagnostic_Report_2026-06-13.docx",buf);
console.log("WROTE report,",buf.length,"bytes, fs-rows:",fsrows.length);
