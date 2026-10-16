/** Requires real Android SDK apksigner in CLI mode. Parsing tests are not APK verification. */
import { existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

export function verifyCertificate(output, mode, expected = '') {
  if (!['debug', 'release'].includes(mode)) throw new Error('APK mode must be debug or release');
  const digest = output.match(/^Signer #1 certificate SHA-256 digest: ([a-fA-F0-9]{64})\s*$/m)?.[1]?.toLowerCase();
  if (!/^Number of signers: 1\s*$/m.test(output) || !digest) throw new Error('A verified single-signer APK is required');
  const debug = /^Signer #1 certificate DN: .*\bCN=Android Debug(?:,|\s*$)/m.test(output);
  if (mode === 'debug' && !debug) throw new Error('Validation APK must use the explicit Android debug identity');
  if (mode === 'release') {
    const normalized = expected.replaceAll(':', '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalized) || normalized !== digest || debug) {
      throw new Error('Release signer is debug, unexpected or not explicitly configured');
    }
  }
}

export function verifyPackage(output, mode) {
  const expected = mode === 'debug' ? 'com.lifestyle.app.validation' : mode === 'release' ? 'com.lifestyle.app' : '';
  const actual = output.match(/^package: name='([^']+)'/m)?.[1];
  if (!expected || actual !== expected) throw new Error('APK application identity is not the expected isolated validation or release package');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let stage = 'inputs';
  const facts = {};
  try {
    const [mode, path] = process.argv.slice(2);
    const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
    if (!sdk || !path || !existsSync(path)) throw new Error('APK and Android SDK are required');
    stage = 'sdk-selection';
    const tools = join(sdk, 'build-tools');
    const version = readdirSync(tools).filter((name) => /^\d+\.\d+\.\d+$/.test(name) && existsSync(join(tools, name, 'lib', 'apksigner.jar')))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
    if (!version) throw new Error('Android apksigner unavailable');
    facts.sdkToolVersion = version;
    const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
    // Invoke the SDK jar directly: no shell interpolation or Windows .bat handling.
    stage = 'sdk-signature-command';
    const output = execFileSync(java, ['-jar', join(tools, version, 'lib', 'apksigner.jar'), 'verify', '--verbose', '--print-certs', resolve(path)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    stage = 'certificate-policy';
    facts.signerCount = output.match(/Number of signers:\s*(\d{1,2})/)?.[1] || 'absent';
    facts.sha256Present = /^Signer #1 certificate SHA-256 digest: [a-fA-F0-9]{64}\s*$/m.test(output);
    facts.debugSubjectPresent = output.includes('CN=Android Debug');
    verifyCertificate(output, mode, process.env.ANDROID_RELEASE_CERT_SHA256);
    const aapt = join(tools, version, process.platform === 'win32' ? 'aapt2.exe' : 'aapt2');
    stage = 'sdk-manifest-command';
    const manifest = execFileSync(aapt, ['dump', 'badging', resolve(path)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    stage = 'manifest-policy';
    verifyPackage(manifest, mode);
    console.log(`PASS: ${mode} APK signature verified; not device, backend-connectivity or feature certification`);
  } catch (error) {
    const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '';
    const reason = stderr.includes('UnsupportedClassVersionError') ? 'JAVA_VERSION_INCOMPATIBLE' : stderr.includes('Unable to access jarfile') ? 'SDK_JAR_INACCESSIBLE' : stderr.includes('DOES NOT VERIFY') ? 'APK_NOT_VERIFIED' : 'VERIFICATION_REFUSED';
    // Fixed stages, booleans/counts and numeric SDK version only: no raw SDK stderr, DN, key or exception.
    console.error('::error title=APK verification diagnostic::' + JSON.stringify({ stage, reason, ...facts }));
    console.error('FAIL: APK signature verification failed or prerequisites missing; no release artifact accepted');
    process.exitCode = 1;
  }
}
