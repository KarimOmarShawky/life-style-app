#!/usr/bin/env python3
"""Metadata-only provenance check, NOT a clean-history or deployed-reuse verdict."""
import json
from pathlib import Path
import re
import subprocess
import sys
import unittest
from urllib.parse import unquote, urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parents[1]
BASE = '47cf1fd09540e7bcc8b291d6d9a1559cf0c5f855'
REFERENCE = 'backend/src/infrastructure/database/postgres/init-roles.sql'
ALLOWED_PATHS = {'.env.example', 'backend/.env.example', '.github/workflows/ci.yml',
                 'backend/tests/setup.ts', 'docker-compose.yml', 'docker/docker-compose.yml',
                 'scripts/ensure-env.sh', 'scripts/verify-ci.sh'}
URI = re.compile(r'postgres(?:ql)?://[^\s\'"`]+')
RULE = '@secretlint/secretlint-rule-database-connection-string'


def classify(path, rule, line, definitions):
    urls = URI.findall(line)
    if path not in ALLOWED_PATHS or rule != RULE or len(urls) != 1:
        return None
    uri = urlsplit(urls[0])
    if uri.query or uri.fragment:
        return None
    if uri.hostname not in {'localhost', '127.0.0.1', '::1', 'postgres', 'db'}:
        return None
    if uri.username not in definitions or unquote(uri.password or '') != definitions[uri.username]:
        return None
    return {'classification': 'repository_local_or_CI_default',
            'exact_baseline_role_default_match': True,
            'host_class': 'loopback' if uri.hostname in {'localhost', '127.0.0.1', '::1'} else 'compose_service',
            'reference_commit': BASE, 'reference_path': REFERENCE,
            'provenance_verification': 'PASS',
            'production_reuse_verification': 'BLOCKED',
            'action': 'Current-source removal retained; inspect deployed/ignored configurations and coordinate rotation if reused. No live connection or rotation attempted.'}


class ProvenanceNegativeTests(unittest.TestCase):
    def test_strict_provenance_not_filename_only(self):
        def line(host='localhost', password='synthetic-only'):
            return urlunsplit(('postgresql', 'fixture:' + password + '@' + host, '/fixture', '', ''))
        definitions = {'fixture': 'synthetic-only'}
        self.assertIsNotNone(classify('.env.example', RULE, line(), definitions))
        for path, rule, value in [
            ('unknown.txt', RULE, line()), ('.env.example', 'other-rule', line()),
            ('.env.example', RULE, line('remote.invalid')),
            ('.env.example', RULE, line(password='different')),
            ('.env.example', RULE, line() + ' ' + line()),
            ('.env.example', RULE, line() + '?host=remote.invalid'),
            ('.env.example', RULE, line() + '#fragment'),
            ('.env.example', RULE, 'no URI')
        ]:
            self.assertIsNone(classify(path, rule, value, definitions))


def main():
    report = json.loads((ROOT / 'docs/remediation/history-scan.json').read_text())
    raw = subprocess.check_output(['git', 'show', BASE + ':' + REFERENCE], cwd=ROOT).decode()
    definitions = dict(re.findall(r"CREATE ROLE\s+(\w+)\s+WITH LOGIN PASSWORD\s+'([^']+)'", raw))
    if len(definitions) != 3:
        raise RuntimeError('Historical reference changed')
    rows = []
    for finding in report['metadata_only_findings']:
        source = subprocess.check_output(['git', 'cat-file', 'blob', finding['blob']], cwd=ROOT).decode()
        line = source.splitlines()[finding['line'] - 1]
        decision = classify(finding['path'], finding['rule'], line, definitions)
        rows.append({key: finding[key] for key in ['blob', 'path', 'line', 'rule']} | (decision or {
            'classification': 'requires_manual_review', 'provenance_verification': 'BLOCKED',
            'production_reuse_verification': 'BLOCKED'}))
    result = 'PASS' if all(row['provenance_verification'] == 'PASS' for row in rows) else 'BLOCKED'
    output = {'result': result, 'scope': 'Exact in-memory comparison to baseline repository development-role defaults and local service hosts. This does NOT clear detector findings or prove absent live reuse.',
              'detector_result': report['result'], 'review_date': '2026-10-16',
              'local_reachable_commits': report['local_reachable_commits'], 'records': rows,
              'historical_11_match_scan': 'Earlier shallow-checkout result retained in verification-history.md; unshallow fetch expanded coverage. No Git history rewrite or detector exception.'}
    (ROOT / 'docs/remediation/history-provenance.json').write_text(json.dumps(output, indent=2) + '\n')
    print(f'{result}: provenance reviewed for {len(rows)} historical metadata records; detector remains {report["result"]}; deployed reuse BLOCKED. No matched values emitted.')
    return 0 if result == 'PASS' else 1


if __name__ == '__main__':
    if '--self-test' in sys.argv:
        unittest.main(argv=[sys.argv[0]])
    else:
        try:
            raise SystemExit(main())
        except Exception:
            print('FAIL: provenance inventory could not be verified; no values emitted or clean-history inference')
            raise SystemExit(1)
