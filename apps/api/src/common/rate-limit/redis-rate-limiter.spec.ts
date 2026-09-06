import { RedisRateLimiter } from './redis-rate-limiter';

function makeRedis(overrides: Partial<{ incr: jest.Mock; expire: jest.Mock; ttl: jest.Mock }> = {}) {
  return {
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    ttl: jest.fn().mockResolvedValue(60),
    ...overrides,
  };
}

describe('RedisRateLimiter.consume', () => {
  it('allows the first request in a window and sets the expiry', async () => {
    const redis = makeRedis({ incr: jest.fn().mockResolvedValue(1) });
    const limiter = new RedisRateLimiter(redis as never);

    const result = await limiter.consume('key', 5, 60);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(redis.expire).toHaveBeenCalledWith('key', 60);
  });

  it('does not re-set the expiry on subsequent requests within the same window', async () => {
    const redis = makeRedis({ incr: jest.fn().mockResolvedValue(3) });
    const limiter = new RedisRateLimiter(redis as never);

    await limiter.consume('key', 5, 60);

    expect(redis.expire).not.toHaveBeenCalled();
  });

  it('allows requests up to and including the limit', async () => {
    const redis = makeRedis({ incr: jest.fn().mockResolvedValue(5) });
    const limiter = new RedisRateLimiter(redis as never);

    const result = await limiter.consume('key', 5, 60);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it('rejects a request that exceeds the limit', async () => {
    const redis = makeRedis({ incr: jest.fn().mockResolvedValue(6) });
    const limiter = new RedisRateLimiter(redis as never);

    const result = await limiter.consume('key', 5, 60);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('keeps rejecting well beyond the limit without remaining going negative', async () => {
    const redis = makeRedis({ incr: jest.fn().mockResolvedValue(100) });
    const limiter = new RedisRateLimiter(redis as never);

    const result = await limiter.consume('key', 5, 60);

    expect(result.remaining).toBe(0);
  });

  it('reports the actual TTL as resetSeconds when available', async () => {
    const redis = makeRedis({ incr: jest.fn().mockResolvedValue(2), ttl: jest.fn().mockResolvedValue(42) });
    const limiter = new RedisRateLimiter(redis as never);

    const result = await limiter.consume('key', 5, 60);

    expect(result.resetSeconds).toBe(42);
  });

  it('falls back to the configured window when TTL is unavailable (e.g. -1/-2)', async () => {
    const redis = makeRedis({ incr: jest.fn().mockResolvedValue(2), ttl: jest.fn().mockResolvedValue(-1) });
    const limiter = new RedisRateLimiter(redis as never);

    const result = await limiter.consume('key', 5, 60);

    expect(result.resetSeconds).toBe(60);
  });

  it('FAIL-OPEN: allows the request when Redis INCR rejects (deliberately different from the decision cache)', async () => {
    const redis = makeRedis({ incr: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) });
    const limiter = new RedisRateLimiter(redis as never);

    const result = await limiter.consume('key', 5, 60);

    expect(result.allowed).toBe(true);
  });

  it('FAIL-OPEN: allows the request when Redis EXPIRE rejects', async () => {
    const redis = makeRedis({
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    });
    const limiter = new RedisRateLimiter(redis as never);

    const result = await limiter.consume('key', 5, 60);

    expect(result.allowed).toBe(true);
  });

  it('never throws to the caller regardless of Redis failure', async () => {
    const redis = makeRedis({ incr: jest.fn().mockRejectedValue(new Error('boom')) });
    const limiter = new RedisRateLimiter(redis as never);

    await expect(limiter.consume('key', 5, 60)).resolves.toBeDefined();
  });
});
