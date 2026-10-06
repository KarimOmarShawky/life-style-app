#!/usr/bin/env node
/**
 * One-off migration helper: extracts the legacy hand-written ternary strings
 * from mobile-app/mobile/lib/l10n/app_localizations.dart into per-locale
 * catalog maps (catalog_en.dart / catalog_ar.dart) plus a getters snippet.
 *
 * Usage: node scripts/extract-l10n.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const src = readFileSync(
  join(root, 'mobile-app/mobile/lib/l10n/app_localizations.dart'),
  'utf8'
);

const re =
  /String get (\w+) => isArabic\s*\?\s*'((?:[^'\\]|\\.)*)'\s*:\s*'((?:[^'\\]|\\.)*)'\s*;/gs;

const entries = [];
let m;
while ((m = re.exec(src)) !== null) {
  entries.push({ key: m[1], ar: m[2], en: m[3] });
}

if (entries.length === 0) {
  console.error('No entries extracted!');
  process.exit(1);
}

const dartEscape = (s) => s; // values already carry dart escapes (\n, \', ...)

const renderMap = (lang, pick) => {
  const lines = entries.map(
    (e) => `  '${e.key}': '${dartEscape(e[pick])}',`
  );
  return `// GENERATED CATALOG — locale: ${lang}\n` +
    `// App string catalog for the LifeStyle mobile client.\n` +
    `const Map<String, String> ${lang}Catalog = {\n` +
    lines.join('\n') +
    `\n};\n`;
};

writeFileSync(
  join(root, 'mobile-app/mobile/lib/l10n/catalog_en.dart'),
  renderMap('en', 'en')
);
writeFileSync(
  join(root, 'mobile-app/mobile/lib/l10n/catalog_ar.dart'),
  renderMap('ar', 'ar')
);

const getters = entries
  .map((e) => `  String get ${e.key} => _s('${e.key}');`)
  .join('\n');
writeFileSync(join(root, 'scripts/l10n-getters.snippet.txt'), getters + '\n');

console.log(`Extracted ${entries.length} keys.`);
console.log('Keys:', entries.map((e) => e.key).join(', '));
