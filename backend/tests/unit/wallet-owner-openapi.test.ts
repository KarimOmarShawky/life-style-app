import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { generateOpenApiDocument } from '../../src/docs/openapi-generator.js';

describe('retired money and wallet API contract', () => {
  it.each([
    ['generator', () => generateOpenApiDocument()],
    [
      'checked-in document',
      () =>
        readFileSync(
          fileURLToPath(new URL('../../../docs/api/openapi.yaml', import.meta.url)),
          'utf8'
        )
    ]
  ])('%s retains subscriptions and token revocation, but not retired routes', (_name, document) => {
    const spec = parse(document());
    expect(spec.paths['/money/subscriptions'].get).toBeDefined();
    expect(spec.paths['/money/subscriptions'].post).toBeDefined();
    expect(spec.paths['/money/subscriptions/{id}'].delete).toBeDefined();
    expect(spec.paths['/ingest/token'].delete).toBeDefined();
    expect(spec.paths['/ingest/token'].post).toBeUndefined();
    for (const path of [
      '/money/categories',
      '/money/transactions',
      '/money/wallet/transactions',
      '/money/budgets',
      '/money/reports/summary',
      '/money/subscriptions/{id}/pay',
      '/ingest/transactions',
      '/ingest/wallet/transactions',
      '/ingest/sms/analyze',
      '/ingest/wallet/sms/analyze'
    ]) {
      expect(spec.paths[path]).toBeUndefined();
    }
  });
});
