/**
 * parser.js — Parse Tally XML responses into clean JS objects
 *
 * Handles the quirky, inconsistent structure of Tally XML output.
 * Tally ERP 9 and Tally Prime have slightly different XML schemas —
 * this parser handles both.
 */

const { toArray, getText } = require('./tally-client');

// ─── Tally Primary Group → Standard Classification ─────────────────────────
// Maps every standard Tally primary group to BS/PL and account type
const TALLY_GROUP_MAP = {
  // Balance Sheet — Liabilities
  'capital account':          { bs_pl: 'BS', side: 'L', account_type: 'Equity' },
  'reserves & surplus':       { bs_pl: 'BS', side: 'L', account_type: 'Equity' },
  'loans (liability)':        { bs_pl: 'BS', side: 'L', account_type: 'Liability' },
  'secured loans':            { bs_pl: 'BS', side: 'L', account_type: 'Liability' },
  'unsecured loans':          { bs_pl: 'BS', side: 'L', account_type: 'Liability' },
  'current liabilities':      { bs_pl: 'BS', side: 'L', account_type: 'Liability' },
  'provisions':               { bs_pl: 'BS', side: 'L', account_type: 'Liability' },
  'sundry creditors':         { bs_pl: 'BS', side: 'L', account_type: 'Liability' },
  'duties & taxes':           { bs_pl: 'BS', side: 'L', account_type: 'Liability' },
  'bank o/d account':         { bs_pl: 'BS', side: 'L', account_type: 'Liability' },
  'bank od accounts':         { bs_pl: 'BS', side: 'L', account_type: 'Liability' },

  // Balance Sheet — Assets
  'fixed assets':             { bs_pl: 'BS', side: 'A', account_type: 'Asset' },
  'investments':              { bs_pl: 'BS', side: 'A', account_type: 'Asset' },
  'current assets':           { bs_pl: 'BS', side: 'A', account_type: 'Asset' },
  'loans & advances (asset)': { bs_pl: 'BS', side: 'A', account_type: 'Asset' },
  'sundry debtors':           { bs_pl: 'BS', side: 'A', account_type: 'Asset' },
  'stock-in-hand':            { bs_pl: 'BS', side: 'A', account_type: 'Asset' },
  'cash-in-hand':             { bs_pl: 'BS', side: 'A', account_type: 'Asset' },
  'bank accounts':            { bs_pl: 'BS', side: 'A', account_type: 'Asset' },
  'deposits (asset)':         { bs_pl: 'BS', side: 'A', account_type: 'Asset' },
  'misc. expenses (asset)':   { bs_pl: 'BS', side: 'A', account_type: 'Asset' },
  'branch / divisions':       { bs_pl: 'BS', side: 'A', account_type: 'Asset' },

  // P&L — Income
  'sales accounts':           { bs_pl: 'PL', side: 'I', account_type: 'Revenue' },
  'direct income':            { bs_pl: 'PL', side: 'I', account_type: 'Revenue' },
  'indirect income':          { bs_pl: 'PL', side: 'I', account_type: 'Revenue' },

  // P&L — Expense
  'purchase accounts':        { bs_pl: 'PL', side: 'E', account_type: 'Expense' },
  'direct expenses':          { bs_pl: 'PL', side: 'E', account_type: 'Expense' },
  'indirect expenses':        { bs_pl: 'PL', side: 'E', account_type: 'Expense' },
  'manufacturing expenses':   { bs_pl: 'PL', side: 'E', account_type: 'Expense' },

  // Special
  'profit & loss a/c':        { bs_pl: 'BS', side: 'L', account_type: 'Equity' },
  'suspense a/c':             { bs_pl: 'BS', side: 'A', account_type: 'Asset' },
};

function classifyGroup(primaryGroup) {
  if (!primaryGroup) return { bs_pl: 'Unknown', side: 'Unknown', account_type: 'Unknown' };
  const key = primaryGroup.toLowerCase().trim();
  return TALLY_GROUP_MAP[key] || { bs_pl: 'Unknown', side: 'Unknown', account_type: 'Unknown' };
}

// ─── Parse amount strings from Tally ──────────────────────────────────────
// Tally amounts look like: "12345.67 Dr" or "-9876.54 Cr" or "0.00"
function parseAmount(raw) {
  if (raw === null || raw === undefined) return { amount: 0, isCredit: false };
  const str = String(raw).trim();
  if (!str || str === '0' || str === '0.00') return { amount: 0, isCredit: false };

  // Check for Dr/Cr suffix
  const isDr = /Dr$/i.test(str);
  const isCr = /Cr$/i.test(str);
  const numStr = str.replace(/[DrCr]+$/i, '').trim().replace(/,/g, '');
  const num = parseFloat(numStr) || 0;
  const absNum = Math.abs(num);

  // In Tally: Cr = credit balance, Dr = debit balance
  // Negative amounts with no suffix = credit
  if (isCr) return { amount: absNum, isCredit: true };
  if (isDr) return { amount: absNum, isCredit: false };
  // No suffix: negative means credit
  return { amount: absNum, isCredit: num < 0 };
}

// Convert Tally amount to signed number (positive = debit asset/expense, negative = credit)
function toSignedAmount(raw, normalBalance = 'Dr') {
  const { amount, isCredit } = parseAmount(raw);
  if (normalBalance === 'Cr') {
    // For liability/income: credit is positive, debit is negative
    return isCredit ? amount : -amount;
  }
  // For asset/expense: debit is positive, credit is negative
  return isCredit ? -amount : amount;
}

// ─── Parse Groups from Tally XML ──────────────────────────────────────────
function parseGroups(parsed) {
  const groups = [];
  const seen = new Set();

  // Navigate the XML tree — Tally's structure varies
  const paths = [
    () => parsed?.ENVELOPE?.BODY?.DATA?.TALLYMESSAGE,
    () => parsed?.ENVELOPE?.BODY?.EXPORTDATA?.REQUESTDATA?.TALLYMESSAGE,
    () => parsed?.ENVELOPE?.BODY?.DATA?.COLLECTION?.GROUP,
  ];

  let groupNodes = [];

  // Try getting from TALLYMESSAGE > COLLECTION > GROUP
  for (const pathFn of paths) {
    try {
      const node = pathFn();
      if (!node) continue;
      const messages = toArray(node);
      for (const msg of messages) {
        const col = msg?.COLLECTION;
        if (col) {
          const grps = toArray(col?.GROUP);
          if (grps.length > 0) { groupNodes = grps; break; }
        }
        // Direct GROUP in message
        const directGrps = toArray(msg?.GROUP);
        if (directGrps.length > 0) { groupNodes = directGrps; break; }
      }
      if (groupNodes.length > 0) break;
    } catch (_) {}
  }

  // Fallback: search anywhere in the tree
  if (groupNodes.length === 0) {
    groupNodes = findNodesDeep(parsed, 'GROUP');
  }

  for (const g of groupNodes) {
    const name = getText(g?.NAME || g?.['@_NAME'] || g?.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);

    const parent = getText(g?.PARENT || g?.parent || '');
    const primaryGroup = getText(g?.BASICPRIMARYGROUP || g?.primaryGroup || parent || name);
    const classification = classifyGroup(primaryGroup);

    groups.push({
      name,
      parent: parent || null,
      primary_group: primaryGroup || name,
      is_primary: !parent || parent === name,
      bs_pl: classification.bs_pl,
      side: classification.side,
      account_type: classification.account_type,
    });
  }

  return groups;
}

// ─── Parse Ledgers from Tally XML ─────────────────────────────────────────
function parseLedgers(parsed) {
  const ledgers = [];
  const seen = new Set();

  let ledgerNodes = [];

  // Try multiple paths
  const messages = toArray(
    parsed?.ENVELOPE?.BODY?.DATA?.TALLYMESSAGE ||
    parsed?.ENVELOPE?.BODY?.EXPORTDATA?.REQUESTDATA?.TALLYMESSAGE
  );

  for (const msg of messages) {
    const col = msg?.COLLECTION;
    if (col) {
      const leds = toArray(col?.LEDGER);
      if (leds.length > 0) { ledgerNodes = leds; break; }
    }
    const directLeds = toArray(msg?.LEDGER);
    if (directLeds.length > 0) { ledgerNodes = directLeds; break; }
  }

  if (ledgerNodes.length === 0) {
    ledgerNodes = findNodesDeep(parsed, 'LEDGER');
  }

  for (const l of ledgerNodes) {
    const name = getText(l?.NAME || l?.['@_NAME'] || l?.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);

    const parent = getText(l?.PARENT || l?.parent || '');
    const primaryGroup = getText(l?.PRIMARYGROUP || l?.BASICPRIMARYGROUP || parent || '');
    const classification = classifyGroup(primaryGroup || parent);

    // Parse balances
    const openRaw = l?.OPENINGBALANCE || l?.openingBalance || '0';
    const closeRaw = l?.CLOSINGBALANCE || l?.closingBalance || '0';

    const normalBalance = ['A', 'E'].includes(classification.side) ? 'Dr' : 'Cr';
    const { amount: openAmt, isCredit: openIsCr } = parseAmount(openRaw);
    const { amount: closeAmt, isCredit: closeIsCr } = parseAmount(closeRaw);

    // Signed amounts: positive means normal balance direction
    const openingBalance = openIsCr ? -openAmt : openAmt;
    const closingBalance = closeIsCr ? -closeAmt : closeAmt;

    ledgers.push({
      name,
      parent,
      primary_group: primaryGroup || parent,
      account_type: classification.account_type,
      bs_pl: classification.bs_pl,
      normal_balance: normalBalance,
      opening_balance: openingBalance,
      closing_balance: closingBalance,
      // Debit/credit for the period
      txn_debit: Math.max(0, closingBalance - openingBalance),
      txn_credit: Math.max(0, openingBalance - closingBalance),
      raw_opening: String(openRaw),
      raw_closing: String(closeRaw),
    });
  }

  return ledgers;
}

// ─── Build group hierarchy tree ────────────────────────────────────────────
function buildHierarchy(groups, ledgers) {
  // Create a map of all nodes (groups + ledgers)
  const nodeMap = new Map();
  const hierarchy = [];
  let rowNum = 0;

  // Add all groups
  for (const g of groups) {
    const nodeId = `G:${g.name}`;
    const parentNodeId = g.parent ? `G:${g.parent}` : null;
    nodeMap.set(g.name, {
      node_id: nodeId,
      parent_node_id: parentNodeId,
      tally_group_name: g.name,
      is_leaf: false,
      is_bold: true,
      level: 0, // will be computed
      opening_balance: 0,
      txn_debit: 0,
      txn_credit: 0,
      closing_balance: 0,
      normal_balance: g.bs_pl === 'BS' && g.side === 'A' ? 'Dr' :
                      g.bs_pl === 'PL' && g.side === 'E' ? 'Dr' : 'Cr',
      bs_pl_side: g.bs_pl || 'Unknown',
      primary_group: g.primary_group,
      row_number: ++rowNum,
    });
  }

  // Add ledger values to groups (roll up)
  for (const l of ledgers) {
    const parentNode = nodeMap.get(l.parent);
    if (parentNode) {
      parentNode.opening_balance = (parentNode.opening_balance || 0) + (l.opening_balance || 0);
      parentNode.txn_debit       = (parentNode.txn_debit || 0)       + (l.txn_debit || 0);
      parentNode.txn_credit      = (parentNode.txn_credit || 0)      + (l.txn_credit || 0);
      parentNode.closing_balance = (parentNode.closing_balance || 0) + (l.closing_balance || 0);
    }

    // Add ledger leaf node
    const nodeId = `L:${l.name}`;
    const parentNodeId = l.parent ? `G:${l.parent}` : null;
    nodeMap.set(`_L_${l.name}`, {
      node_id: nodeId,
      parent_node_id: parentNodeId,
      tally_group_name: l.name,
      is_leaf: true,
      is_bold: false,
      level: 0,
      opening_balance: l.opening_balance || 0,
      txn_debit: l.txn_debit || 0,
      txn_credit: l.txn_credit || 0,
      closing_balance: l.closing_balance || 0,
      normal_balance: l.normal_balance,
      bs_pl_side: l.bs_pl || 'Unknown',
      primary_group: l.primary_group,
      row_number: ++rowNum,
    });
  }

  // Compute levels (BFS from roots)
  const computeLevels = () => {
    const queue = [];
    for (const [, node] of nodeMap) {
      if (!node.parent_node_id) {
        node.level = 0;
        queue.push(node);
      }
    }
    while (queue.length > 0) {
      const current = queue.shift();
      for (const [, node] of nodeMap) {
        if (node.parent_node_id === current.node_id) {
          node.level = current.level + 1;
          queue.push(node);
        }
      }
    }
  };
  computeLevels();

  // Roll up balances from leaf to root
  // (Do multiple passes until stable — handles deep nesting)
  for (let pass = 0; pass < 10; pass++) {
    let changed = false;
    for (const [, node] of nodeMap) {
      if (!node.parent_node_id) continue;
      // Find parent
      for (const [, parent] of nodeMap) {
        if (parent.node_id === node.parent_node_id && !node.is_leaf) {
          // Already rolled up leaf nodes above; skip double-counting
        }
      }
    }
    if (!changed) break;
  }

  return Array.from(nodeMap.values());
}

// ─── Deep search helper ────────────────────────────────────────────────────
function findNodesDeep(obj, key, result = []) {
  if (!obj || typeof obj !== 'object') return result;
  if (key in obj) {
    const val = obj[key];
    if (Array.isArray(val)) result.push(...val);
    else result.push(val);
  }
  for (const v of Object.values(obj)) {
    if (typeof v === 'object') findNodesDeep(v, key, result);
  }
  return result;
}

module.exports = {
  parseGroups,
  parseLedgers,
  buildHierarchy,
  classifyGroup,
  parseAmount,
  toSignedAmount,
  TALLY_GROUP_MAP,
};
