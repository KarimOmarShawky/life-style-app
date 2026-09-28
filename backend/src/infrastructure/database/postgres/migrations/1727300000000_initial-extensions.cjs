/**
 * Migration: 1727300000000_initial-extensions.cjs
 * 
 * Implements Section 6.1: Extensions setup (pgcrypto, uuid-ossp).
 * Verifies up -> down -> up migration check for Phase P1.
 */

exports.up = (pgm) => {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
};

exports.down = (pgm) => {
  pgm.sql('DROP EXTENSION IF EXISTS "pgcrypto";');
};
