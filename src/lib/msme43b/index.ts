// MSME 43B(h) Analyser — public API.
export * from './types';
export {
  DEFAULT_CONFIG, dueDateFor, treatmentOf,
  type Msme43bConfig, type Treatment, type DayCountBasis, type AllocationMethod,
} from './config';
export { pdfToLines } from './pdfText';
export { parseLedgerPages } from './parseLedger';
export { detectFormat } from './detectFormat';
export { analyzeVendor, buildReport, normVendor, type BuildReportOptions } from './engine';
export { classifyTxn } from './classify';
export { buildWorkpaperWorkbook, downloadWorkpaper, msme43bToForm3cd, type WorkpaperOptions } from './exportExcel';
export { saveRun, listRuns, loadRun, renameRun, deleteRun, type Msme43bRunSummary } from './persistence';
export { computeCarryForward, type CarryForward, type CarryForwardInput } from './carryForward';
export { reconcileLedger } from './reconcile';
export { extractLedgersViaAI } from './aiExtract';
export { crossCheckVendor, type CrossResult } from './crosscheck';
export { verifyVendor, type VerifyOutcome } from './verify';

// ── calibration loop: learn the firm's interpretation from their own working ──
export {
  RULE_SPACE, RULE_BY_KEY, PERMITTED_VENDOR_WINDOWS,
  emptyProfile, configFromProfile, vendorWindowMap, validateProfile,
  assertNoAmountValued, describeRule, disclosedAssumptions,
  type RuleDef, type RuleOption, type RuleValue, type RuleProfile,
  type RuleChange, type VendorWindowDeclaration,
} from './rules';
export { parseExpectedWorking, parseAmount, type ExpectedWorking, type ExpectedVendorRow } from './expected';
export { diffAgainstExpected, type DiffResult, type VendorDiff, type DiffStatus } from './diff';
export {
  calibrate, applyProposals,
  type CalibrationInput, type CalibrationResult, type Proposal,
  type RuleProposal, type VendorWindowProposal, type GoldenCase,
} from './calibrate';
export { reviewDifference, type AiReview, type AiRuleVerdict, type AiUnexplainedCause } from './aiReview';
export {
  loadRuleProfile, saveRuleProfile, listRuleChanges,
  saveGolden, listGoldenSummaries, loadGoldens, deleteGolden,
  type StoreResult, type RuleChangeRow, type GoldenSummary,
} from './calibrationStore';
