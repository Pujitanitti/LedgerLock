import type { DecisionReason } from '../decision-engine/types';

export const DECISION_CACHE = Symbol('DECISION_CACHE');

/**
 * ONLY the boolean decision and its reason — deliberately NOT
 * provenance. See ADR-012: provenance (matched policy IDs/versions) can
 * go stale independently of the boolean it produced (e.g. a matched
 * policy is later deleted), so caching it would risk presenting stale
 * data as authoritative. Provenance is always recomputed fresh on a
 * cache miss.
 */
export interface CachedDecision {
  allowed: boolean;
  reason: DecisionReason;
}

/**
 * Redis is a performance optimization, never a source of truth (see
 * RedisModule's own doc comment). Every implementation of this port MUST
 * treat connection errors, timeouts, and malformed data as a cache miss
 * — `get` returning `null` — never as grounds to fabricate an allow.
 * `set` must never throw or block the caller on failure; a decision that
 * fails to cache is still a correct decision, just not a cached one.
 */
export interface DecisionCachePort {
  get(key: string): Promise<CachedDecision | null>;
  set(key: string, decision: CachedDecision, ttlSeconds: number): Promise<void>;
}
