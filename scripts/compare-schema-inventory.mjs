#!/usr/bin/env node
// Compares JSON exports of schema-inventory-readonly.sql; never connects to a DB.
// Differences are investigation leads, not a migration plan or release approval.
import { readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const allowedKinds = new Set(['relation', 'column', 'constraint', 'index', 'trigger']);
const keysByKind = {
  relation: ['kind', 'row_security', 'force_row_security'],
  column: ['type', 'not_null', 'identity', 'generated', 'default_present'],
  constraint: ['type', 'validated', 'definition_hash'],
  index: ['valid', 'ready', 'definition_hash'],
  trigger: ['enabled', 'security_definer', 'definition_hash', 'function_hash']
};
const booleanFields = new Set([
  'row_security', 'force_row_security', 'not_null', 'default_present',
  'validated', 'valid', 'ready', 'security_definer'
]);

export function readInventory(file) {
  if (statSync(file).size > 8 * 1024 * 1024) throw new Error('Inventory exceeds 8 MiB');
  return JSON.parse(readFileSync(file, 'utf8'));
}

function normalize(input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > 30000) {
    throw new Error('Expected a nonempty bounded JSON array');
  }
  const rows = new Map();
  for (const row of input) {
    if (!row || typeof row !== 'object' || Array.isArray(row) ||
        Object.keys(row).sort().join(',') !== 'detail,kind,object_name,relation_name' ||
        !allowedKinds.has(row.kind) || typeof row.relation_name !== 'string' ||
        typeof row.object_name !== 'string' || row.relation_name.length === 0 ||
        row.relation_name.length > 128 || row.object_name.length > 128 ||
        (row.kind === 'relation' ? row.object_name !== '' : row.object_name.length === 0) ||
        /[\u0000-\u001f\u007f]/.test(row.relation_name + row.object_name)) {
      throw new Error('Invalid inventory row');
    }
    const detail = typeof row.detail === 'string' ? JSON.parse(row.detail) : row.detail;
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
      throw new Error('Invalid inventory detail');
    }
    const expected = keysByKind[row.kind];
    if (Object.keys(detail).sort().join(',') !== [...expected].sort().join(',')) {
      throw new Error('Unexpected inventory fields');
    }
    const canonical = {};
    for (const key of [...expected].sort()) {
      const value = detail[key];
      if (booleanFields.has(key) ? typeof value !== 'boolean' :
          !(typeof value === 'string' && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value))) {
        throw new Error('Invalid inventory field');
      }
      if (key.endsWith('_hash') && (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value))) {
        throw new Error('Invalid catalog fingerprint');
      }
      canonical[key] = value;
    }
    const key = JSON.stringify([row.kind, row.relation_name, row.object_name]);
    if (rows.has(key)) throw new Error('Duplicate inventory object');
    rows.set(key, JSON.stringify(canonical));
  }
  return rows;
}

export function compareInventories(expected, observed) {
  const baseline = normalize(expected);
  const actual = normalize(observed);
  const missing = [], extra = [], changed = [];
  for (const [key, value] of baseline) {
    if (!actual.has(key)) missing.push(JSON.parse(key));
    else if (actual.get(key) !== value) changed.push(JSON.parse(key));
  }
  for (const key of actual.keys()) if (!baseline.has(key)) extra.push(JSON.parse(key));
  const sort = (rows) => rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { missing: sort(missing), extra: sort(extra), changed: sort(changed) };
}

function main() {
  if (process.argv.length !== 4) {
    console.error('Usage: node scripts/compare-schema-inventory.mjs <baseline.json> <observed.json>');
    process.exitCode = 2;
    return;
  }
  try {
    const result = compareInventories(readInventory(process.argv[2]), readInventory(process.argv[3]));
    console.log(JSON.stringify(result, null, 2));
    console.log('Catalog differences are diagnostic only; identical inventories do not approve deployment.');
    if (result.missing.length || result.extra.length || result.changed.length) process.exitCode = 1;
  } catch {
    // Input files may be confidential. Never echo their contents or file paths.
    console.error('Invalid or unreadable catalog inventory. No comparison was performed.');
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
