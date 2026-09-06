# ADR-006: API-Key Secret Hashing Algorithm

## Context

API-key secrets must never be stored in plaintext. The obvious default —
bcrypt/argon2/scrypt, as recommended for user passwords — needs to be
weighed against what these keys actually are and how often they're
verified.

## Decision

Use `HMAC-SHA256(pepper, secret)`, stored as a 64-character hex digest.
The pepper is a server-side secret (`API_KEY_HMAC_PEPPER`), separate from
any per-record salt, so a stolen database dump alone is insufficient to
verify guesses against the hashes without also compromising the running
service's environment configuration.

## Why not bcrypt/argon2/scrypt

Those algorithms are deliberately slow to resist brute-forcing **low
-entropy, human-chosen** passwords (a human password might have well under
40 bits of real entropy). An API-key secret here is 256 bits of
CSPRNG output (`crypto.randomBytes(32)`) — brute-forcing it is already
computationally infeasible regardless of hash speed. Running bcrypt on
every request to `/v1/check` (a high-QPS, latency-sensitive endpoint) or
any authenticated management endpoint would add real, unnecessary CPU cost
(tens of milliseconds per call) for zero additional security margin against
the actual threat model for this credential type.

## Lookup design

Authentication must not require hashing every row in the `api_keys` table.
The key format (`ll_live_<publicId>_<secret>`) separates a non-secret,
indexed `publicId` (used for an O(1) unique-index lookup) from the secret
itself (hashed and compared only once, against the single row returned by
that lookup). See `auth/crypto/api-key-crypto.ts`.

## Alternatives considered

- **bcrypt/argon2 on the secret** — rejected per above; wrong tool for
  high-entropy machine credentials, with a real latency cost.
- **Raw SHA-256 with no pepper** — rejected: a stolen database dump alone
  would let an attacker verify guesses (though guessing 256 bits of
  entropy is already infeasible, defense in depth costs nothing here and
  the pepper is nearly free to add).
- **Per-record random salt instead of a global pepper** — salts primarily
  defend against precomputed rainbow tables for **low-entropy** secrets
  where many users might pick the same value; with 256 bits of unique
  randomness per key, there is no realistic rainbow-table risk to defend
  against. A shared pepper still adds the "compromised DB alone isn't
  enough" property at effectively zero implementation or performance cost.

## Consequences

- Verification is a single HMAC computation plus a constant-time compare —
  fast enough to run on every authenticated request without a caching
  layer specifically for this step.
- The pepper is a single point of failure for hash verification: if it
  leaks alongside the database, all stored hashes become guessable from
  a dictionary of intercepted keys (not from the hashes themselves, since
  the secrets aren't guessable).

## Update (R-003 fix): pepper rotation

Phase 3 shipped without a rotation mechanism — rotating `API_KEY_HMAC_PEPPER`
would have invalidated every existing key's stored hash instantly. This is
now fixed: `authenticate()` verifies against an ordered list of peppers,
`[current, previous?]`, via `verifyApiKeySecretAgainstPeppers`
(`auth/crypto/api-key-crypto.ts`) — an optional `API_KEY_HMAC_PEPPER_PREVIOUS`
environment variable supplies the outgoing pepper during a transition
window. **Key asymmetry, deliberate:** `createForTenant` never accepts or
consults the previous pepper — every newly issued key is hashed under the
current pepper only, so the outgoing pepper's relevance strictly shrinks
over time as old keys are naturally revoked/rotated by tenants, rather
than ever being written into new data.

Operational rotation procedure this enables: set `API_KEY_HMAC_PEPPER` to
the new value and `API_KEY_HMAC_PEPPER_PREVIOUS` to the old value
simultaneously (both existing and newly-issued keys keep working) → wait
out a safe transition window → remove `API_KEY_HMAC_PEPPER_PREVIOUS`
entirely (any key still only hashed under the old pepper stops
authenticating at that point — an accepted, operator-controlled
trade-off, not a silent one).
