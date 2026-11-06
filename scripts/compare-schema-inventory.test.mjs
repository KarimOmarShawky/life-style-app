import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareInventories } from './compare-schema-inventory.mjs';

const column = {
  kind: 'column',
  relation_name: 'subscriptions',
  object_name: 'amount_scale',
  detail: { type: 'smallint', not_null: false, identity: '', generated: '', default_present: false }
};
const relation = {
  kind: 'relation',
  relation_name: 'subscriptions',
  object_name: '',
  detail: { kind: 'r', row_security: false, force_row_security: false }
};
const index = {
  kind: 'index', relation_name: 'subscriptions', object_name: 'subscription_idx',
  detail: { valid: true, ready: true, definition_hash: '0123456789abcdef0123456789abcdef' }
};

test('compares unordered rows and JSON-encoded detail without false differences', () => {
  assert.deepEqual(compareInventories([column, relation], [relation, { ...column, detail: JSON.stringify(column.detail) }]), {
    missing: [], extra: [], changed: []
  });
});

test('reports missing, additional and altered catalog objects', () => {
  const altered = { ...relation, detail: { ...relation.detail, row_security: true } };
  assert.deepEqual(compareInventories([column, relation], [altered, index]), {
    missing: [['column', 'subscriptions', 'amount_scale']],
    extra: [['index', 'subscriptions', 'subscription_idx']],
    changed: [['relation', 'subscriptions', '']]
  });
});

test('rejects empty, duplicate, unexpected or unsafe records', () => {
  for (const rows of [[], [column, column], [{ ...column, extra: 'not schema metadata' }],
    [{ ...column, relation_name: 'bad\nname' }],
    [{ ...column, detail: { ...column.detail, secret: 'do not send' } }],
    [{ ...relation, detail: { ...relation.detail, row_security: 'false' } }],
    [{ ...index, detail: { ...index.detail, definition_hash: 'invalid' } }]]) {
    assert.throws(() => compareInventories([column], rows));
  }
});
