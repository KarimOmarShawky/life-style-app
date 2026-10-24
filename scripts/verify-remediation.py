#!/usr/bin/env python3
"""Safe final verification. Never adopts existing resources. C32 executes migrations/destructive suites ONLY on new process/data-directory-proven owned fixtures."""
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'docs/remediation/evidence'
EVIDENCE.mkdir(parents=True, exist_ok=True)
checks = []

def run(id, command, reason='', expected_refusal=False):
    env = os.environ.copy()
    if expected_refusal:
        for key in ['ALLOW_DESTRUCTIVE_TESTS', 'DATABASE_URL', 'REDIS_URL']:
            env.pop(key, None)
    result = subprocess.run(command, shell=True, cwd=ROOT, env=env,
                            text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    output = result.stdout
    success = result.returncode == 0
    if expected_refusal:
        success = result.returncode != 0 and 'Destructive tests require' in output and 'no tests' in output
    path = EVIDENCE / f'{id}.txt'
    path.write_text(f'$ {command}\nExit: {result.returncode}\n{output}')
    checks.append(dict(id=id, command=command, result='PASS' if success else 'FAIL',
                       exit_code=result.returncode, reason=reason, evidence=str(path.relative_to(ROOT))))
    print(id, checks[-1]['result'], flush=True)

run('C01', 'npm --prefix backend ci --no-audit --no-fund', 'Lockfile installation, including native bcrypt install.')
run('C02', 'npm --prefix backend run typecheck', 'Production source strict compilation.')
run('C03', 'npm --prefix backend run typecheck:tests', 'Strict compilation includes all unit/integration/security test sources.')
run('C04', 'npm --prefix backend run lint')
run('C05', 'npm --prefix backend run format:check')
run('C06', 'npm --prefix backend run test:unit', 'Only unit tests; inert endpoints and in-memory OTP.')
run('C07', 'npm --prefix backend run build')
run('C08', 'npm --prefix backend audit --omit=dev --audit-level=high', 'Production dependency audit; not a full supply-chain certification.')
# Generator must be deterministic relative to the intentionally updated contract.
before = (ROOT / 'docs/api/openapi.yaml').read_bytes()
run('C09', 'npm --prefix backend run openapi:generate', 'Generator executes; generated file must match the intentionally updated contract.')
if (ROOT / 'docs/api/openapi.yaml').read_bytes() != before:
    checks[-1]['result'] = 'FAIL'
    checks[-1]['reason'] += ' Output drifted from expected updated document.'
run('C10', 'node scripts/check-forbidden.mjs', 'Owner-authorized local-only audio declaration/consumer exception; no global file_picker allowlist, server upload dependencies remain forbidden. Actual guard result, not native/network certification.')
run('C11', 'cd backend && ./node_modules/.bin/vitest run tests/integration/health.test.ts',
    'Expected nonzero refusal before integration file import/cleanup; NOT an integration test success.', True)
module = os.environ.get('DART_FMT_MODULE', '/home/user/tooling/node_modules/@wasm-fmt/dart_fmt/dart_fmt_node.js')
if Path(module).is_file():
    run('C12', f'node scripts/check-dart-syntax.mjs {module}', 'Scratch npm @wasm-fmt/dart_fmt@0.4.0. Syntax only; Flutter SDK absent.')
else:
    (EVIDENCE / 'C12.txt').write_text('BLOCKED: scratch WASM parser unavailable; syntax command NOT RUN.\n')
    checks.append(dict(id='C12', command=f'node scripts/check-dart-syntax.mjs {module}', result='BLOCKED',
                       reason='Scratch WASM parser unavailable; no syntax PASS inferred.', evidence='docs/remediation/evidence/C12.txt'))
run('C13', 'git diff --check', 'Tracked diff whitespace/error check; packaging verifies new files separately.')
# This opt-in harness creates/owns new services, ignores inherited URLs, proves
# process/data-directory identity before bootstrap or destructive hooks, then stops
# only its own children. It never adopts Docker/development/deployed resources.
runtime_path = ROOT / 'docs/remediation/disposable-results.json'
runtime_path.unlink(missing_ok=True)  # Generated evidence only: never accept a stale PASS.
run('C32', 'python scripts/run-disposable-verification.py',
    'Actual owned PostgreSQL16/Redis7 bootstrap/migration/grants/integration/security harness. No Docker, deployed legacy data, native device or real SMTP delivery certification.')
runtime = json.loads(runtime_path.read_text()) if runtime_path.is_file() else dict(result='FAIL', checks=[])
if runtime['result'] == 'BLOCKED':
    checks[-1]['result'] = 'BLOCKED'
    checks[-1]['reason'] = 'Scratch owned-runtime tools/private-config isolation prerequisite unavailable; suites NOT RUN. See C32 evidence.'
phases = {c['name']: c['result'] for c in runtime['checks']}
for id, command, phase, scope in [
    ('C15', 'npm run test:integration (owned C32 services only)', 'Actual integration suite on OWNED PostgreSQL/Redis', 'Actual integration suite, disposable current-schema fixtures only; not deployed data or Flutter E2E.'),
    ('C16', 'npm run test:security (owned C32 services only)', 'Actual security suite on OWNED PostgreSQL/Redis', 'Actual current security suite, not exhaustive penetration/provider/device testing.')]:
    checks.append(dict(id=id, command=command, result=phases.get(phase, 'BLOCKED'), reason=scope,
                       evidence='docs/remediation/evidence/C32.txt'))
migration_phases = ['Actual psql fresh-role bootstrap script', 'Actual psql repeat bootstrap MUST refuse existing roles',
    'Actual fresh forward migrations (migration identity)', 'Migration history stable after repeat',
    'Runtime role DDL MUST fail', 'Actual populated forward repeat (no rollback)',
    'Intentional failed migration MUST rollback (owned temporary migration copy)',
    'Failed migration leaves no partial table/history', 'Failed migration preserves populated fixture']
checks.append(dict(id='C17', command='Owned C32 bootstrap/fresh/repeat/synthetic-populated/failed migration and grant probes',
    result='PASS' if runtime['result'] == 'PASS' and all(phases.get(p) == 'PASS' for p in migration_phases) else 'FAIL' if any(phases.get(p) == 'FAIL' for p in migration_phases) else 'BLOCKED',
    reason='Actual PostgreSQL fixtures and psql bootstrap. Not an upgrade rehearsal against actual deployed legacy history/data; that remains C35 BLOCKED.', evidence='docs/remediation/evidence/C32.txt'))
blocked = [
 ('C18', 'docker compose config && docker compose build && docker compose up', 'Docker executable/daemon unavailable.'),
 ('C19', 'cd mobile-app/mobile && flutter analyze --fatal-infos', 'Flutter/Dart SDK unavailable; WASM parse is not analysis.'),
 ('C20', 'cd mobile-app/mobile && flutter test', 'Flutter SDK unavailable, including Digital Detox, wallet and 25 new archive protocol/transport/widget cases.'),
 ('C21', 'cd mobile-app/mobile && flutter build apk --release; Android JVM tests and signature verification', 'Flutter/Android SDK and signing credentials unavailable. Scratch Java/Kotlin execute the Android-free stage only in C30; bridge/app compilation remains BLOCKED.'),
 ('C22', 'Physical-device restriction/backup/Keystore/archive document-provider/lifecycle/SMTP verification checklist', 'No physical device/emulator or SMTP provider access/credentials. Real delivery and device enforcement unverified.')]
for id, command, reason in blocked:
    checks.append(dict(id=id, command=command, result='BLOCKED', reason=reason))
checks += [
 dict(id='C23', command='Full application end-to-end suite', result='NOT RUN', reason='No E2E execution attempted; native and infrastructure prerequisites not satisfied.'),
 dict(id='C24', command='Container-image security scanners / hosted CI execution', result='NOT RUN', reason='No Docker images/hosted execution. Current source is C25 and local reachable Git text history C36; B-31 stays partial.')]
run('C25', 'npm --prefix tools/security ci --ignore-scripts --no-audit --no-fund && npm --prefix tools/security audit --audit-level=high && node scripts/scan-secrets.mjs --self-test && node scripts/scan-secrets.mjs',
    'Current-source only; real detector probes, no allowlist, metadata-only output. Original 18 provenance records and historical 18/16 findings remain in secret-triage.json; current-source result does not assess deployed reuse, Git history, images or generated private configuration.')
run('C26', 'bash -n scripts/ensure-env.sh scripts/verify-ci.sh && node --test scripts/check-environment.test.mjs',
    '17 local configuration/command-spy/provenance/Compose source tests; no actual migrations, Docker networking or infrastructure suite success implied.')
run('C27', 'node --check scripts/local-setup.mjs && node --check scripts/local-stack.mjs && node --check scripts/ci-database-env.mjs && node --test scripts/local-setup.test.mjs',
    '22 fresh-setup/private-file/CI-fixture/command-spy/source tests in owned temporary directories only. No real Docker, PostgreSQL, migrations or hosted runner verification.')
run('C28', 'node --check scripts/ci-resource-guard.mjs && node --test scripts/ci-resource-guard.test.mjs',
    '16 hosted-resource guard/negative/source tests with Docker command spies only. The separate qa-gate.yml Docker harness is NOT RUN; authorized ci.yml execution is C39, not inferred from these command spies. Actual archive/infrastructure execution is separately C15/C32, not inferred from C28.')
run('C29', 'node --test scripts/archive-mobile-contract.test.mjs',
    '8 synthetic archive-wire-fixture/source-contract checks. Not Dart execution, Android bridge compilation or document-provider/UI integration.')
java_home = Path(os.environ.get('ARCHIVE_JAVA_HOME', '/home/user/.venv/lib/python3.11/site-packages/jdk4py/java-runtime'))
compiler = Path(os.environ.get('ARCHIVE_KOTLIN_COMPILER', '/home/user/tooling/node_modules/kotlin-compiler/bin/kotlinc'))
if (java_home / 'bin/java').is_file() and compiler.is_file():
    run('C30', 'python scripts/check-archive-stage.py',
        '10 real JVM crypto/file-I/O checks compiling the actual Android-free Kotlin stager. Android bridge, document providers, Activity lifecycle, Flutter and physical-device behavior NOT RUN; not a native app build.')
else:
    checks.append(dict(id='C30', command='python scripts/check-archive-stage.py', result='BLOCKED',
                       reason='Scratch JVM/Kotlin compiler unavailable. No runtime PASS inferred; install reviewed external tools or set ARCHIVE_JAVA_HOME/ARCHIVE_KOTLIN_COMPILER.'))
run('C31', 'node --test scripts/check-forbidden.test.mjs',
    '21 scoped policy negative/source/actual-CLI fixture checks. No production upload/device/network observation implied; C06 also executes 13 real JSON-only middleware checks.')
run('C33', 'node --test scripts/native-voice-cleanup.test.mjs',
    '8 native voice cleanup/source-contract checks only. No Kotlin Android compile or speech/notification/lifecycle/device execution.')
run('C34', 'npm --prefix backend run typecheck -- --noUnusedLocals --noUnusedParameters',
    'Actual strict TypeScript unused-local/parameter check; no backend source candidates removed without compiler evidence.')
checks.append(dict(id='C35', command='Actual legacy deployment migration/restore rehearsal', result='BLOCKED',
    reason='Actual deployed legacy schema/history, backup and target unavailable. Owned current-schema fixture C17 does not certify real deployment/restore. No user database contacted.'))
run('C36', 'python scripts/scan-git-history.py',
    'Actual unique UTF-8 Git blobs in locally reachable refs only; binary/large/non-UTF8/unfetched/unreachable/image/runtime contents excluded explicitly. Historical matches FAIL pending operational assessment, not proof of live reuse.')
run('C37', 'node --check scripts/prepare-android-signing.mjs && node --check scripts/verify-android-apk.mjs && node --test scripts/android-build-preparation.test.mjs',
    '17 real private-filesystem/negative/parser/source/YAML/bash/copy/identity and missing-SDK CLI-refusal checks. Public/synthetic certificate fixtures and source checks do not themselves prove real application signatures or native behavior. Real SDK fixture and application execution are separately C39/C40; release/device/image gates remain distinct.')
run('C38', 'python scripts/review-history-provenance.py --self-test && python scripts/review-history-provenance.py',
    'Strict negative provenance self-test and actual in-memory comparison of every C36 match with baseline development-role definitions/local service hosts. Metadata only; C36 stays FAIL. Deployed reuse/rotation remains BLOCKED, original 18 source records preserved separately.')
run('C39', 'python scripts/record-hosted-build.py',
    'Fresh GitHub run/job/step/artifact metadata and exact application/workflow source comparison to built commit; not deployment, connected backend, release key, device or inbox delivery certification.')
hosted = json.loads((ROOT / 'docs/remediation/hosted-build.json').read_text())
if hosted['result'] == 'BLOCKED':
    checks[-1]['result'] = 'BLOCKED'
mobile = next((j for j in hosted.get('jobs', []) if j['name'].startswith('Flutter and Android debug validation')), {})
steps = {s['name']: s['conclusion'] for s in mobile.get('steps', [])}
for id, step in [('C19', 'Flutter static analysis'), ('C20', 'Flutter tests')]:
    if step in steps and steps[step] in ['success', 'failure']:
        check = next(c for c in checks if c['id'] == id)
        prerequisites = ['Dart formatting'] + (['Flutter static analysis'] if id == 'C20' else [])
        clean_workspace = all(steps.get(name) == 'success' for name in prerequisites)
        sdk_ready = steps.get('Setup Flutter stable channel') == 'success'
        result = 'BLOCKED' if not sdk_ready else 'FAIL' if steps[step] == 'failure' else 'PASS' if clean_workspace else 'BLOCKED'
        check.update(result=result, command='Hosted ' + step + ' (C39 source-pinned run)',
                     reason='Actual hosted execution; PASS also requires clean preceding format/analysis gates, since diagnostic repair may modify a failed workspace. No device or connected-backend certification.',
                     evidence='docs/remediation/hosted-build.json')
next(c for c in checks if c['id'] == 'C24').update(command='Container-image security scanners',
    reason='Image security scanning NOT RUN. Actual hosted CI is recorded separately in C39/C40; it does not certify images.')
next(c for c in checks if c['id'] == 'C21')['reason'] = 'Owner-key signed/obfuscated release remains unavailable, not inferred from debug. Actual Android debug compilation/JVM/signature status is C40. No device certification.'
required = ['Kotlin JVM unit tests', 'Build Android debug validation APK (offline by default, not release)',
            'Verify validation APK signature', 'Upload debug validation APK (not a release or connected backend test)']
artifact = any(a['name'] == 'lifestyle-android-debug-validation-NOT-RELEASE' and not a['expired'] and a['size_in_bytes'] > 0 for a in hosted.get('artifacts', []))
debug_result = 'PASS' if all(steps.get(s) == 'success' for s in required) and artifact else 'FAIL' if any(steps.get(s) == 'failure' for s in required) else 'BLOCKED' if hosted['result'] == 'BLOCKED' else 'NOT RUN'
checks.append(dict(id='C40', command='Hosted Android debug JVM tests, APK compilation, SDK apksigner verification and upload',
    result=debug_result, reason='Actual source-pinned hosted steps and nonexpired artifact required. Debug identity/default offline endpoint only; not release signing, production API, device behavior or app E2E.',
    evidence='docs/remediation/hosted-build.json'))
pilot_step = steps.get('Approved temporary pilot public HTTPS and real API roundtrip (not device)')
checks.append(dict(id='C41', command='Actual owned temporary pilot plus external certificate-validated HTTPS/API roundtrip',
    result='PASS' if pilot_step == 'success' else 'BLOCKED',
    reason='Local fresh owned database/cache/API and 12 HTTP smoke assertions executed. External run38914942984 returned HTTP403; connected phone pilot remains BLOCKED unless a fresh source-pinned external step actually succeeds. No access-token bypass, production fallback, native-device or provider delivery inference.',
    evidence='docs/remediation/pilot-external-check.json'))
(ROOT / 'docs/remediation/checks.json').write_text(json.dumps(checks, indent=2) + '\n')
