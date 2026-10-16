#!/usr/bin/env python3
"""Real HTTP/TLS synthetic roundtrip against ONLY this temporary pilot, not production.
No passwords/tokens/response bodies are printed or saved. No mocks or email calls.
"""
import json
import os
from pathlib import Path
import secrets
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def main():
    base = os.environ.get('PILOT_API_BASE_URL', 'http://127.0.0.1:8787/api/v1').rstrip('/')
    url = urllib.parse.urlsplit(base)
    local = url.scheme == 'http' and url.netloc == '127.0.0.1:8787'
    remote = url.scheme == 'https' and url.netloc == '8787-itafbygcp2juf4i455pef.e2b.app'
    if not (local or remote) or url.path != '/api/v1' or url.query or url.fragment or url.username or url.password:
        raise ValueError('Only the exact owner-approved isolated pilot is permitted')
    checks = []
    output = ROOT / 'docs/remediation/pilot-smoke.json'
    def request(path, method='GET', body=None, token=None, ctype='application/json', health=False):
        headers = {'Content-Type': ctype}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        target = base.removesuffix('/api/v1') + path if health else base + path
        req = urllib.request.Request(target, data=json.dumps(body).encode() if body is not None else None, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=20) as response:
                raw = response.read()
                return response.status, json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            return error.code, json.load(error)
    def check(name, condition):
        checks.append(dict(name=name, result='PASS' if condition else 'FAIL'))
        if not condition:
            raise ValueError('Pilot roundtrip assertion failed')
        print('PASS: ' + name, flush=True)
    try:
        check('Actual database/cache readiness' + (' over certificate-validated public HTTPS' if remote else ' over loopback HTTP'), request('/health/ready', health=True) == (200, {'status': 'ok'}))
        check('Unauthenticated tasks refused', request('/tasks')[0] == 401)
        password = secrets.token_hex(20)
        email = 'pilot-smoke-' + secrets.token_hex(8) + '@example.invalid'
        status, data = request('/auth/register', 'POST', dict(email=email, password=password, displayName='Synthetic pilot smoke'))
        check('Actual registration and session', status == 201 and bool(data.get('tokens', {}).get('accessToken')))
        token = data['tokens']['accessToken']
        status, data = request('/auth/login', 'POST', dict(email=email, password=password))
        check('Actual password login', status == 200 and bool(data.get('tokens', {}).get('accessToken')))
        token = data['tokens']['accessToken']
        status, data = request('/tasks', 'POST', {'title': 'Synthetic roundtrip only'}, token)
        check('Actual authenticated task creation', status == 201 and bool(data.get('task', {}).get('id')))
        task = data['task']['id']
        status, data = request('/tasks/' + task, token=token)
        check('Created task persisted and read back', status == 200 and data.get('task', {}).get('title') == 'Synthetic roundtrip only')
        status, data = request('/auth/register', 'POST', dict(email='pilot-other-' + secrets.token_hex(8) + '@example.invalid', password=secrets.token_hex(20), displayName='Synthetic second owner'))
        check('Second real isolated account', status == 201 and bool(data.get('tokens', {}).get('accessToken')))
        other = data['tokens']['accessToken']
        check('Cross-account task access refused', request('/tasks/' + task, token=other)[0] == 404)
        check('Non-JSON upload refused', request('/tasks', 'POST', {'title': 'Rejected non-JSON'}, token, 'application/octet-stream')[0] == 415)
        check('No migration endpoint exposed', request('/health/migrate', health=True)[0] == 404)
        check('Delete only our newly created synthetic task', request('/tasks/' + task, 'DELETE', token=token)[0] in (200, 204))
        check('Readiness remains healthy', request('/health/ready', health=True) == (200, {'status': 'ok'}))
    finally:
        output.write_text(json.dumps(dict(result='PASS' if len(checks) == 12 and all(c['result'] == 'PASS' for c in checks) else 'FAIL', transport='public HTTPS' if remote else 'loopback HTTP', scope='Actual synthetic HTTP/TLS account/task persistence/authorization tests, NOT Android/device/provider/full E2E evidence. Credentials memory only, never logged. No user accounts/data were adopted or cleaned.', checks=checks), indent=2) + '\n')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('FAIL: actual pilot HTTP/TLS roundtrip incomplete; no response body, credentials or private exception emitted.', flush=True)
        raise SystemExit(1)
