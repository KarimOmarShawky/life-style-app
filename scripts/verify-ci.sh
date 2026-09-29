#!/usr/bin/env bash
set -euo pipefail

echo "=========================================="
echo " LifeStyle App CI Full Verification Suite "
echo "=========================================="

echo "1. Checking forbidden dependencies (ADR-039)..."
node scripts/check-forbidden.mjs

echo "2. Checking code formatting..."
cd backend
npm run format:check

echo "3. Running linter..."
npm run lint

echo "4. Running TypeScript build..."
npm run build

echo "5. Running all tests with coverage..."
npm run test:coverage

echo "6. Testing DB migrations reversibility (down then up)..."
export DATABASE_MIGRATION_URL="postgresql://lifestyle_migrator:migrator_local_pass@localhost:5432/lifestyle_dev"
npm run migrate:down
npm run migrate:up

echo "=========================================="
echo " ✅ ALL GATES PASSED CLEANLY"
echo "=========================================="
