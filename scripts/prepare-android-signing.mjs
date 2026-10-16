/** Private CI preparation only. Does not generate a key, sign or publish an APK. */
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, appendFileSync, rmSync, openSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// java.util.Properties.load(InputStream) is Latin-1; preserve Unicode via escapes.
export function propertyValue(value) {
  return value.split('').map((char) => {
    const code = char.charCodeAt(0);
    if (code < 32 || code > 126) return '\\u' + code.toString(16).padStart(4, '0');
    return '\\ :#!='.includes(char) ? '\\' + char : char;
  }).join('');
}

export function prepareSigning({ androidDir, tempRoot, env }) {
  const names = ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD'];
  if (names.some((name) => typeof env[name] !== 'string' || !env[name].trim())) {
    throw new Error('Release signing secrets are incomplete');
  }
  const encoded = env.ANDROID_KEYSTORE_BASE64;
  if (encoded.length > 14_000_000) throw new Error('Release keystore exceeds preparation limit');
  const compact = encoded.replace(/\s/g, '');
  if (!compact || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact)) {
    throw new Error('Release keystore is not valid base64');
  }
  const bytes = Buffer.from(compact, 'base64');
  if (!bytes.length || bytes.toString('base64') !== compact) throw new Error('Release keystore encoding is invalid');
  const properties = join(androidDir, 'key.properties');
  if (existsSync(properties)) throw new Error('Refusing to overwrite existing signing configuration');
  mkdirSync(tempRoot, { recursive: true, mode: 0o700 });
  const directory = mkdtempSync(join(tempRoot, 'lifestyle-signing-'));
  let createdProperties = false;
  try {
    const store = join(directory, 'release.jks');
    writeFileSync(store, bytes, { mode: 0o600, flag: 'wx' });
    const values = { storeFile: store, storePassword: env.ANDROID_KEYSTORE_PASSWORD,
      keyAlias: env.ANDROID_KEY_ALIAS, keyPassword: env.ANDROID_KEY_PASSWORD };
    const descriptor = openSync(properties, 'wx', 0o600);
    createdProperties = true;
    try {
      writeFileSync(descriptor, Object.entries(values).map(([key, value]) => key + '=' + propertyValue(value)).join('\n') + '\n');
    } finally { closeSync(descriptor); }
    return { directory, properties };
  } catch {
    if (createdProperties) rmSync(properties);
    rmSync(directory, { recursive: true, force: true });
    throw new Error('Private signing preparation failed; no secret values emitted');
  } finally { bytes.fill(0); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let prepared;
  try {
    if (!process.env.RUNNER_TEMP || !process.env.GITHUB_ENV) throw new Error('A GitHub runner is required');
    if (/[\r\n]/.test(process.env.RUNNER_TEMP)) throw new Error('Invalid runner directory');
    prepared = prepareSigning({ androidDir: resolve('mobile-app/mobile/android'),
      tempRoot: process.env.RUNNER_TEMP, env: process.env });
    appendFileSync(process.env.GITHUB_ENV, `ANDROID_SIGNING_DIRECTORY=${prepared.directory}\n`);
    console.log('PASS: private signing configuration prepared; build/signature verification not yet executed');
  } catch {
    if (prepared) { rmSync(prepared.properties, { force: true }); rmSync(prepared.directory, { recursive: true, force: true }); }
    console.error('FAIL: Android signing preparation refused or failed; check configured runner secrets privately');
    process.exitCode = 1;
  }
}
