import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { generateOpenApiDocument } from '../../src/docs/openapi-generator.js';
import { listTasksQuerySchema } from '../../src/features/tasks/tasks.validation.js';

describe('task list OpenAPI query contract', () => {
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
  ])('%s independently covers every accepted query field', (_name, document) => {
    const spec = parse(document());
    const parameters = spec.paths['/tasks'].get.parameters as Array<{
      name: string;
      in: string;
      schema: { type: string; format?: string };
    }>;
    expect(
      parameters
        .filter((p) => p.in === 'query')
        .map((p) => p.name)
        .sort()
    ).toEqual(Object.keys(listTasksQuerySchema.shape).sort());
    for (const name of ['completedFrom', 'completedTo']) {
      expect(parameters.find((p) => p.name === name)?.schema).toMatchObject({
        type: 'string',
        format: 'date'
      });
    }
  });
});
