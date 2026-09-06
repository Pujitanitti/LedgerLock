import { randomBytes, createHmac, timingSafeEqual } from 'crypto';

/**
 * API-key format: ll_live_<publicId>_<secret>
 *
 * - publicId: 16 lowercase hex chars (8 random bytes) — NOT secret. Used as
 *   the indexed database lookup key so authentication never requires
 *   hashing every row (see ApiKeyRepositoryPort.findByPublicId — an O(1)
 *   unique-index lookup, then a single hash comparison against that row).
 * - secret: 256 bits of randomness, base64url-encoded — never stored raw.
 *
 * publicId is a fixed 16-hex-char block specifically so parsing is
 * unambiguous even though the base64url secret can itself contain
 * underscores/hyphens: the regex below anchors on the fixed-length hex
 * group rather than naively splitting on "_".
 */
export const API_KEY_PREFIX = 'll_live';

const API_KEY_PATTERN = /^ll_live_([0-9a-f]{16})_([A-Za-z0-9_-]{32,})$/;

export interface GeneratedApiKey {
  /** The full secret the caller must present on every request. Shown once. */
  raw: string;
  /** Non-secret, indexed lookup identifier. Safe to store, log, and display. */
  publicId: string;
  /** The secret portion only — never persisted; only its hash is stored. */
  secret: string;
}

export interface ParsedApiKey {
  publicId: string;
  secret: string;
}

/** Generates a new cryptographically random API key. */
export function generateApiKey(): GeneratedApiKey {
  const publicId = randomBytes(8).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  return { raw: `${API_KEY_PREFIX}_${publicId}_${secret}`, publicId, secret };
}

/**
 * Parses a raw presented API key into its two components, or returns null
 * for anything that doesn't match the exact expected shape. Returning null
 * (rather than throwing with detail) keeps the caller free to respond with
 * a single generic "invalid API key" error, regardless of *why* parsing
 * failed — narrowing down the failure reason to a client would only help
 * an attacker enumerate the format.
 */
export function parseRawApiKey(raw: string): ParsedApiKey | null {
  const match = API_KEY_PATTERN.exec(raw.trim());
  if (!match) return null;
  return { publicId: match[1], secret: match[2] };
}

/**
 * HMAC-SHA256(pepper, secret) — deliberately NOT a slow password-hashing
 * algorithm (bcrypt/argon2/scrypt). The secret is already ~256 bits of
 * CSPRNG output, so slow hashing buys no brute-force resistance and would
 * add real CPU cost on the authorization hot path. See ADR-006.
 */
export function hashApiKeySecret(secret: string, pepper: string): string {
  return createHmac('sha256', pepper).update(secret, 'utf8').digest('hex');
}

/**
 * Constant-time comparison of two hex-encoded HMAC digests. Both inputs
 * are expected to be 64-char hex strings (SHA-256 output); a length
 * mismatch can only occur from data corruption (never from
 * attacker-controlled input, since both are always our own HMAC output),
 * but is still handled without throwing or short-circuiting on content.
 */
export function verifyApiKeySecret(candidateHashHex: string, storedHashHex: string): boolean {
  if (candidateHashHex.length !== storedHashHex.length) return false;
  const a = Buffer.from(candidateHashHex, 'hex');
  const b = Buffer.from(storedHashHex, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * R-003 (pepper rotation) support: verifies a secret against a stored
 * hash using EACH pepper in order, succeeding if any one matches.
 * Intended peppers = [currentPepper, previousPepper?] — this is what
 * lets an operator rotate `API_KEY_HMAC_PEPPER` without instantly
 * invalidating every existing key's stored hash: during the transition
 * window, keys hashed under the old pepper still verify against it here,
 * while every NEWLY CREATED key is hashed with only the current pepper
 * (see ApiKeyService.createForTenant, which never accepts a peppers
 * list) — the old pepper is only ever a fallback for reading, never used
 * for writing. See ADR-006.
 */
export function verifyApiKeySecretAgainstPeppers(
  secret: string,
  storedHashHex: string,
  peppers: readonly string[],
): boolean {
  return peppers.some((pepper) => verifyApiKeySecret(hashApiKeySecret(secret, pepper), storedHashHex));
}
