-- ==============================================================================
-- src/infrastructure/database/postgres/init-roles.sql
-- 
-- Implements Section 6.11: Database Roles (Least Privilege Architecture).
-- 
-- This script must be executed by the postgres superuser during cluster init.
-- ==============================================================================

-- 1. Create Migration Role (DDL Owner)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'lifestyle_migrator') THEN
    CREATE ROLE lifestyle_migrator WITH LOGIN PASSWORD 'migrator_local_pass';
  END IF;
END $$;

-- 2. Create Application Runtime Role (DML Only, No DDL)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'lifestyle_app') THEN
    CREATE ROLE lifestyle_app WITH LOGIN PASSWORD 'app_local_pass';
  END IF;
END $$;

-- 3. Create Maintenance / Purge Role (Dedicated connection for retention deletions)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'lifestyle_maintenance') THEN
    CREATE ROLE lifestyle_maintenance WITH LOGIN PASSWORD 'maintenance_local_pass';
  END IF;
END $$;

-- Grant database connection permissions
GRANT CONNECT, CREATE ON DATABASE lifestyle_dev TO lifestyle_migrator;
GRANT CONNECT ON DATABASE lifestyle_dev TO lifestyle_app;
GRANT CONNECT ON DATABASE lifestyle_dev TO lifestyle_maintenance;

-- Migrator owns database and schema public
ALTER DATABASE lifestyle_dev OWNER TO lifestyle_migrator;
ALTER SCHEMA public OWNER TO lifestyle_migrator;
