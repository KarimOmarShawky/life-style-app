/**
 * Redaction paths for the structured logger.
 *
 * Spec section 26 forbids logging passwords, tokens, secrets, cookies, database
 * credentials, API keys, OTP values and sensitive personal data.
 *
 * This list is deny-by-path rather than deny-by-inspection because Pino applies
 * it at serialization time with no runtime cost per field. The trade-off: a
 * secret placed at an unlisted path still gets logged. That is why services log
 * explicit fields rather than whole request or entity objects, and why new
 * sensitive fields must be added here in the same commit that introduces them.
 */

/** Field names that must never appear in a log line, at any nesting level. */
const SENSITIVE_FIELDS = [
  'password',
  'newPassword',
  'currentPassword',
  'confirmPassword',
  'plainPassword',
  'passwordHash',
  'password_hash',
  'token',
  'accessToken',
  'refreshToken',
  'access_token',
  'refresh_token',
  'idToken',
  'jwt',
  'secret',
  'clientSecret',
  'apiKey',
  'api_key',
  'authorization',
  'cookie',
  'setCookie',
  'otp',
  'otpCode',
  'verificationCode',
  'resetToken',
  'sessionId',
  'creditCard',
  'cardNumber',
  'cvv',
  'ssn',
] as const;

/** Object paths Pino should scrub, expressed against the log record shape. */
const CONTAINERS = [
  'req.body',
  'req.query',
  'req.params',
  'req.headers',
  'res.headers',
  'body',
  'query',
  'params',
  'headers',
  'user',
  'data',
  'payload',
  'metadata',
  'context',
  'err.metadata',
  'error.metadata',
] as const;

function buildPaths(): string[] {
  const paths = new Set<string>();

  // Headers carry credentials under well-known names.
  paths.add('req.headers.authorization');
  paths.add('req.headers.cookie');
  paths.add('req.headers["set-cookie"]');
  paths.add('req.headers["x-api-key"]');
  paths.add('res.headers["set-cookie"]');
  paths.add('headers.authorization');
  paths.add('headers.cookie');

  for (const field of SENSITIVE_FIELDS) {
    paths.add(field);
    paths.add(`*.${field}`);
    for (const container of CONTAINERS) {
      paths.add(`${container}.${field}`);
      paths.add(`${container}.*.${field}`);
    }
  }

  return [...paths];
}

export const REDACTION_PATHS: readonly string[] = buildPaths();

export const REDACTION_CENSOR = '[REDACTED]';

/**
 * Connection strings embed credentials, so they are masked before they reach a
 * log line or a startup message.
 *
 * `postgres://user:s3cret@host:5432/db` becomes `postgres://user:***@host:5432/db`.
 * Returns a fixed placeholder when the value cannot be parsed, so a malformed
 * URI is never echoed verbatim on the chance that it still contains a password.
 */
export function maskConnectionString(value: string | undefined): string {
  if (!value) {
    return '(not configured)';
  }

  try {
    const url = new URL(value);
    if (url.password) {
      url.password = '***';
    }
    return url.toString();
  } catch {
    return '(unparseable connection string)';
  }
}
