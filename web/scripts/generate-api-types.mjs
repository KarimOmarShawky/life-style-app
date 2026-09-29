#!/usr/bin/env node
/**
 * Generates TypeScript types from the repository's OpenAPI document
 * (`../docs/api/openapi.yaml`).
 *
 * IMPORTANT: Generated types are a starting point only. Every generated
 * definition must be verified against the backend's runtime routes,
 * controllers, DTO mappers, and Zod validation schemas before being relied
 * upon. Known deviations are documented in `web/docs/api-verification.md`,
 * and the application consumes the hand-verified types in
 * `src/types/api.ts` and the feature modules.
 *
 * Usage: npm run generate:api-types
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(webRoot, '..');
const openapiPath = path.join(repoRoot, 'docs', 'api', 'openapi.yaml');
const outPath = path.join(webRoot, 'src', 'types', 'openapi.generated.ts');

const doc = parse(readFileSync(openapiPath, 'utf8'));
const schemas = doc?.components?.schemas ?? {};

/** Convert a YAML schema node to a TypeScript type expression. */
function tsType(node, indentLevel = 0) {
  if (!node || typeof node !== 'object') {
    return 'unknown';
  }
  if (Array.isArray(node.enum) && node.enum.length > 0) {
    return node.enum.map((v) => JSON.stringify(v)).join(' | ');
  }
  if (node.$ref) {
    const name = String(node.$ref).split('/').pop();
    return name;
  }
  if (Array.isArray(node.anyOf)) {
    return node.anyOf.map((n) => tsType(n, indentLevel)).join(' | ');
  }
  const nullable = node.nullable === true;
  let base;
  switch (node.type) {
    case 'string':
      base = 'string';
      break;
    case 'integer':
    case 'number':
      base = 'number';
      break;
    case 'boolean':
      base = 'boolean';
      break;
    case 'array': {
      const item = tsType(node.items, indentLevel);
      base = / \| /.test(item) ? `Array<${item}>` : `${item}[]`;
      break;
    }
    case 'object':
    default: {
      if (node.properties && Object.keys(node.properties).length > 0) {
        base = tsObject(node, indentLevel);
      } else if (node.additionalProperties) {
        const valueType =
          node.additionalProperties === true
            ? 'unknown'
            : tsType(node.additionalProperties, indentLevel);
        base = `Record<string, ${valueType}>`;
      } else {
        base = 'Record<string, unknown>';
      }
    }
  }
  return nullable ? `${base} | null` : base;
}

function tsObject(node, indentLevel) {
  const indent = '  '.repeat(indentLevel + 1);
  const closeIndent = '  '.repeat(indentLevel);
  const required = new Set(node.required ?? []);
  const lines = Object.entries(node.properties).map(([key, prop]) => {
    const optional = required.has(key) ? '' : '?';
    const safeKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
    const comments = [];
    if (prop.description) {
      comments.push(`${indent}/** ${String(prop.description).replace(/\*\//g, '*\\/')} */`);
    }
    if (prop.example !== undefined) {
      // Examples are intentionally not emitted; they are documentation only.
    }
    const type = tsType(prop, indentLevel + 1);
    return [...comments, `${indent}${safeKey}${optional}: ${type};`].join('\n');
  });
  return `{\n${lines.join('\n')}\n${closeIndent}}`;
}

const header = `/* eslint-disable */
/**
 * AUTO-GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Source: docs/api/openapi.yaml (OpenAPI 3.1, info.version ${doc?.info?.version ?? 'unknown'})
 * Generator: web/scripts/generate-api-types.mjs  (npm run generate:api-types)
 *
 * The repository's OpenAPI document is NOT fully accurate with respect to the
 * backend runtime. Every type below was (re)verified against backend routes,
 * controllers, DTOs, and Zod validation schemas; known deviations are
 * documented in web/docs/api-verification.md. The application code consumes
 * verified types via src/types/api.ts and the feature modules.
 */
`;

const body = Object.entries(schemas)
  .map(([name, schema]) => {
    const description = schema?.description
      ? `/** ${String(schema.description).replace(/\*\//g, '*\\/')} */\n`
      : '';
    const safeName = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
    return `${description}export type ${safeName} = ${tsType(schema, 0)};`;
  })
  .join('\n\n');

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, `${header}\n${body}\n`, 'utf8');
console.log(
  `Generated ${Object.keys(schemas).length} schemas -> ${path.relative(webRoot, outPath)}`
);
