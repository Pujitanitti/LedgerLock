import { RedisDecisionCache } from './redis-decision-cache';

function makeRedis(overrides: Partial<{ get: jest.Mock; set: jest.Mock }> = {}) {
  return {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
    ...overrides,
  };
}

describe('RedisDecisionCache.get', () => {
  it('returns the parsed decision on a cache hit', async () => {
    const redis = makeRedis({
      get: jest.fn().mockResolvedValue(JSON.stringify({ allowed: true, reason: 'role_permission' })),
    });
    const cache = new RedisDecisionCache(redis as never);

    const result = await cache.get('some-key');

    expect(result).toEqual({ allowed: true, reason: 'role_permission' });
  });

  it('returns null on a genuine cache miss (Redis returns null)', async () => {
    const redis = makeRedis({ get: jest.fn().mockResolvedValue(null) });
    const cache = new RedisDecisionCache(redis as never);

    await expect(cache.get('some-key')).resolves.toBeNull();
  });

  it('FAIL-SAFE: returns null (never throws) when Redis GET rejects (connection failure)', async () => {
    const redis = makeRedis({ get: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) });
    const cache = new RedisDecisionCache(redis as never);

    await expect(cache.get('some-key')).resolves.toBeNull();
  });

  it('FAIL-SAFE: returns null (never throws) when Redis GET times out', async () => {
    const redis = makeRedis({ get: jest.fn().mockRejectedValue(new Error('Command timed out')) });
    const cache = new RedisDecisionCache(redis as never);

    await expect(cache.get('some-key')).resolves.toBeNull();
  });

  it('FAIL-SAFE: returns null for non-JSON garbage in the cache', async () => {
    const redis = makeRedis({ get: jest.fn().mockResolvedValue('not-json-at-all{{{') });
    const cache = new RedisDecisionCache(redis as never);

    await expect(cache.get('some-key')).resolves.toBeNull();
  });

  it('FAIL-SAFE: returns null for well-formed JSON that is not a valid CachedDecision shape', async () => {
    const redis = makeRedis({ get: jest.fn().mockResolvedValue(JSON.stringify({ foo: 'bar' })) });
    const cache = new RedisDecisionCache(redis as never);

    await expect(cache.get('some-key')).resolves.toBeNull();
  });

  it('SECURITY: a malformed entry never becomes an accidental allow', async () => {
    const redis = makeRedis({
      get: jest.fn().mockResolvedValue(JSON.stringify({ allowed: true, reason: 'totally_made_up_reason' })),
    });
    const cache = new RedisDecisionCache(redis as never);

    await expect(cache.get('some-key')).resolves.toBeNull();
  });
});

describe('RedisDecisionCache.set', () => {
  it('writes the decision with the given TTL', async () => {
    const redis = makeRedis();
    const cache = new RedisDecisionCache(redis as never);

    await cache.set('some-key', { allowed: true, reason: 'role_permission' }, 60);

    expect(redis.set).toHaveBeenCalledWith(
      'some-key',
      JSON.stringify({ allowed: true, reason: 'role_permission' }),
      'EX',
      60,
    );
  });

  it('FAIL-SAFE: never throws when Redis SET rejects', async () => {
    const redis = makeRedis({ set: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) });
    const cache = new RedisDecisionCache(redis as never);

    await expect(
      cache.set('some-key', { allowed: true, reason: 'role_permission' }, 60),
    ).resolves.toBeUndefined();
  });
});
