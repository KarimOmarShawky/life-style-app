/** Optional scratch-installed WASM parser: syntax only, never Flutter analysis. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

if (!process.argv[2]) {
  throw new Error('Pass the absolute path to a scratch-installed @wasm-fmt/dart_fmt module');
}
const { format } = await import(pathToFileURL(process.argv[2]).href);
const BASE = '47cf1fd09540e7bcc8b291d6d9a1559cf0c5f855';
let tracked;
let scope = 'changed Dart files';
try {
  execFileSync('git', ['cat-file', '-e', `${BASE}^{commit}`], { stdio: 'ignore' });
  tracked = execFileSync('git', ['diff', '--name-only', BASE], { encoding: 'utf8' });
} catch {
  // A shallow Arena clone does not always contain the historical baseline. In
  // that case parse *all* tracked Dart files, which is stricter than the
  // changed-file set, and still include untracked working-tree additions.
  tracked = execFileSync('git', ['ls-files', '*.dart'], { encoding: 'utf8' });
  scope = 'Dart files (all tracked; baseline commit unavailable)';
}
const paths = new Set([
  ...tracked.split('\n'),
  ...execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
    encoding: 'utf8'
  }).split('\n')
]);
let count = 0;
for (const file of [...paths].filter((path) => path.endsWith('.dart'))) {
  format(readFileSync(file, 'utf8'), file, { language_version: '3.5.0' });
  count++;
}
console.log(
  `Parsed ${count} ${scope} using WASM dart_style (language 3.5.0). Syntax only; no Flutter analysis or tests.`
);
