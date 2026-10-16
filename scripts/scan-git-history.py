#!/usr/bin/env python3
"""Scan locally reachable unique Git text blobs, metadata-only diagnostics.
Does not rewrite Git, execute historical code, fetch refs or contact providers.
"""
import bisect
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'docs/remediation/history-scan.json'
CLI = ROOT / 'tools/security/node_modules/secretlint/bin/secretlint.js'


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def main():
    if not CLI.is_file():
        print('BLOCKED: pinned detector unavailable; history scan NOT RUN')
        return 2
    config = json.loads((ROOT / 'tools/security/.secretlintrc.json').read_text())
    for rule in config['rules']:
        if rule['id'].startswith('.'):
            rule['id'] = str(ROOT / rule['id'])
    objects = {}
    for line in git('rev-list', '--objects', '--all').decode().splitlines():
        parts = line.split(' ', 1)
        objects[parts[0]] = parts[1] if len(parts) > 1 else '(unnamed object)'
    inventory = subprocess.run(['git', 'cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
                               cwd=ROOT, input='\n'.join(objects) + '\n', text=True,
                               stdout=subprocess.PIPE, check=True).stdout
    findings, skipped, batch, locations, starts = [], [], [], [], []
    scanned = 0
    lines = 1
    byte_count = 0

    def flush():
        nonlocal batch, locations, starts, lines, byte_count
        if not batch:
            return
        result = subprocess.run(['node', str(CLI), '--secretlintrcJSON', json.dumps(config),
                                 '--format', 'json', '--stdinFileName', 'historical-source.txt'],
                                cwd=ROOT, input=''.join(batch), text=True, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=90)
        if result.returncode not in [0, 1]:
            raise RuntimeError('Detector did not complete')
        parsed = json.loads(result.stdout)
        if not isinstance(parsed, list) or len(parsed) != 1:
            raise RuntimeError('Incomplete detector result')
        messages = parsed[0]['messages']
        if result.returncode and not messages:
            raise RuntimeError('Detector failure without diagnostics')
        for message in messages:
            start = message.get('loc', {}).get('start', {})
            line = start.get('line') or message.get('line')
            if not isinstance(line, int):
                raise RuntimeError('Missing diagnostic location')
            index = bisect.bisect_right(starts, line) - 1
            if index < 0:
                raise RuntimeError('Unmapped diagnostic')
            blob, path = locations[index]
            findings.append(dict(blob=blob, path=path, line=line - starts[index] + 1,
                                 rule=message['ruleId'], review='Separate provenance review required; see history-provenance.json; no value emitted'))
        batch, locations, starts, lines, byte_count = [], [], [], 1, 0

    for row in inventory.splitlines():
        oid, kind, size = row.split()
        if kind != 'blob':
            continue
        if int(size) > 2 * 1024 * 1024:
            skipped.append(dict(blob=oid, path=objects[oid], reason='larger than 2 MiB text-scan cap'))
            continue
        raw = git('cat-file', 'blob', oid)
        if b'\0' in raw:
            skipped.append(dict(blob=oid, path=objects[oid], reason='binary/NUL'))
            continue
        try:
            text = raw.decode('utf-8')
        except UnicodeDecodeError:
            skipped.append(dict(blob=oid, path=objects[oid], reason='not UTF-8'))
            continue
        if byte_count + len(raw) > 512 * 1024:
            flush()
        starts.append(lines); locations.append((oid, objects[oid]))
        # Neutral blank separator: no historical source is written to disk/executed.
        batch.append(text + '\n\n'); lines += text.count('\n') + 2
        byte_count += len(raw); scanned += 1
    flush()
    commits = int(git('rev-list', '--count', '--all'))
    result = 'FAIL' if findings else 'PASS'
    REPORT.write_text(json.dumps(dict(result=result, scan_head=git('rev-parse', 'HEAD').decode().strip(), local_reachable_commits=commits,
        is_shallow_repository=git('rev-parse', '--is-shallow-repository').decode().strip() == 'true',
        provenance_report='docs/remediation/history-provenance.json',
        unique_utf8_blobs_scanned=scanned, metadata_only_findings=findings, skipped=skipped,
        scope='Locally reachable Git refs only; unique UTF-8 blobs <=2 MiB; batches separated by blank lines. Binary/large/unfetched/unreachable/image/private-runtime contents not certified. Matches require review, not proof of live credential reuse.'), indent=2) + '\n')
    print(f'{result}: {scanned} reachable unique UTF-8 blobs across {commits} local commits; {len(findings)} historical matches; {len(skipped)} binary/large/non-UTF8 blobs skipped.')
    print('Metadata only in docs/remediation/history-scan.json. No source/matched values printed, history rewritten or provider reuse tested.')
    return 1 if findings else 0


if __name__ == '__main__':
    try:
        code = main()
    except Exception:
        print('FAIL: Git-history detector/inventory could not complete; no clean scan inferred')
        code = 1
    raise SystemExit(code)
