#!/usr/bin/env python3
"""Real PostgreSQL/Redis tests in a NEW owned cluster only; never adopt env URLs.
External scratch tools are not application dependencies. No Docker parity claim.
"""
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import socketserver
import threading
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
PG = Path(os.environ.get('DISPOSABLE_PG_HOME', '/home/user/runtime-tools/node_modules/@embedded-postgres/linux-x64/native'))
CLIENT = Path(os.environ.get('DISPOSABLE_PSQL_HOME', '/home/user/.venv/lib/python3.11/site-packages/pgserver/pginstall/bin'))
REDIS = Path(os.environ.get('DISPOSABLE_REDIS_HOME', '/home/user/runtime-tools/redis-7.4.6/src'))
EVIDENCE = ROOT / 'docs/remediation/evidence/C32.txt'
RESULT = ROOT / 'docs/remediation/disposable-results.json'
checks = []
log = []
private_values = []


def emit(text):
    for value in private_values:
        text = text.replace(value, '[private ephemeral value]')
    log.append(text)
    print(text, flush=True)


def command(name, args, env, *, expected_failure=None, cwd=ROOT, timeout=180):
    emit('$ ' + name)  # Deliberately not argv/env: credentials are never printed.
    process = subprocess.Popen(args, cwd=cwd, env=env, text=True, stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT, start_new_session=True)
    try:
        output, _ = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        output, _ = process.communicate()
        emit(output)
        raise RuntimeError(name + ' timed out')
    emit(output)
    passed = process.returncode == 0 if expected_failure is None else (
        process.returncode != 0 and expected_failure in output)
    checks.append(dict(name=name, result='PASS' if passed else 'FAIL', exit_code=process.returncode))
    emit(f'{checks[-1]["result"]}: {name} (exit {process.returncode})')
    if not passed:
        raise RuntimeError(name + ' did not meet its asserted outcome')
    return output


def free_port():
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        return probe.getsockname()[1]


def main():
    required = [PG / 'bin/initdb', PG / 'bin/postgres', CLIENT / 'psql', CLIENT / 'pg_isready',
                REDIS / 'redis-server', REDIS / 'redis-cli', ROOT / 'backend/node_modules/.bin/vitest']
    if any(not p.is_file() for p in required):
        emit('BLOCKED: external PostgreSQL/psql/Redis or backend test tools unavailable; no suite executed')
        return 'BLOCKED'
    for name, binary in [('Scratch PostgreSQL version', PG / 'bin/postgres'), ('psql client version', CLIENT / 'psql'), ('Scratch Redis version', REDIS / 'redis-server')]:
        command(name, [str(binary), '--version'], {**os.environ, 'LD_LIBRARY_PATH': str(PG / 'lib')})
    if any((ROOT / p).exists() for p in ['.env', 'backend/.env']):
        emit('BLOCKED: private dotenv configuration exists; refusing possible provider/config adoption. Preserve it; use a reviewed clean test checkout.')
        return 'BLOCKED'
    # No inherited connection target/configuration may select an existing service.
    env = {k: v for k, v in os.environ.items() if not k.startswith(('DATABASE_', 'PG', 'REDIS', 'EMAIL_', 'SMS_FALLBACK_', 'FCM_'))}
    env.update(NODE_ENV='test', LOG_LEVEL='silent', DATABASE_SSL='false',
               JWT_ACCESS_SECRET=secrets.token_hex(32), OTP_HMAC_SECRET=secrets.token_hex(32),
               LD_LIBRARY_PATH=str(PG / 'lib'), EMAIL_HOST='127.0.0.1', EMAIL_USER='', EMAIL_PASSWORD='',
               EMAIL_FROM='no-reply@example.invalid', BCRYPT_COST='12')
    admin, app, migrator, maintenance, redis_password = [secrets.token_hex(32) for _ in range(5)]
    private_values.extend([admin, app, migrator, maintenance, redis_password,
                           env['JWT_ACCESS_SECRET'], env['OTP_HMAC_SECRET']])
    with tempfile.TemporaryDirectory(prefix='lifestyle-owned-runtime-') as temporary:
        scratch = Path(temporary); scratch.chmod(0o700)
        data = scratch / 'pgdata'; sock = scratch / 'socket'; sock.mkdir()
        password_file = scratch / 'admin-password'; password_file.write_text(admin); password_file.chmod(0o600)
        pgport, redisport = free_port(), free_port()
        while redisport == pgport:
            redisport = free_port()
        db = 'lifestyle_test_' + secrets.token_hex(6)
        env.update(PGHOST='127.0.0.1', PGPORT=str(pgport), PGUSER='postgres', PGPASSWORD=admin,
                   PGDATABASE='postgres', PGCONNECT_TIMEOUT='3', REDISCLI_AUTH=redis_password)
        command('initdb NEW private owned directory (SCRAM host authentication)',
                [str(PG / 'bin/initdb'), '-D', str(data), '-U', 'postgres', '--pwfile', str(password_file),
                 '--auth-host=scram-sha-256', '--auth-local=scram-sha-256', '--encoding=UTF8', '--locale=C'], env)
        conf = scratch / 'redis.conf'
        conf.write_text(f'bind 127.0.0.1\nport {redisport}\nprotected-mode yes\nrequirepass {redis_password}\n'
                        f'dir {scratch}\nsave ""\nappendonly no\ndatabases 16\n')
        conf.chmod(0o600)
        pglog = (scratch / 'postgres.log').open('w+')
        redislog = (scratch / 'redis.log').open('w+')
        pgproc = subprocess.Popen([str(PG / 'bin/postgres'), '-D', str(data), '-h', '127.0.0.1',
                                   '-p', str(pgport), '-k', str(sock)], env=env, stdout=pglog,
                                  stderr=subprocess.STDOUT, start_new_session=True)
        redisproc = subprocess.Popen([str(REDIS / 'redis-server'), str(conf)], env=env,
                                     stdout=redislog, stderr=subprocess.STDOUT, start_new_session=True)
        class RejectMail(socketserver.BaseRequestHandler):
            def handle(self):
                self.request.sendall(b'421 Owned test fixture refuses mail delivery\r\n')
        mail = socketserver.ThreadingTCPServer(('127.0.0.1', 0), RejectMail)
        mail.daemon_threads = True
        env['EMAIL_PORT'] = str(mail.server_address[1])
        mail_thread = threading.Thread(target=mail.serve_forever, daemon=True)
        mail_thread.start()
        emit('Owned loopback SMTP rejection fixture; no provider success/delivery claimed.')
        try:
            # Bounded protocol readiness inside the harness, not an external-service assumption.
            for _ in range(100):
                if pgproc.poll() is not None or redisproc.poll() is not None:
                    pglog.seek(0); redislog.seek(0); emit(pglog.read() + redislog.read())
                    raise RuntimeError('Owned database process failed before readiness')
                probe = subprocess.run([str(CLIENT / 'pg_isready'), '-q'], env=env, timeout=5)
                if probe.returncode == 0:
                    break
                time.sleep(0.1)
            else:
                raise RuntimeError('Owned PostgreSQL readiness deadline exceeded')
            psql = [str(CLIENT / 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']
            def sql(name, query, selected_env=None, expected_failure=None):
                return command(name, psql + ['-c', query], selected_env or env,
                               expected_failure=expected_failure)
            observed = sql('OWNERSHIP proof: PostgreSQL data directory and loopback binding',
                           'SHOW data_directory; SHOW listen_addresses; SELECT current_user;')
            assert observed.strip().splitlines() == [str(data), '127.0.0.1', 'postgres']
            assert int((data / 'postmaster.pid').read_text().splitlines()[0]) == pgproc.pid
            info = command('OWNERSHIP proof: Redis child PID, dedicated authenticated instance',
                           [str(REDIS / 'redis-cli'), '-h', '127.0.0.1', '-p', str(redisport), '--raw', 'INFO', 'server'], env)
            assert f'process_id:{redisproc.pid}' in info
            emit('PASS: services are this harness\'s own fresh process/data directory; external URLs ignored. Destructive suite hooks reviewed separately.')
            sql('Create uniquely named owned disposable database', f'CREATE DATABASE {db}')
            env['PGDATABASE'] = db
            env.update(LIFESTYLE_APP_PASSWORD=app, LIFESTYLE_MIGRATOR_PASSWORD=migrator,
                       LIFESTYLE_MAINTENANCE_PASSWORD=maintenance, LIFESTYLE_FRESH_BOOTSTRAP='fresh-local-or-ci-only')
            bootstrap = psql + ['-f', str(ROOT / 'backend/src/infrastructure/database/postgres/init-roles.sql')]
            command('Actual psql fresh-role bootstrap script', bootstrap, env)
            command('Actual psql repeat bootstrap MUST refuse existing roles', bootstrap, env,
                    expected_failure='Existing application roles found')
            env.update(DATABASE_URL=f'postgresql://lifestyle_app:{app}@127.0.0.1:{pgport}/{db}',
                       DATABASE_MIGRATION_URL=f'postgresql://lifestyle_migrator:{migrator}@127.0.0.1:{pgport}/{db}',
                       DATABASE_MAINTENANCE_URL=f'postgresql://lifestyle_maintenance:{maintenance}@127.0.0.1:{pgport}/{db}',
                       REDIS_URL=f'redis://:{redis_password}@127.0.0.1:{redisport}/15',
                       ALLOW_DESTRUCTIVE_TESTS='isolated-resources-only')
            command('Actual fresh forward migrations (migration identity)', ['npm', 'run', 'migrate:up'], env, cwd=ROOT / 'backend')
            history = sql('Migration history before repeat', 'SELECT count(*) FROM pgmigrations')
            command('Actual repeat forward migrations', ['npm', 'run', 'migrate:up'], env, cwd=ROOT / 'backend')
            assert sql('Migration history stable after repeat', 'SELECT count(*) FROM pgmigrations') == history
            appenv = {**env, 'PGUSER': 'lifestyle_app', 'PGPASSWORD': app}
            assert sql('Runtime role least privilege', "SELECT current_user, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname=current_user", appenv).strip() == 'lifestyle_app|f|f|f'
            sql('Runtime role DDL MUST fail', 'CREATE TABLE public.unapproved_runtime_ddl (id int)', appenv,
                expected_failure='permission denied')
            sql('Owned populated fixture before repeat', "INSERT INTO users (email,password_hash,display_name,default_currency) VALUES ('owned-migration-fixture@example.invalid','nonusable','Fixture','USD')", appenv)
            command('Actual populated forward repeat (no rollback)', ['npm', 'run', 'migrate:up'], env, cwd=ROOT / 'backend')
            assert sql('Populated fixture preserved', "SELECT count(*) FROM users WHERE email='owned-migration-fixture@example.invalid'", appenv).strip() == '1'
            failures = scratch / 'migrations'; shutil.copytree(ROOT / 'backend/src/infrastructure/database/postgres/migrations', failures)
            (failures / '1999999999999_owned_failure.cjs').write_text("exports.up = pgm => pgm.sql('CREATE TABLE owned_failure_probe(id int); SELECT owned_intentional_missing_function();');\n")
            command('Intentional failed migration MUST rollback (owned temporary migration copy)',
                    ['node', 'node_modules/node-pg-migrate/bin/node-pg-migrate.js', '-m', str(failures), '-d', 'DATABASE_MIGRATION_URL', 'up'],
                    env, cwd=ROOT / 'backend', expected_failure='owned_intentional_missing_function')
            assert sql('Failed migration leaves no partial table/history', "SELECT to_regclass('public.owned_failure_probe') IS NULL; SELECT count(*) FROM pgmigrations").strip() == 't\n' + history.strip()
            assert sql('Failed migration preserves populated fixture', "SELECT count(*) FROM users WHERE email='owned-migration-fixture@example.invalid'", appenv).strip() == '1'
            for suite in ['integration', 'security']:
                assert pgproc.poll() is None and redisproc.poll() is None
                command(f'Actual {suite} suite on OWNED PostgreSQL/Redis', ['npm', 'run', 'test:' + suite],
                        env, cwd=ROOT / 'backend', timeout=300)
            return 'PASS'
        finally:
            mail.shutdown(); mail.server_close(); mail_thread.join(timeout=5)
            for process in [redisproc, pgproc]:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL); process.wait(timeout=10)
            pglog.close(); redislog.close()
            emit('Owned PostgreSQL/Redis child processes stopped; only this harness temporary directory is removed.')


if __name__ == '__main__':
    outcome = 'FAIL'
    try:
        outcome = main()
    except Exception as error:
        emit('FAIL: ' + str(error))
    finally:
        EVIDENCE.write_text('\n'.join(log) + '\n')
        RESULT.write_text(json.dumps(dict(result=outcome, checks=checks,
            scope='Actual owned scratch PostgreSQL/Redis only; no Docker/deployed schema/Flutter/device/SMTP verification'), indent=2) + '\n')
    raise SystemExit(0 if outcome == 'PASS' else 2 if outcome == 'BLOCKED' else 1)
