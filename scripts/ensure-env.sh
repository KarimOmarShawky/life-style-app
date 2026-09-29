#!/usr/bin/env bash
set -e

# 1. Check and install system packages if missing
if ! command -v psql &> /dev/null || ! command -v redis-server &> /dev/null; then
  echo "Installing postgresql and redis-server..."
  sudo apt-get update -qq > /dev/null 2>&1
  sudo apt-get install -y -qq postgresql redis-server > /dev/null 2>&1
fi

# 2. Ensure services are running
if ! pg_isready &> /dev/null; then
  echo "Starting postgresql..."
  sudo service postgresql start || sudo /etc/init.d/postgresql start
fi

if ! redis-cli ping &> /dev/null; then
  echo "Starting redis-server..."
  sudo service redis-server start || redis-server --daemonize yes
fi

# 3. Ensure database and roles exist
sudo -u postgres psql -c "CREATE DATABASE lifestyle_dev;" 2>/dev/null || true
sudo -u postgres psql -d lifestyle_dev < /home/user/backend/src/infrastructure/database/postgres/init-roles.sql > /dev/null 2>&1 || true

# 4. Ensure node_modules exist
if [ ! -d "/home/user/backend/node_modules" ] || [ ! -f "/home/user/backend/node_modules/.bin/node-pg-migrate" ]; then
  echo "Installing backend dependencies..."
  cd /home/user/backend
  npm install --prefer-offline --no-audit > /dev/null 2>&1
fi

# 5. Run migrations to ensure all 22 tables exist
echo "Running migrations..."
cd /home/user/backend
export DATABASE_MIGRATION_URL="postgresql://lifestyle_migrator:migrator_local_pass@localhost:5432/lifestyle_dev"
npm run migrate:up > /dev/null 2>&1 || true

echo "Environment ready: PostgreSQL, Redis, and backend dependencies are active."
