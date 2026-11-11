import test from 'node:test';
import assert from 'node:assert/strict';
import {
  androidValueErrors,
  blankComments,
  checkAndroidStrings,
  checkCatalogs,
  checkFormatterParams,
  compareToBaseline,
  findHardcodedLiterals,
  parseAndroidStrings,
  parseCatalog,
  placeholders,
  readDartString,
  referencedKeys,
  runChecks
} from './check-l10n.mjs';

const catalog = (entries) => new Map(Object.entries(entries));
const allLocales = (entries) =>
  Object.fromEntries(['en', 'ar', 'de', 'es', 'fr', 'tr'].map((l) => [l, catalog(entries)]));

test('parses catalogs with escapes, adjacent literals, double quotes and comments', () => {
  const parsed = parseCatalog(`// header
const Map<String, String> enCatalog = {
  'a': 'It\\'s {n} done',
  'b':
      'first part '
      'second part', // trailing comment
  "c": "Say \\"hi\\" \\u{1F600}",
  /* block */ 'd': 'line\\nbreak',
};`);
  assert.equal(parsed.get('a'), "It's {n} done");
  assert.equal(parsed.get('b'), 'first part second part');
  assert.equal(parsed.get('c'), 'Say "hi" \u{1F600}');
  assert.equal(parsed.get('d'), 'line\nbreak');
  assert.throws(() => parseCatalog(`const x = { 'a': 'x', 'a': 'y' };`), /Duplicate catalog key 'a'/);
});

test('string reader treats ${...} with nested quotes as one interpolation', () => {
  const [value, end] = readDartString(`'\${l10n.tr('x')} done' rest`, 0);
  assert.equal(value, '${} done');
  assert.equal(end, 22);
});

test('detects missing, extra and empty translations and placeholder drift', () => {
  const catalogs = allLocales({ hello: 'Hello {name}', bye: 'Bye' });
  catalogs.ar.delete('bye');
  catalogs.de.set('extra', 'x');
  catalogs.fr.set('bye', '  ');
  catalogs.tr.set('hello', 'Merhaba {isim}');
  const errors = checkCatalogs(catalogs);
  assert.ok(errors.includes("[ar] missing key 'bye'"));
  assert.ok(errors.includes("[de] extra key 'extra' (not in English)"));
  assert.ok(errors.includes("[fr] empty value for 'bye'"));
  assert.ok(errors.some((e) => e.startsWith("[tr] placeholder drift for 'hello'")));
  assert.deepEqual(checkCatalogs(allLocales({ hello: 'Hello {name}' })), []);
});

test('placeholders ignore JSON-like braces and deduplicate', () => {
  assert.deepEqual(placeholders('{n} of {n} for {name} {"json": 1}'), ['n', 'name']);
});

test('formatter getters must pass exactly the English placeholders', () => {
  const en = catalog({ daysBefore: '{n} days before', pair: '{a} and {b}' });
  const ok = `String daysBefore(int n) => _f('daysBefore', <String, Object>{'n': n});`;
  assert.deepEqual(checkFormatterParams(ok, en), []);
  const bad = `String pair(int a) => _f(\n      'pair',\n      <String, Object>{'a': a});`;
  assert.deepEqual(checkFormatterParams(bad, en), ["_f('pair') passes {a} but English uses {a,b}"]);
});

test('collects keys from _s/_f/tr lookups but not from comments or dynamic keys', () => {
  const keys = referencedKeys([
    ['a.dart', `x(_s('one')); l10n.tr("two"); // l10n.tr('commented')\n l10n.tr('dyn_$id');`]
  ]);
  assert.deepEqual([...keys.keys()].sort(), ['one', 'two']);
});

test('blankComments keeps strings that look like comments', () => {
  const src = `final url = 'https://example.com'; // gone\n/* gone */ final b = 1;`;
  const out = blankComments(src);
  assert.match(out, /'https:\/\/example\.com'/);
  assert.doesNotMatch(out, /gone/);
  assert.equal(out.length, src.length);
});

test('finds hard-coded UI literals in Text, named arguments and ar/en ternaries', () => {
  const found = findHardcodedLiterals(`
    Text('Daily routines'),
    IconButton(tooltip: 'Weekly Brain Report', onPressed: f),
    Text(isAr ? 'خطة اليوم' : 'Daily Plan'),
    Text(l10n.title),
    Text('\${done}/\${total}'),
    Text('$count'),
    Navigator.pushNamed(context, '/daily-plan'),
    label: 'profile_screen',
    // Text('Commented out'),
  `);
  assert.deepEqual(
    found.map((f) => f.text),
    ['Daily routines', 'Weekly Brain Report', 'خطة اليوم']
  );
});

test('literal ratchet fails on growth and reports improvements', () => {
  const { errors, improvements } = compareToBaseline({ 'lib/a.dart': 3, 'lib/new.dart': 1 }, { 'lib/a.dart': 2, 'lib/b.dart': 4 });
  assert.deepEqual(errors, [
    { file: 'lib/a.dart', count: 3, allowed: 2 },
    { file: 'lib/new.dart', count: 1, allowed: 0 }
  ]);
  assert.deepEqual(improvements, [{ file: 'lib/b.dart', count: 0, allowed: 4 }]);
});

test('Android strings: parity, format specifiers, apostrophes and translatable=false', () => {
  const base = parseAndroidStrings(
    '<resources><string name="a">Next: %1$s</string><string name="id" translatable="false">x</string><string name="b">Open</string></resources>'
  );
  assert.deepEqual([...base.keys()], ['a', 'b']);
  const byDir = { values: base };
  for (const l of ['ar', 'de', 'es', 'fr', 'tr']) byDir[`values-${l}`] = new Map(base);
  assert.deepEqual(checkAndroidStrings(byDir), []);
  byDir['values-de'] = new Map([['a', 'Weiter: %s']]);
  byDir['values-tr'] = new Map([...base, ['c', 'extra']]);
  byDir['values-fr'] = parseAndroidStrings(
    '<resources><string name="a">Suivant : %1$s</string><string name="b">L\'app</string></resources>'
  );
  const errors = checkAndroidStrings(byDir);
  assert.ok(errors.includes("values-de: missing Android string 'b'"));
  assert.ok(errors.includes("values-de: format specifier drift for 'a'"));
  assert.ok(errors.includes("values-tr: extra Android string 'c' (not in values/)"));
  assert.ok(errors.some((e) => e.startsWith("values-fr: unescaped apostrophe in 'b'")));
  assert.deepEqual(androidValueErrors('values-tr', 'x', "LifeStyle\\'da"), []);
  assert.deepEqual(androidValueErrors('values-fr', 'x', '"L\'app"'), []);
  assert.ok(androidValueErrors('values', 'x', '@string/y')[0].includes('starts with @'));
});

test('the committed mobile tree passes every localisation check', () => {
  const { errors, notes } = runChecks();
  assert.deepEqual(errors, []);
  assert.ok(notes.some((n) => /keys x 6 locales/.test(n)));
});
