/**
 * src/docs/openapi-generator.ts
 *
 * Implements Section 14.18, Section 16 & ADR-007: OpenAPI Generation Skeleton.
 * Generates docs/api/openapi.yaml from baseline API contracts and Zod schemas.
 * CI verifies that the committed openapi.yaml matches this generator output.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const openapiFilePath = path.resolve(__dirname, '../../../docs/api/openapi.yaml');

export function generateOpenApiDocument(): string {
  const doc = `openapi: 3.1.0
info:
  title: LifeStyle App API
  version: 1.0.1
  description: Single source of truth API specification for LifeStyle App (Personal Life Operating System).
servers:
  - url: /api/v1
    description: Current API version prefix
paths:
  /health/live:
    get:
      summary: Process Liveness Probe
      description: Returns 200 if the process event loop is active.
      responses:
        '200':
          description: Process is running
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: string
                    example: ok
                required:
                  - status
  /health/ready:
    get:
      summary: Process Readiness Probe
      description: Checks PostgreSQL and Redis connectivity with 1s timeouts.
      responses:
        '200':
          description: Dependencies are healthy and process can accept traffic
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: string
                    example: ok
                required:
                  - status
        '503':
          description: Service degraded or shutting down
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: string
                    example: degraded
                required:
                  - status
components:
  schemas:
    FieldError:
      type: object
      properties:
        field:
          type: string
          description: Dot-separated field path
        code:
          type: string
          description: Machine-readable error code
        message:
          type: string
          description: Safe human-readable description
      required:
        - field
        - message
    ApiErrorEnvelope:
      type: object
      properties:
        success:
          type: boolean
          example: false
        error:
          type: object
          properties:
            code:
              type: string
              example: VALIDATION_ERROR
            message:
              type: string
              example: Invalid request
            requestId:
              type: string
              format: uuid
              example: b3f1c2a0-4592-498c-8f2c-e105e46bfb77
            details:
              type: array
              items:
                $ref: '#/components/schemas/FieldError'
          required:
            - code
            - message
            - requestId
      required:
        - success
        - error
    PageMeta:
      type: object
      properties:
        limit:
          type: integer
          example: 25
        hasMore:
          type: boolean
          example: false
        nextCursor:
          type: string
          nullable: true
          example: null
      required:
        - limit
        - hasMore
        - nextCursor
`;

  return doc;
}

export function writeOpenApiDocument(): void {
  const content = generateOpenApiDocument();
  fs.mkdirSync(path.dirname(openapiFilePath), { recursive: true });
  fs.writeFileSync(openapiFilePath, content, 'utf8');
}

// If executed directly, write the document
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeOpenApiDocument();
  // eslint-disable-next-line no-console
  console.log(`✅ OpenAPI document generated at: ${openapiFilePath}`);
}
