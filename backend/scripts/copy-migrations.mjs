/**
 * Copies the .sql migrations into the build output.
 *
 * `tsc` emits JavaScript and nothing else, so a compiled `migrate.js` ships
 * without the files it exists to apply. The failure mode is quiet and bad: the
 * runner finds an empty directory, reports "0 applied, 0 skipped", exits 0, and
 * the application starts against a database with no tables. Nothing in that
 * sequence looks like an error until the first request.
 *
 * Hence the count check below. A build that produces a migration runner with no
 * migrations is a broken build and should say so here, not in production.
 */
import { cpSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const from = path.join(root, 'src', 'infrastructure', 'database', 'postgres', 'migrations');
const to = path.join(root, 'dist', 'infrastructure', 'database', 'postgres', 'migrations');

if (!existsSync(from)) {
  throw new Error(`Migration source directory is missing: ${from}`);
}

const sources = readdirSync(from).filter((name) => name.endsWith('.sql'));
if (sources.length === 0) {
  throw new Error(`No .sql files in ${from}; refusing to produce a build that cannot migrate`);
}

mkdirSync(path.dirname(to), { recursive: true });
cpSync(from, to, { recursive: true });

const copied = readdirSync(to).filter((name) => name.endsWith('.sql'));
if (copied.length !== sources.length) {
  throw new Error(`Copied ${copied.length} of ${sources.length} migrations into ${to}`);
}

console.log(`Copied ${copied.length} migrations into dist/`);
