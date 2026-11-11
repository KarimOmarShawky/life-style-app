#!/usr/bin/env node
/**
 * E9 localisation gate for the Flutter catalogs and Android string resources.
 *
 * Fails (exit 1) on:
 *   - catalog key drift between the six shipped locales (ar/en/de/es/fr/tr),
 *   - empty translations,
 *   - `{placeholder}` drift between a translation and English,
 *   - `_f('key', {...})` getters whose parameters do not match the English
 *     placeholders (an unsubstituted `{n}` would reach the UI),
 *   - catalog keys looked up in code (`_s`, `_f`, `.tr('...')`) but missing,
 *   - Android `<string>` name/format drift between `values/` and each
 *     `values-<locale>/`, empty values, or unescaped apostrophes (aapt2 error),
 *   - more hard-coded user-facing literals than the committed ratchet baseline
 *     (`scripts/l10n-literal-baseline.json`) in any Dart file.
 *
 * `--update-baseline` rewrites the literal baseline from the current tree.
 * Equal key counts do not prove translation quality or RTL layout; those are
 * reviewed separately (see docs/mobile/l10n-and-rtl.md).
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LOCALES = ['en', 'ar', 'de', 'es', 'fr', 'tr'];
export const ANDROID_LOCALES = ['ar', 'de', 'es', 'fr', 'tr'];

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = join(repoRoot, 'mobile-app', 'mobile');
const BASELINE_PATH = join(repoRoot, 'scripts', 'l10n-literal-baseline.json');

// ---------------------------------------------------------------------------
// Dart lexing helpers (enough of the grammar for string literals/comments).
// ---------------------------------------------------------------------------

function decodeEscape(src, i) {
  const c = src[i];
  const simple = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v' };
  if (c in simple) return [simple[c], i + 1];
  if (c === 'u') {
    if (src[i + 1] === '{') {
      const end = src.indexOf('}', i + 2);
      return [String.fromCodePoint(parseInt(src.slice(i + 2, end), 16)), end + 1];
    }
    return [String.fromCharCode(parseInt(src.slice(i + 1, i + 5), 16)), i + 5];
  }
  if (c === 'x') return [String.fromCharCode(parseInt(src.slice(i + 1, i + 3), 16)), i + 3];
  return [c, i + 1];
}

/** Reads one Dart string literal starting at `i`; returns [value, nextIndex] or null. */
export function readDartString(src, start) {
  let i = start;
  let raw = false;
  if (src[i] === 'r' && (src[i + 1] === "'" || src[i + 1] === '"')) {
    raw = true;
    i += 1;
  }
  const quote = src[i];
  if (quote !== "'" && quote !== '"') return null;
  const triple = src.startsWith(quote.repeat(3), i);
  const delimiter = triple ? quote.repeat(3) : quote;
  i += delimiter.length;
  let value = '';
  while (i < src.length) {
    if (src.startsWith(delimiter, i)) return [value, i + delimiter.length];
    const c = src[i];
    if (!raw && c === '$' && src[i + 1] === '{') {
      // `${expr}` may itself contain braces and nested string literals.
      let depth = 1;
      i += 2;
      while (i < src.length && depth > 0) {
        const e = src[i];
        if (e === "'" || e === '"' || (e === 'r' && (src[i + 1] === "'" || src[i + 1] === '"'))) {
          const nested = readDartString(src, i);
          if (nested) {
            i = nested[1];
            continue;
          }
        }
        if (e === '{') depth += 1;
        else if (e === '}') depth -= 1;
        i += 1;
      }
      value += '${}';
      continue;
    }
    if (!raw && c === '\\') {
      const [decoded, next] = decodeEscape(src, i + 1);
      value += decoded;
      i = next;
      continue;
    }
    if (!triple && c === '\n') throw new Error(`Unterminated string at offset ${start}`);
    value += c;
    i += 1;
  }
  throw new Error(`Unterminated string at offset ${start}`);
}

function skipTrivia(src, start) {
  let i = start;
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) i += 1;
    if (src.startsWith('//', i)) {
      const end = src.indexOf('\n', i);
      i = end === -1 ? src.length : end + 1;
    } else if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
    } else {
      return i;
    }
  }
}

/** Reads adjacent string literals ('a' 'b') as one concatenated value. */
function readAdjacentStrings(src, start) {
  let i = skipTrivia(src, start);
  let first = readDartString(src, i);
  if (!first) return null;
  let value = first[0];
  i = first[1];
  for (;;) {
    const j = skipTrivia(src, i);
    const next = readDartString(src, j);
    if (!next) return [value, i];
    value += next[0];
    i = next[1];
  }
}

/** Parses `const Map<String, String> xxCatalog = { 'key': 'value', ... };`. */
export function parseCatalog(src) {
  const open = src.indexOf('{', src.indexOf('='));
  if (open === -1) throw new Error('Catalog map literal not found');
  const entries = new Map();
  let i = open + 1;
  for (;;) {
    i = skipTrivia(src, i);
    if (src[i] === '}') return entries;
    const key = readAdjacentStrings(src, i);
    if (!key) throw new Error(`Expected a key at offset ${i}`);
    i = skipTrivia(src, key[1]);
    if (src[i] !== ':') throw new Error(`Expected ':' after key '${key[0]}'`);
    const value = readAdjacentStrings(src, i + 1);
    if (!value) throw new Error(`Expected a string value for key '${key[0]}'`);
    if (entries.has(key[0])) throw new Error(`Duplicate catalog key '${key[0]}'`);
    entries.set(key[0], value[0]);
    i = skipTrivia(src, value[1]);
    if (src[i] === ',') i += 1;
  }
}

/** Replaces comments with spaces (keeping offsets and newlines) without touching strings. */
export function blankComments(src) {
  const out = src.split('');
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || (c === 'r' && (src[i + 1] === "'" || src[i + 1] === '"') && !/\w/.test(src[i - 1] ?? ''))) {
      try {
        const literal = readDartString(src, i);
        if (literal) {
          i = literal[1];
          continue;
        }
      } catch {
        i += 1;
        continue;
      }
    }
    if (src.startsWith('//', i)) {
      while (i < src.length && src[i] !== '\n') out[i++] = ' ';
      continue;
    }
    if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (; i < stop; i += 1) if (out[i] !== '\n') out[i] = ' ';
      continue;
    }
    i += 1;
  }
  return out.join('');
}

export function placeholders(value) {
  return [...new Set([...value.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]))].sort();
}

const sameSet = (a, b) => a.length === b.length && a.every((v, idx) => v === b[idx]);

// ---------------------------------------------------------------------------
// Catalog checks
// ---------------------------------------------------------------------------

export function checkCatalogs(catalogs) {
  const errors = [];
  const en = catalogs.en;
  for (const locale of LOCALES) {
    const table = catalogs[locale];
    if (!table) {
      errors.push(`catalog_${locale}.dart is missing`);
      continue;
    }
    for (const key of en.keys()) {
      if (!table.has(key)) errors.push(`[${locale}] missing key '${key}'`);
    }
    for (const [key, value] of table) {
      if (!en.has(key)) errors.push(`[${locale}] extra key '${key}' (not in English)`);
      if (value.trim() === '') errors.push(`[${locale}] empty value for '${key}'`);
      if (en.has(key) && !sameSet(placeholders(value), placeholders(en.get(key)))) {
        errors.push(
          `[${locale}] placeholder drift for '${key}': {${placeholders(value).join(',')}} vs English {${placeholders(en.get(key)).join(',')}}`
        );
      }
    }
  }
  return errors;
}

/** Keys looked up through `_s('k')` / `_f('k', ...)` / `.tr('k')`. */
export function referencedKeys(sources) {
  const keys = new Map();
  for (const [file, rawSrc] of sources) {
    const src = blankComments(rawSrc);
    for (const m of src.matchAll(/(?:\b_[sf]|\.tr)\(\s*['"]([A-Za-z0-9_]+)['"]/g)) {
      if (!keys.has(m[1])) keys.set(m[1], file);
    }
  }
  return keys;
}

/** `_f('key', <String, Object>{'a': a})` parameters versus English placeholders. */
export function checkFormatterParams(localizationsSrc, en) {
  const errors = [];
  const src = blankComments(localizationsSrc);
  for (const m of src.matchAll(/\b_f\(\s*'([A-Za-z0-9_]+)'\s*,\s*(?:<String,\s*Object>)?\{([\s\S]*?)\}\s*,?\s*\)/g)) {
    const params = [...new Set([...m[2].matchAll(/'([A-Za-z_][A-Za-z0-9_]*)'\s*:/g)].map((p) => p[1]))].sort();
    const value = en.get(m[1]);
    if (value === undefined) continue; // reported as a missing key elsewhere
    const expected = placeholders(value);
    if (!sameSet(params, expected)) {
      errors.push(`_f('${m[1]}') passes {${params.join(',')}} but English uses {${expected.join(',')}}`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Hard-coded literal ratchet
// ---------------------------------------------------------------------------

const NAMED_ARGS =
  'tooltip|labelText|hintText|helperText|errorText|semanticLabel|semanticsLabel|label|message|title|subtitle|body|placeholder';

function isUserFacing(literal) {
  const withoutInterpolation = literal.replace(/\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*/g, ' ');
  if (!/[A-Za-z\u00C0-\u024F\u0600-\u06FF]/.test(withoutInterpolation)) return false;
  // Identifiers, routes, keys, asset paths and URLs are not UI copy.
  if (/^[a-z0-9_.\-/:#?=&]+$/.test(withoutInterpolation.trim())) return false;
  return true;
}

/** Returns [{line, text}] for hard-coded user-facing literals in one Dart file. */
export function findHardcodedLiterals(rawSrc) {
  const src = blankComments(rawSrc);
  const found = [];
  const lineOf = (index) => src.slice(0, index).split('\n').length;
  const patterns = [
    new RegExp(`\\bText\\(\\s*(?=r?['"])`, 'g'),
    new RegExp(`\\b(?:${NAMED_ARGS})\\s*:\\s*(?=r?['"])`, 'g'),
    /\b(?:isArabic|isAr|isRtl|isRTL)(?:\(\))?\s*\?\s*(?=r?['"])/g,
    /==\s*'ar'\s*\?\s*(?=r?['"])/g
  ];
  const seen = new Set();
  for (const pattern of patterns) {
    for (const m of src.matchAll(pattern)) {
      const at = m.index + m[0].length;
      if (seen.has(at)) continue;
      let literal;
      try {
        literal = readAdjacentStrings(src, at);
      } catch {
        continue;
      }
      if (!literal || !isUserFacing(literal[0])) continue;
      seen.add(at);
      found.push({ line: lineOf(at), text: literal[0].slice(0, 60) });
    }
  }
  return found.sort((a, b) => a.line - b.line);
}

function listDartFiles(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files.push(...listDartFiles(full));
    else if (name.endsWith('.dart')) files.push(full);
  }
  return files;
}

export function literalCounts(libDir) {
  const counts = {};
  const details = {};
  for (const file of listDartFiles(libDir)) {
    const rel = relative(appRoot, file).split(sep).join('/');
    if (rel.startsWith('lib/l10n/')) continue;
    const literals = findHardcodedLiterals(readFileSync(file, 'utf8'));
    if (literals.length) {
      counts[rel] = literals.length;
      details[rel] = literals;
    }
  }
  return { counts, details };
}

export function compareToBaseline(counts, baseline) {
  const errors = [];
  const improvements = [];
  for (const [file, count] of Object.entries(counts)) {
    const allowed = baseline[file] ?? 0;
    if (count > allowed) errors.push({ file, count, allowed });
  }
  for (const [file, allowed] of Object.entries(baseline)) {
    const count = counts[file] ?? 0;
    if (count < allowed) improvements.push({ file, count, allowed });
  }
  return { errors, improvements };
}

// ---------------------------------------------------------------------------
// Android string resources
// ---------------------------------------------------------------------------

function decodeXmlText(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "\\'")
    .replace(/&amp;/g, '&');
}

export function parseAndroidStrings(xml) {
  const strings = new Map();
  for (const m of xml.matchAll(/<string\b([^>]*)>([\s\S]*?)<\/string>/g)) {
    const name = /\bname="([^"]+)"/.exec(m[1])?.[1];
    if (!name || /\btranslatable="false"/.test(m[1])) continue;
    strings.set(name, decodeXmlText(m[2]));
  }
  for (const m of xml.matchAll(/<string\b([^>]*)\/>/g)) {
    const name = /\bname="([^"]+)"/.exec(m[1])?.[1];
    if (name) strings.set(name, '');
  }
  return strings;
}

const formatSpecifiers = (value) => [...value.matchAll(/%(?:\d+\$)?[sd]/g)].map((m) => m[0]).sort();

export function androidValueErrors(where, name, value) {
  const errors = [];
  if (value.trim() === '') errors.push(`${where}: empty value for '${name}'`);
  const quoted = /^\s*".*"\s*$/s.test(value);
  if (!quoted && /(^|[^\\])'/.test(value)) {
    errors.push(`${where}: unescaped apostrophe in '${name}' (aapt2 rejects it; use \\')`);
  }
  if (/^[@?]/.test(value)) errors.push(`${where}: '${name}' starts with @ or ? (escape it)`);
  return errors;
}

export function checkAndroidStrings(byDir) {
  const errors = [];
  const base = byDir.values;
  for (const [name, value] of base) errors.push(...androidValueErrors('values', name, value));
  for (const locale of ANDROID_LOCALES) {
    const dir = `values-${locale}`;
    const table = byDir[dir] ?? new Map();
    for (const [name, value] of base) {
      if (!table.has(name)) {
        errors.push(`${dir}: missing Android string '${name}'`);
        continue;
      }
      if (!sameSet(formatSpecifiers(table.get(name)), formatSpecifiers(value))) {
        errors.push(`${dir}: format specifier drift for '${name}'`);
      }
    }
    for (const [name, value] of table) {
      if (!base.has(name)) errors.push(`${dir}: extra Android string '${name}' (not in values/)`);
      errors.push(...androidValueErrors(dir, name, value));
    }
  }
  return errors;
}

function loadAndroidStrings(resDir) {
  const byDir = {};
  for (const dir of ['values', ...ANDROID_LOCALES.map((l) => `values-${l}`)]) {
    const full = join(resDir, dir);
    const table = new Map();
    if (existsSync(full)) {
      for (const file of readdirSync(full).filter((f) => f.endsWith('.xml')).sort()) {
        for (const [name, value] of parseAndroidStrings(readFileSync(join(full, file), 'utf8'))) {
          if (table.has(name)) throw new Error(`${dir}/${file}: duplicate Android string '${name}'`);
          table.set(name, value);
        }
      }
    }
    byDir[dir] = table;
  }
  return byDir;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function runChecks({ root = appRoot, baselinePath = BASELINE_PATH, updateBaseline = false } = {}) {
  const l10nDir = join(root, 'lib', 'l10n');
  const catalogs = {};
  for (const locale of LOCALES) {
    const file = join(l10nDir, `catalog_${locale}.dart`);
    if (existsSync(file)) catalogs[locale] = parseCatalog(readFileSync(file, 'utf8'));
  }
  const errors = [];
  const notes = [];
  if (!catalogs.en) return { errors: ['catalog_en.dart is missing'], notes };
  errors.push(...checkCatalogs(catalogs));

  const localizationsSrc = readFileSync(join(l10nDir, 'app_localizations.dart'), 'utf8');
  errors.push(...checkFormatterParams(localizationsSrc, catalogs.en));

  const sources = listDartFiles(join(root, 'lib')).map((f) => [relative(root, f), readFileSync(f, 'utf8')]);
  const referenced = referencedKeys(sources);
  for (const [key, file] of referenced) {
    if (!catalogs.en.has(key)) errors.push(`'${key}' is looked up in ${file} but missing from catalog_en.dart`);
  }
  const unreferenced = [...catalogs.en.keys()].filter((key) => !referenced.has(key)).length;
  notes.push(`${catalogs.en.size} keys x ${LOCALES.length} locales; ${unreferenced} keys have no literal lookup (dynamic or unused)`);

  const resDir = join(root, 'android', 'app', 'src', 'main', 'res');
  if (existsSync(resDir)) {
    const android = loadAndroidStrings(resDir);
    errors.push(...checkAndroidStrings(android));
    notes.push(`${android.values.size} translatable Android strings x ${ANDROID_LOCALES.length + 1} locales`);
  }

  const { counts, details } = literalCounts(join(root, 'lib'));
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  if (updateBaseline) {
    const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(
      baselinePath,
      `${JSON.stringify(
        {
          description:
            'Ratchet for hard-coded user-facing Dart literals (scripts/check-l10n.mjs). Counts may only go down; move copy into the catalogs instead of raising a number.',
          total,
          files: sorted
        },
        null,
        2
      )}\n`
    );
    notes.push(`literal baseline rewritten: ${total} literals in ${Object.keys(counts).length} files`);
  } else {
    const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')).files : {};
    const { errors: grown, improvements } = compareToBaseline(counts, baseline);
    for (const { file, count, allowed } of grown) {
      const sample = details[file].map((d) => `L${d.line} "${d.text}"`).join('; ');
      errors.push(`${file}: ${count} hard-coded UI literals (baseline ${allowed}); use the catalogs. Found: ${sample}`);
    }
    for (const { file, count, allowed } of improvements) {
      notes.push(`${file}: ${count} literals, below baseline ${allowed}; lower it with --update-baseline`);
    }
    notes.push(`hard-coded UI literals: ${total} (ratchet total ${Object.values(baseline).reduce((s, n) => s + n, 0)})`);
  }
  return { errors, notes };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { errors, notes } = runChecks({ updateBaseline: process.argv.includes('--update-baseline') });
  for (const note of notes) console.log(`note: ${note}`);
  if (errors.length) {
    for (const error of errors) console.error(`l10n: ${error}`);
    console.error(`FAIL: ${errors.length} localisation problem(s).`);
    process.exit(1);
  }
  console.log('PASS: localisation catalogs, Android strings and literal ratchet are consistent.');
}
