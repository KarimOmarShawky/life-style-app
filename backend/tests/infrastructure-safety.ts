/** Fail closed even when a caller bypasses vitest.config.ts from the repo root. */
import { assertTestTargets } from './test-safety.js';
assertTestTargets(process.env);
