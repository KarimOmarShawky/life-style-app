/**
 * Verifies a release Android App Bundle (.aab) with the JDK's own jarsigner and keytool.
 * App Bundles carry a JAR signature (not an APK signature scheme), so apksigner does not apply.
 * Parsing tests are not bundle verification; Google Play performs its own checks on upload.
 */
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';

export function verifyBundleSignature(output) {
  if (/jar is unsigned|unsigned entries|not signed|jar is tampered/i.test(output) || !/^jar verified\.\s*$/m.test(output)) {
    throw new Error('A fully signed, verified App Bundle is required');
  }
}

export function verifyBundleCertificate(output, expected = '') {
  const certificates = output.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
  if (certificates.length !== 1) throw new Error('Exactly one signer certificate is required');
  const certificate = new X509Certificate(certificates[0]);
  const digest = certificate.fingerprint256.replaceAll(':', '').toLowerCase();
  const debug = /^CN=Android Debug$/m.test(certificate.subject);
  const normalized = expected.replaceAll(':', '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized) || normalized !== digest || debug) {
    throw new Error('Bundle signer is debug, unexpected or not explicitly configured');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let stage = 'inputs';
  try {
    const [path] = process.argv.slice(2);
    if (!path || !path.endsWith('.aab') || !existsSync(path)) throw new Error('A release .aab is required');
    const tool = (name) => (process.env.JAVA_HOME
      ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? `${name}.exe` : name) : name);
    // JDK tools are invoked directly: no shell interpolation.
    stage = 'jdk-signature-command';
    const verified = execFileSync(tool('jarsigner'), ['-verify', resolve(path)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    stage = 'signature-policy';
    verifyBundleSignature(verified);
    stage = 'jdk-certificate-command';
    const printed = execFileSync(tool('keytool'), ['-printcert', '-rfc', '-jarfile', resolve(path)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    stage = 'certificate-policy';
    verifyBundleCertificate(printed, process.env.ANDROID_RELEASE_CERT_SHA256);
    console.log('PASS: release App Bundle signature verified against the expected upload certificate; not device, Play review or feature certification');
  } catch {
    // Fixed stage names only: no raw tool output, DN, key material or exception text.
    console.error('::error title=App Bundle verification diagnostic::' + JSON.stringify({ stage }));
    console.error('FAIL: App Bundle signature verification failed or prerequisites missing; no bundle accepted');
    process.exitCode = 1;
  }
}
