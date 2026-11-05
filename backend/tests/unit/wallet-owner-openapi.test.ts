import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { generateOpenApiDocument } from '../../src/docs/openapi-generator.js';

describe('wallet owner precondition API contract', () => {
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
  ])('%s documents the optional fence and mismatch response', (_name, document) => {
    const spec = parse(document());
    const issued =
      spec.paths['/ingest/token'].post.responses['201'].content['application/json'].schema
        .properties.data;
    expect(issued.properties.ownerId).toMatchObject({ type: 'string', format: 'uuid' });
    expect(issued.required).toContain('ownerId');
    const parameter = spec.components.parameters.WalletOwner;
    expect(parameter).toMatchObject({
      name: 'X-Wallet-Owner',
      in: 'header',
      required: false,
      schema: { type: 'string', format: 'uuid' }
    });
    expect(parameter.description).toContain('does not establish ownership');
    const required = spec.components.parameters.RequiredWalletOwner;
    expect(required).toMatchObject({
      name: 'X-Wallet-Owner',
      in: 'header',
      required: true,
      schema: { type: 'string', format: 'uuid' }
    });
    expect(required.description).toContain('does not establish ownership');
    for (const path of [
      '/ingest/wallet/transactions',
      '/ingest/wallet/sms/analyze',
      '/money/wallet/transactions'
    ]) {
      const operation = spec.paths[path].post;
      expect(operation.parameters).toContainEqual({
        $ref: '#/components/parameters/RequiredWalletOwner'
      });
      expect(operation.responses['428']).toEqual({
        $ref: '#/components/responses/WalletOwnerMismatch'
      });
    }
    const mismatch = spec.components.responses.WalletOwnerMismatch;
    expect(mismatch.description).toContain('WALLET_OWNER_MISMATCH');
    expect(mismatch.headers['Cache-Control'].example).toBe('no-store');
    for (const path of ['/ingest/transactions', '/ingest/sms/analyze', '/money/transactions']) {
      const operation = spec.paths[path].post;
      expect(operation.parameters).toContainEqual({ $ref: '#/components/parameters/WalletOwner' });
      expect(operation.responses['428']).toEqual({
        $ref: '#/components/responses/WalletOwnerMismatch'
      });
    }
  });
});
