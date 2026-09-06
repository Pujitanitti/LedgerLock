export const RATE_LIMITER = Symbol('RATE_LIMITER');

export interface RateLimitResult {
  allowed: boolean;
  /** Requests remaining in the current window (0 if the request was itself rejected). */
  remaining: number;
  /** Seconds until the window resets — used for a Retry-After header. */
  resetSeconds: number;
}

/**
 * A fixed-window request counter, keyed by whatever the caller supplies
 * (e.g. an IP address for an unauthenticated endpoint). This is an
 * abuse-prevention mechanism, NOT an authorization control — see
 * RedisRateLimiter's own doc comment for why its failure mode is
 * deliberately different from DecisionCachePort's.
 */
export interface RateLimiterPort {
  consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
}
