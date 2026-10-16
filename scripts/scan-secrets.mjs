#!/usr/bin/env node
// Worktree-only scanning. Never print source, matching values, or detector messages.
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = resolve(root, 'tools/security/node_modules/secretlint/bin/secretlint.js');
const config = JSON.parse(readFileSync(resolve(root, 'tools/security/.secretlintrc.json'), 'utf8'));
config.rules = config.rules.map((rule) => rule.id.startsWith('.') ? { ...rule, id: resolve(root, rule.id) } : rule);

function scan(args, input) {
  const result = spawnSync(process.execPath, [cli, '--secretlintrcJSON', JSON.stringify(config),
    '--format', 'json', '--no-glob', '--no-gitignore',
    '--secretlintignore', resolve(root, 'tools/security/.secretlintignore'), ...args], {
    cwd: root, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024
  });
  // Tool failures are NOT clean scans. Do not echo errors/stdout, which may carry
  // source or detector/provider details. Default Secretlint masking stays enabled.
  if (![0, 1].includes(result.status) || result.error) throw new Error('Secret scanner failed');
  const files = JSON.parse(result.stdout);
  if (!Array.isArray(files) || (input !== undefined && files.length !== 1)) {
    throw new Error('Incomplete scanner result');
  }
  const findings = files.flatMap((file) => {
    if (!Array.isArray(file.messages)) throw new Error('Invalid scanner messages');
    return file.messages.map((message) => ({
      file: relative(root, resolve(root, file.filePath)), rule: message.ruleId,
      line: message.loc?.start?.line ?? message.line,
      column: message.loc?.start?.column ?? message.column
    }));
  });
  if (input === undefined) {
    const seen = new Set(files.map((file) => file.filePath));
    if (seen.size !== files.length || files.some((file) => !args.includes(file.filePath))) {
      throw new Error('Unexpected scanner inventory');
    }
    // Upstream deliberately skips its own config/ignore files even with literal
    // inputs. Scan omitted files through STDIN with a neutral extension-preserving
    // hint instead of silently calling a partial inventory clean.
    for (const path of args.filter((file) => !seen.has(file))) {
      const extra = scan(['--stdinFileName', `source-review${extname(path) || '.txt'}`], readFileSync(path, 'utf8'));
      findings.push(...extra.map((finding) => ({ ...finding, file: relative(root, path) })));
    }
  }
  // A nonzero tool exit without parsed diagnostics must never be considered PASS.
  if (result.status !== 0 && findings.length === 0) throw new Error('Unreported scanner failure');
  return findings;
}

try {
  if (process.argv.includes('--self-test')) {
    // Ephemeral detector probe, never an application credential or committed key.
    const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' }
    });
    if (scan(['--stdinFileName', 'probe.pem'], privateKey).length === 0) {
      throw new Error('Detector did not reject private-key probe');
    }
    if (scan(['--stdinFileName', 'probe.json'], JSON.stringify({ key: privateKey })).length === 0) {
      throw new Error('Detector missed JSON-escaped private key');
    }
    const { privateKey: rsa } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' }
    });
    if (scan(['--stdinFileName', 'probe.pem'], rsa).length === 0) {
      throw new Error('Detector missed RSA private key');
    }
    const syntheticSecret = randomBytes(20).toString('hex');
    if (scan(['--stdinFileName', 'probe.env'], `AWS_SECRET_ACCESS_KEY=${syntheticSecret}\n`).length === 0) {
      throw new Error('Recommended credential detector did not reject synthetic secret pattern');
    }
    if (scan(['--stdinFileName', 'probe.pub'], publicKey).length !== 0) {
      throw new Error('Public-key detector negative probe failed');
    }
    if (scan(['--stdinFileName', 'probe.txt'], 'ordinary project documentation\n').length !== 0) {
      throw new Error('Benign detector probe failed');
    }
    console.log('PASS: real detectors reject ephemeral Ed25519/RSA/JSON private keys and synthetic AWS pattern, accept public key/benign input; values not logged.');
  } else {
    const inventory = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024
    });
    if (inventory.status !== 0) throw new Error('Git inventory failed');
    let symlinks = 0;
    const files = [...new Set(inventory.stdout.split('\0').filter(Boolean))].filter((path) => {
      try {
        const stat = lstatSync(resolve(root, path));
        if (stat.isSymbolicLink()) { symlinks++; return false; }
        return stat.isFile();
      } catch (err) {
        if (err.code === 'ENOENT') return false; // Reviewed working-tree deletions.
        throw err;
      }
    });
    if (files.length === 0 || symlinks > 0) throw new Error('Incomplete scan inventory');
    let findings = 0;
    for (let i = 0; i < files.length; i += 50) {
      const batch = scan(files.slice(i, i + 50).map((path) => resolve(root, path)));
      findings += batch.length;
      for (const finding of batch) console.log(JSON.stringify(finding));
    }
    console.log(`${findings ? 'FAIL' : 'PASS'}: ${files.length} current files scanned; ${findings} findings. Worktree only, not Git history or image scanning.`);
    process.exitCode = findings ? 1 : 0;
  }
} catch {
  console.error('FAIL: secret scan incomplete or detector self-test failed; no clean-scan claim. Check tool installation/configuration without publishing raw detector output.');
  process.exitCode = 2;
}
