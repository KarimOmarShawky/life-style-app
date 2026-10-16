/** Optional scratch-installed WASM parser: syntax only, never Flutter analysis. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
if (!process.argv[2]) throw new Error('Pass the absolute path to a scratch-installed @wasm-fmt/dart_fmt module');
const { format } = await import(pathToFileURL(process.argv[2]).href);
const paths = new Set([
  ...execFileSync('git', ['diff', '--name-only'], { encoding: 'utf8' }).trim().split('\n'),
  ...execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' }).trim().split('\n')
]);
let count = 0;
for (const file of [...paths].filter((path) => path.endsWith('.dart'))) {
  format(readFileSync(file, 'utf8'), file, { language_version: '3.5.0' });
  count++;
}
console.log(`Parsed ${count} changed Dart files using WASM dart_style (language 3.5.0). Syntax only; no Flutter analysis or tests.`);
