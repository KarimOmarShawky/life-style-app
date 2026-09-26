/**
 * tests/setup.ts
 *
 * Configures default environment variables for test execution.
 */

process.env.NODE_ENV = 'test';
process.env.PORT = '3000';
process.env.DATABASE_URL = 'postgresql://lifestyle_app:app_local_pass@localhost:5432/lifestyle_dev';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.JWT_ACCESS_SECRET = 'test-secret-at-least-32-characters-long-for-hs256';
process.env.OTP_HMAC_SECRET = 'test-otp-secret-at-least-32-characters-long';
process.env.LOG_LEVEL = 'silent';
