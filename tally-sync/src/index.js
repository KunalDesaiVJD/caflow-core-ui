#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║          CAFlow Tally Sync — Robust Tally → Supabase Bridge            ║
 * ║  Usage:                                                                 ║
 * ║    node src/index.js sync          — one-time full sync                ║
 * ║    node src/index.js watch         — auto-sync every N minutes         ║
 * ║    node src/index.js test          — test Tally + Supabase connection  ║
 * ║    node src/index.js companies     — list open Tally companies         ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const cron = require('node-cron');
const chalk = require('chalk');
const { TallyClient } = require('./tally-client');
const { buildGroupsQuery, buildLedgersQuery } = require('./queries');
const { parseGroups, parseLedgers, buildHierarchy } = require('./parser');
const { SupabasePush } = require('./supabase-push');

// ─── Config from .env ──────────────────────────────────────────────────────
const config = {
  tallyHost:       process.env.TALLY_HOST          || 'localhost',
  tallyPort:       parseInt(process.env.TALLY_PORT || '9000'),
  supabaseUrl:     process.env.SUPABASE_URL,
  supabaseKey:     process.env.SUPABASE_SERVICE_KEY,
  firmId:          process.env.FIRM_ID,
  clientId:        process.env.CLIENT_ID,
  engagementId:    process.env.ENGAGEMENT_ID,
  fromDate:        process.env.FROM_DATE            || '20240401',
  toDate:          process.env.TO_DATE              || '20250331',
  financialYear:   process.env.FINANCIAL_YEAR       || '2024-25',
  company:         process.env.TALLY_COMPANY        || '',
  intervalMinutes: parseInt(process.env.SYNC_INTERVAL_MINUTES || '30'),
};

// ─── Validate config ───────────────────────────────────────────────────────
function validateConfig() {
  const required = ['supabaseUrl', 'supabaseKey', 'firmId', 'clientId', 'engagementId'];
  const missing = required.filter(k => !config[k]);
  if (missing.length > 0) {
    console.error(chalk.red(`\n✘ Missing required .env values: ${missing.join(', ')}`));
    console.error(chalk.yellow('  Copy .env.example → .env and fill in all values\n'));
    process.exit(1);
  }
}

// ─── MAIN SYNC FUNCTION ────────────────────────────────────────────────────
async function runSync() {
  const startTime = Date.now();
  console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.bold.cyan('  CAFlow Tally Sync'));
  console.log(chalk.cyan(`  ${new Date().toLocaleString('en-IN')}`));
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  const tally = new TallyClient(config.tallyHost, config.tallyPort);
  const pusher = new SupabasePush(config.supabaseUrl, config.supabaseKey);
  const errors = [];

  // ── Step 1: Test connections ──────────────────────────────────────────
  console.log(chalk.bold('Step 1: Checking connections...'));
  try {
    await tally.testConnection();
    console.log(chalk.green('  ✓ Tally connection OK'));
  } catch (err) {
    console.error(chalk.red(`  ✘ Tally: ${err.message}`));
    process.exitCode = 1;
    return;
  }
  try {
    await pusher.testConnection();
    console.log(chalk.green('  ✓ Supabase connection OK'));
  } catch (err) {
    console.error(chalk.red(`  ✘ Supabase: ${err.message}`));
    process.exitCode = 1;
    return;
  }

  // ── Step 2: Create batch record ───────────────────────────────────────
  console.log(chalk.bold('\nStep 2: Creating sync batch...'));
  try {
    await pusher.createBatch({
      engagementId:  config.engagementId,
      firmId:        config.firmId,
      fromDate:      config.fromDate,
      toDate:        config.toDate,
      financialYear: config.financialYear,
      companyName:   config.company || 'tally',
      totalLedgers:  0,
    });
  } catch (err) {
    console.error(chalk.red(`  ✘ ${err.message}`));
    process.exitCode = 1;
    return;
  }

  // ── Step 3: Fetch Groups from Tally ───────────────────────────────────
  console.log(chalk.bold('\nStep 3: Fetching Groups from Tally...'));
  let groups = [];
  try {
    const xml = buildGroupsQuery(config.company);
    const { parsed } = await tally.fetchCollection(xml);
    groups = parseGroups(parsed);
    console.log(chalk.green(`  ✓ Fetched ${groups.length} groups`));
    if (groups.length === 0) {
      console.warn(chalk.yellow('  ⚠ No groups found — check that a company is active in Tally'));
      errors.push({ step: 'groups', message: 'No groups returned from Tally' });
    }
  } catch (err) {
    console.error(chalk.red(`  ✘ Groups fetch failed: ${err.message}`));
    errors.push({ step: 'groups', message: err.message });
  }

  // ── Step 4: Fetch Ledgers from Tally ──────────────────────────────────
  console.log(chalk.bold('\nStep 4: Fetching Ledgers from Tally...'));
  let ledgers = [];
  try {
    const xml = buildLedgersQuery(config.fromDate, config.toDate, config.company);
    const { parsed } = await tally.fetchCollection(xml);
    ledgers = parseLedgers(parsed);
    console.log(chalk.green(`  ✓ Fetched ${ledgers.length} ledgers`));
    if (ledgers.length === 0) {
      console.warn(chalk.yellow('  ⚠ No ledgers found — check date range and active company'));
      errors.push({ step: 'ledgers', message: 'No ledgers returned from Tally' });
    }
  } catch (err) {
    console.error(chalk.red(`  ✘ Ledgers fetch failed: ${err.message}`));
    errors.push({ step: 'ledgers', message: err.message });
    await pusher.failBatch(err.message);
    process.exitCode = 1;
    return;
  }

  // ── Step 5: Build hierarchy tree ──────────────────────────────────────
  console.log(chalk.bold('\nStep 5: Building group hierarchy...'));
  let hierarchyNodes = [];
  try {
    hierarchyNodes = buildHierarchy(groups, ledgers);
    console.log(chalk.green(`  ✓ Built ${hierarchyNodes.length} hierarchy nodes`));
  } catch (err) {
    console.warn(chalk.yellow(`  ⚠ Hierarchy build warning: ${err.message}`));
    errors.push({ step: 'hierarchy', message: err.message });
  }

  // ── Step 6: Push Trial Balance to Supabase ────────────────────────────
  console.log(chalk.bold('\nStep 6: Pushing Trial Balance to Supabase...'));
  try {
    await pusher.pushTrialBalance({
      engagementId:  config.engagementId,
      clientId:      config.clientId,
      financialYear: config.financialYear,
      ledgers,
      groups,
    });
  } catch (err) {
    console.error(chalk.red(`  ✘ TB push failed: ${err.message}`));
    errors.push({ step: 'tb_push', message: err.message });
    await pusher.failBatch(err.message);
    process.exitCode = 1;
    return;
  }

  // ── Step 7: Push Hierarchy to Supabase ───────────────────────────────
  console.log(chalk.bold('\nStep 7: Pushing Hierarchy to Supabase...'));
  try {
    await pusher.pushHierarchy({ engagementId: config.engagementId, hierarchyNodes });
  } catch (err) {
    console.warn(chalk.yellow(`  ⚠ Hierarchy push warning: ${err.message}`));
    errors.push({ step: 'hierarchy_push', message: err.message });
  }

  // ── Step 8: Mark batch complete ───────────────────────────────────────
  await pusher.completeBatch(ledgers.length, errors);

  // ── Summary ───────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  if (errors.length === 0) {
    console.log(chalk.bold.green(`  ✅ Sync complete in ${elapsed}s`));
    console.log(chalk.green(`     Groups: ${groups.length} | Ledgers: ${ledgers.length} | Nodes: ${hierarchyNodes.length}`));
  } else {
    console.log(chalk.bold.yellow(`  ⚠ Sync completed with ${errors.length} warning(s) in ${elapsed}s`));
    errors.forEach(e => console.log(chalk.yellow(`     • [${e.step}] ${e.message}`)));
  }
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
}

// ─── TEST CONNECTION COMMAND ───────────────────────────────────────────────
async function runTest() {
  console.log(chalk.bold('\n🔍 Testing connections...\n'));
  const tally = new TallyClient(config.tallyHost, config.tallyPort);

  // Test Tally
  try {
    await tally.testConnection();
    console.log(chalk.green(`✓ Tally reachable at ${config.tallyHost}:${config.tallyPort}`));
  } catch (err) {
    console.error(chalk.red(`✘ Tally: ${err.message}`));
  }

  // Test Supabase
  try {
    const pusher = new SupabasePush(config.supabaseUrl, config.supabaseKey);
    await pusher.testConnection();
    console.log(chalk.green(`✓ Supabase reachable at ${config.supabaseUrl}`));
  } catch (err) {
    console.error(chalk.red(`✘ Supabase: ${err.message}`));
  }
  console.log('');
}

// ─── LIST COMPANIES COMMAND ────────────────────────────────────────────────
async function runCompanies() {
  console.log(chalk.bold('\n📋 Companies open in Tally:\n'));
  const tally = new TallyClient(config.tallyHost, config.tallyPort);
  try {
    const companies = await tally.getCompanies();
    if (companies.length === 0) {
      console.log(chalk.yellow('  No companies found. Make sure a company is open in Tally.'));
    } else {
      companies.forEach((c, i) => {
        console.log(chalk.green(`  ${i + 1}. ${c.name}`));
        if (c.gst) console.log(chalk.gray(`     GST: ${c.gst}`));
        if (c.pan) console.log(chalk.gray(`     PAN: ${c.pan}`));
      });
      console.log(chalk.yellow(`\n  → Set TALLY_COMPANY=<name> in .env to sync a specific company`));
    }
  } catch (err) {
    console.error(chalk.red(`✘ ${err.message}`));
  }
  console.log('');
}

// ─── WATCH MODE (auto-sync) ────────────────────────────────────────────────
function runWatch() {
  const interval = config.intervalMinutes;
  console.log(chalk.bold.cyan(`\n🔄 Auto-sync mode — every ${interval} minutes`));
  console.log(chalk.gray('  Press Ctrl+C to stop\n'));

  // Run immediately, then on schedule
  runSync();
  const expression = `*/${interval} * * * *`;
  cron.schedule(expression, () => {
    console.log(chalk.gray(`\n⏰ Scheduled sync at ${new Date().toLocaleString('en-IN')}`));
    runSync();
  });
}

// ─── ENTRY POINT ──────────────────────────────────────────────────────────
const command = process.argv[2] || 'sync';

if (['sync', 'watch', 'test', 'companies'].includes(command)) {
  if (command !== 'test' && command !== 'companies') validateConfig();
}

switch (command) {
  case 'sync':      runSync().catch(err => { console.error(chalk.red(err.message)); process.exit(1); }); break;
  case 'watch':     runWatch(); break;
  case 'test':      runTest().catch(err => { console.error(chalk.red(err.message)); process.exit(1); }); break;
  case 'companies': runCompanies().catch(err => { console.error(chalk.red(err.message)); process.exit(1); }); break;
  default:
    console.log(`
Usage:
  node src/index.js sync          One-time full sync
  node src/index.js watch         Auto-sync (every SYNC_INTERVAL_MINUTES)
  node src/index.js test          Test Tally + Supabase connectivity
  node src/index.js companies     List companies open in Tally
`);
}
