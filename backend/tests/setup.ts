/** Unit defaults are inert; integration/security targets require explicit isolation. */
import { assertTestTargets } from './test-safety.js';

import { expect } from 'vitest';
const infrastructure = !expect.getState().testPath?.replaceAll('\\', '/').includes('/tests/unit/');
if (infrastructure) assertTestTargets(process.env);
process.env.NODE_ENV = 'test';
process.env.PORT = '3000';
if (!infrastructure) process.env.DATABASE_URL = 'postgresql://unit:unit@127.0.0.1:1/lifestyle_test';
if (!infrastructure) process.env.REDIS_URL = 'redis://127.0.0.1:1/15';
process.env.JWT_ACCESS_SECRET ??= 'test-secret-at-least-32-characters-long-for-hs256';
process.env.OTP_HMAC_SECRET ??= 'test-otp-secret-at-least-32-characters-long';
process.env.LOG_LEVEL = 'silent';
