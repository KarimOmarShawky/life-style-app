#!/usr/bin/env python3
"""Owner-approved, temporary SYNTHETIC-DATA pilot. New owned services only.
External scratch PostgreSQL16 and Redis7 are prerequisites, not app dependencies.
No existing URLs/config, provider credentials, purge workers or destructive suites.
"""
import json
import os
from pathlib import Path
import secrets
import signal
import socket
import socketserver
import subprocess
import tempfile
import threading
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
PG = Path('/home/user/pilot-tools/npm/node_modules/@embedded-postgres/linux-x64/native/bin')
CLIENT = Path('/home/user/pilot-tools/pgserver/pginstall/bin')
REDIS = Path('/home/user/pilot-tools/redis-src/src')
REPORT = ROOT / 'docs/remediation/pilot-environment.json'


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def main():
    if any((ROOT / p).exists() for p in ['.env', 'backend/.env']):
        raise RuntimeError('Existing dotenv requires a separate reviewed checkout')
    for p in [PG / 'postgres', PG / 'initdb', CLIENT / 'psql', REDIS / 'redis-server', REDIS / 'redis-cli', ROOT / 'backend/dist/app.js']:
        if not p.is_file():
            raise RuntimeError('Scratch tool/build prerequisite missing')
    base = Path('/home/user/.local/lifestyle-pilot')
    base.mkdir(parents=True, exist_ok=True, mode=0o700)
    if base.is_symlink() or base.stat().st_uid != os.getuid() or base.stat().st_mode & 0o077:
        raise RuntimeError('Private pilot base required')
    work = Path(tempfile.mkdtemp(prefix='owned-', dir=base))
    work.chmod(0o700)
    env = {key: os.environ[key] for key in ['PATH', 'HOME', 'LANG'] if key in os.environ}
    env['LD_LIBRARY_PATH'] = str(PG.parent / 'lib')
    pgport, redisport = free_port(), free_port()
    while redisport == pgport:
        redisport = free_port()
    passwords = {key: secrets.token_hex(32) for key in ['admin', 'app', 'migrator', 'maintenance', 'redis', 'jwt', 'otp']}
    pwfile = work / 'admin-password'
    pwfile.write_text(passwords['admin']); pwfile.chmod(0o600)
    data = work / 'pgdata'
    socket_dir = work / 'socket'; socket_dir.mkdir(mode=0o700)
    log_path = work / 'private-startup.log'
    log_path.touch(mode=0o600)
    log = log_path.open('a')
    children = []
    mail = None
    def command(args, selected_env):
        result = subprocess.run(args, cwd=ROOT / 'backend', env=selected_env, stdout=log, stderr=log, timeout=180)
        if result.returncode:
            raise RuntimeError('Owned pilot bootstrap command refused; private diagnostics retained locally')
    def sql(query, selected_env):
        return subprocess.check_output([str(CLIENT / 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', query], env=selected_env, stderr=log).decode().strip()
    def stop(_signal, _frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        command([str(PG / 'initdb'), '-D', str(data), '-U', 'postgres', '--pwfile', str(pwfile), '--auth-host=scram-sha-256', '--auth-local=scram-sha-256', '--encoding=UTF8', '--locale=C'], env)
        pg = subprocess.Popen([str(PG / 'postgres'), '-D', str(data), '-h', '127.0.0.1', '-p', str(pgport), '-k', str(socket_dir), '-c', 'log_min_error_statement=panic', '-c', 'log_parameter_max_length_on_error=0'], env=env, stdout=log, stderr=log)
        children.append(pg)
        redis_conf = work / 'redis.conf'
        redis_conf.write_text(f'bind 127.0.0.1\nport {redisport}\nprotected-mode yes\nrequirepass {passwords["redis"]}\ndir {work}\nsave ""\nappendonly no\n')
        redis_conf.chmod(0o600)
        redis = subprocess.Popen([str(REDIS / 'redis-server'), str(redis_conf)], env=env, stdout=log, stderr=log)
        children.append(redis)
        admin_env = {**env, 'PGHOST': '127.0.0.1', 'PGPORT': str(pgport), 'PGUSER': 'postgres', 'PGPASSWORD': passwords['admin'], 'PGDATABASE': 'postgres', 'PGCONNECT_TIMEOUT': '2'}
        for _ in range(100):
            if pg.poll() is not None or redis.poll() is not None:
                raise RuntimeError('Owned service exited before readiness')
            if subprocess.run([str(CLIENT / 'pg_isready'), '-q'], env=admin_env, stdout=log, stderr=log).returncode == 0:
                break
            time.sleep(0.1)
        else:
            raise RuntimeError('Owned PostgreSQL readiness deadline')
        assert sql('SHOW data_directory; SHOW listen_addresses;', admin_env) == str(data) + '\n127.0.0.1'
        assert int((data / 'postmaster.pid').read_text().splitlines()[0]) == pg.pid
        info = subprocess.check_output([str(REDIS / 'redis-cli'), '-h', '127.0.0.1', '-p', str(redisport), 'INFO', 'server'], env={**env, 'REDISCLI_AUTH': passwords['redis']}, stderr=log).decode()
        assert f'process_id:{redis.pid}' in info
        db = 'lifestyle_test_pilot_' + secrets.token_hex(6)
        sql('CREATE DATABASE ' + db, admin_env)
        admin_env['PGDATABASE'] = db
        boot_env = {**admin_env, 'LIFESTYLE_FRESH_BOOTSTRAP': 'fresh-local-or-ci-only', **{f'LIFESTYLE_{role.upper()}_PASSWORD': passwords[role] for role in ['app', 'migrator', 'maintenance']}}
        command([str(CLIENT / 'psql'), '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', str(ROOT / 'backend/src/infrastructure/database/postgres/init-roles.sql')], boot_env)
        migration_env = {**env, 'DATABASE_MIGRATION_URL': f'postgresql://lifestyle_migrator:{passwords["migrator"]}@127.0.0.1:{pgport}/{db}'}
        command(['npm', 'run', 'migrate:up'], migration_env)
        # Refuse real provider delivery: no email body is accepted, queued or logged.
        class RejectMail(socketserver.BaseRequestHandler):
            def handle(self):
                self.request.sendall(b'421 Temporary pilot has no email provider\r\n')
        mail = socketserver.ThreadingTCPServer(('127.0.0.1', 0), RejectMail)
        mail.daemon_threads = True
        threading.Thread(target=mail.serve_forever, daemon=True).start()
        api_env = {**env, 'NODE_ENV': 'development', 'PORT': '8787', 'LOG_LEVEL': 'silent', 'TRUST_PROXY_HOPS': '1', 'DATABASE_SSL': 'false', 'DATABASE_URL': f'postgresql://lifestyle_app:{passwords["app"]}@127.0.0.1:{pgport}/{db}', 'REDIS_URL': f'redis://:{passwords["redis"]}@127.0.0.1:{redisport}/15', 'JWT_ACCESS_SECRET': passwords['jwt'], 'OTP_HMAC_SECRET': passwords['otp'], 'EMAIL_HOST': '127.0.0.1', 'EMAIL_PORT': str(mail.server_address[1]), 'EMAIL_USER': '', 'EMAIL_PASSWORD': '', 'EMAIL_FROM': 'no-reply@example.invalid'}
        launcher = work / 'api.mjs'
        launcher.write_text('''import http from 'node:http';
const { createApp } = await import(''' + json.dumps((ROOT / 'backend/dist/app.js').as_uri()) + ''');
const app = createApp();
const server = http.createServer((req, res) => {
  if (req.url === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><title>LifeStyle temporary test API</title><h1>LifeStyle Validation</h1><p>Temporary isolated test API. Use synthetic data and a unique test password only. No production data, email delivery, AI, push or durability guarantee.</p><p><a href="/health/ready">Actual database and Redis readiness</a></p>');
  } else { app(req, res); }
});
server.listen(8787, '0.0.0.0');
process.on('SIGTERM', () => server.close(() => process.exit(0)));
''')
        launcher.chmod(0o600)
        api = subprocess.Popen(['node', str(launcher)], cwd=ROOT / 'backend', env=api_env, stdout=log, stderr=log)
        children.append(api)
        for _ in range(100):
            if api.poll() is not None:
                raise RuntimeError('Actual API refused startup')
            try:
                with urllib.request.urlopen('http://127.0.0.1:8787/health/ready', timeout=2) as response:
                    if response.status == 200 and json.load(response) == {'status': 'ok'}:
                        break
            except Exception:
                time.sleep(0.1)
        else:
            raise RuntimeError('API readiness deadline')
        report = dict(result='PASS', scope='Actual owned PostgreSQL16/Redis7/bootstrap/forward migrations and real API readiness only; NOT phone, public HTTPS, SMTP, image or release certification.', runtime='temporary; may stop with sandbox/session; synthetic data only', api_port=8787, ownership='Fresh private cluster, exact PG data directory/PID and Redis PID checked before bootstrap. Loopback authenticated DB/cache; API receives runtime identity only.', mail='BLOCKED: explicit local SMTP rejection, never fake delivered; no email body accepted/stored', worker='NOT RUN: no retention/purge/background worker', public_api_url=f'https://8787-{os.environ["E2B_SANDBOX_ID"]}.e2b.app/api/v1')
        REPORT.write_text(json.dumps(report, indent=2) + '\n')
        print('PASS: owned PostgreSQL/Redis identity, fresh bootstrap, forward migrations and actual API readiness.', flush=True)
        print('PILOT_READY: API 0.0.0.0:8787; DB/cache loopback authenticated. Synthetic data only. SMTP BLOCKED.', flush=True)
        while all(child.poll() is None for child in children):
            time.sleep(2)
        raise RuntimeError('An owned pilot process exited')
    finally:
        for child in reversed(children):
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    child.kill(); child.wait(timeout=5)
        if mail:
            mail.shutdown(); mail.server_close()
        log.close()
        if REPORT.exists():
            report = json.loads(REPORT.read_text()); report['result'] = 'BLOCKED'; report['runtime'] = 'stopped; no live availability claim'; REPORT.write_text(json.dumps(report, indent=2) + '\n')
        # Retain only this newly owned private directory; never delete user data.
        print('Owned pilot children stopped. Private pilot directory retained; no other resources changed.', flush=True)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception:
        print('FAIL: pilot prerequisite/startup/ownership check refused; no success inferred or private diagnostics emitted.', flush=True)
        raise SystemExit(1)
