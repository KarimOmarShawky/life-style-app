-- Fresh local/isolated-CI bootstrap ONLY; not an upgrade or password rotation.
-- PostgreSQL/psql 16. Credentials must be supplied in the process environment.
-- No fallback passwords. Existing roles or user objects cause a transaction abort.
\set ON_ERROR_STOP on
\getenv app_password LIFESTYLE_APP_PASSWORD
\getenv migrator_password LIFESTYLE_MIGRATOR_PASSWORD
\getenv maintenance_password LIFESTYLE_MAINTENANCE_PASSWORD
\getenv bootstrap_ack LIFESTYLE_FRESH_BOOTSTRAP

-- Fail before interpolating any credential if an environment variable is absent.
\if :{?app_password}
\else
DO $guard$ BEGIN RAISE EXCEPTION 'Required fresh-bootstrap environment is missing'; END; $guard$;
\endif
\if :{?migrator_password}
\else
DO $guard$ BEGIN RAISE EXCEPTION 'Required fresh-bootstrap environment is missing'; END; $guard$;
\endif
\if :{?maintenance_password}
\else
DO $guard$ BEGIN RAISE EXCEPTION 'Required fresh-bootstrap environment is missing'; END; $guard$;
\endif
\if :{?bootstrap_ack}
\else
DO $guard$ BEGIN RAISE EXCEPTION 'Required fresh-bootstrap environment is missing'; END; $guard$;
\endif

BEGIN;
-- gset consumes results instead of echoing values to bootstrap logs.
SELECT set_config('lifestyle.fresh_bootstrap', :'bootstrap_ack', true) AS bootstrap_ack_set,
       set_config('lifestyle.credentials_present',
         ((length(:'app_password') > 0) AND (length(:'migrator_password') > 0)
          AND (length(:'maintenance_password') > 0))::text, true) AS credentials_present_set
\gset

DO $body$
BEGIN
  IF current_setting('lifestyle.fresh_bootstrap', true) IS DISTINCT FROM 'fresh-local-or-ci-only'
     OR current_setting('lifestyle.credentials_present', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Fresh bootstrap acknowledgement and nonempty credentials are required';
  END IF;
  IF current_database() <> 'lifestyle_dev' AND current_database() !~ '^lifestyle_test(_[a-z0-9_]+)?$' THEN
    RAISE EXCEPTION 'Bootstrap is restricted to local development or isolated test database names';
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname IN
      ('lifestyle_app', 'lifestyle_migrator', 'lifestyle_maintenance')) THEN
    RAISE EXCEPTION 'Existing application roles found; bootstrap refuses changes or rotation';
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_namespace n
      ON d.refclassid = 'pg_catalog.pg_namespace'::regclass AND d.refobjid = n.oid
      WHERE n.nspname = 'public')
     OR EXISTS (SELECT FROM pg_catalog.pg_namespace
      WHERE nspname <> 'public' AND nspname <> 'information_schema' AND nspname !~ '^pg_') THEN
    RAISE EXCEPTION 'Existing public objects found or non-default schemas present; bootstrap requires a fresh database';
  END IF;
END;
$body$;

CREATE ROLE lifestyle_migrator WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
  PASSWORD :'migrator_password';
CREATE ROLE lifestyle_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
  PASSWORD :'app_password';
CREATE ROLE lifestyle_maintenance WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
  PASSWORD :'maintenance_password';

DO $body$
BEGIN
  EXECUTE format('GRANT CONNECT, CREATE ON DATABASE %I TO lifestyle_migrator', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO lifestyle_app, lifestyle_maintenance', current_database());
  EXECUTE format('ALTER DATABASE %I OWNER TO lifestyle_migrator', current_database());
END;
$body$;
ALTER SCHEMA public OWNER TO lifestyle_migrator;
COMMIT;
