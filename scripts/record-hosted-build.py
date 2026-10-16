#!/usr/bin/env python3
"""Fresh read-only GitHub CI metadata, never logs, credentials or signed download URLs."""
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'docs/remediation/hosted-build.json'
REPO = 'KarimOmarShawky/life-style-app'
BRANCH = 'arena/3f871eac-life-style-app'
# Set only to an actual run ID previously returned by GitHub, not an invented value.
REQUEST = ROOT / 'docs/remediation/hosted-build-request.json'
SOURCE_PATHS = ['backend/src', 'backend/tests', 'backend/package.json', 'backend/package-lock.json',
                'mobile-app/mobile', '.github/workflows/ci.yml',
                'scripts/prepare-android-signing.mjs', 'scripts/verify-android-apk.mjs',
                'scripts/android-build-preparation.test.mjs', 'scripts/smoke-android-verifier.sh',
                'scripts/check-pilot-api.py', 'scripts/run-pilot-environment.py']


def api(path):
    return json.loads(subprocess.check_output(['gh', 'api', 'repos/' + REPO + '/' + path],
                                             cwd=ROOT, stderr=subprocess.PIPE))


def main():
    if subprocess.check_output(['git', 'branch', '--show-current'], cwd=ROOT).decode().strip() != BRANCH:
        raise ValueError('Unexpected working branch')
    request = json.loads(REQUEST.read_text())
    run_id = request['run_id']
    if not isinstance(run_id, int) or run_id <= 0:
        raise ValueError('Invalid run reference')
    run = api(f'actions/runs/{run_id}')
    sha = run['head_sha']
    if run['head_branch'] != BRANCH or run['event'] not in ['push', 'workflow_dispatch']:
        raise ValueError('Unexpected run source')
    subprocess.run(['git', 'merge-base', '--is-ancestor', sha, 'HEAD'], cwd=ROOT, check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    subprocess.run(['git', 'diff', '--exit-code', sha, '--', *SOURCE_PATHS], cwd=ROOT, check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    if subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', '--', *SOURCE_PATHS], cwd=ROOT).strip():
        raise ValueError('Unverified untracked application source')
    jobs = api(f'actions/runs/{run_id}/jobs?per_page=100')['jobs']
    artifacts = api(f'actions/runs/{run_id}/artifacts?per_page=100')['artifacts']
    result = 'PASS' if run['status'] == 'completed' and run['conclusion'] == 'success' else 'FAIL' if run['status'] == 'completed' else 'BLOCKED'
    output = dict(result=result, run_id=run_id, head_sha=sha, branch=BRANCH,
                  html_url=run['html_url'], event=run['event'], status=run['status'], conclusion=run['conclusion'],
                  source_match_paths=SOURCE_PATHS,
                  scope='Fresh GitHub job/step metadata; application and workflow source match built SHA. External temporary-pilot HTTPS/API probe, if actually executed, is separately visible by step name; not physical Android integration, provider inbox, release or image certification.',
                  jobs=[dict(id=j['id'], name=j['name'], status=j['status'], conclusion=j['conclusion'],
                             steps=[{k: s.get(k) for k in ['name', 'status', 'conclusion']} for s in j['steps']]) for j in jobs],
                  artifacts=[dict(id=a['id'], name=a['name'], size_in_bytes=a['size_in_bytes'],
                                  expired=a['expired'], digest=a.get('digest'),
                                  html_url=run['html_url'] + '/artifacts/' + str(a['id'])) for a in artifacts])
    REPORT.write_text(json.dumps(output, indent=2) + '\n')
    print(f'{result}: hosted run {run_id}, commit {sha}; application/workflow source match checked. No raw logs or private URLs retained.')
    for job in output['jobs']:
        print(job['name'] + ': ' + str(job['conclusion']))
    return 0 if result == 'PASS' else 2 if result == 'BLOCKED' else 1


if __name__ == '__main__':
    try:
        code = main()
    except Exception:
        REPORT.write_text(json.dumps(dict(result='BLOCKED', scope='Fresh API metadata/source-match check unavailable; no stale PASS reused.'), indent=2) + '\n')
        print('BLOCKED: hosted metadata/source integrity could not be checked; no success inferred or private diagnostics emitted.')
        code = 2
    raise SystemExit(code)
