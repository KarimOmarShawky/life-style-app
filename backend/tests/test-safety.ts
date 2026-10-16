/** Run only against disposable resources explicitly acknowledged by the operator. */
export function assertTestTargets(env: Record<string, string | undefined>): void {
  if (env.ALLOW_DESTRUCTIVE_TESTS !== 'isolated-resources-only') {
    throw new Error('Destructive tests require ALLOW_DESTRUCTIVE_TESTS=isolated-resources-only');
  }
  const db = new URL(env.DATABASE_URL ?? 'invalid:');
  const redis = new URL(env.REDIS_URL ?? 'invalid:');
  if (
    !['postgres:', 'postgresql:'].includes(db.protocol) ||
    !/^\/lifestyle_test(?:_[a-z0-9_]+)?$/.test(db.pathname) ||
    !['redis:', 'rediss:'].includes(redis.protocol) ||
    !/^\/(?:[1-9]|1[0-5])$/.test(redis.pathname)
  ) {
    throw new Error(
      'Tests require a lifestyle_test database and dedicated nonzero Redis database (1-15)'
    );
  }
}
