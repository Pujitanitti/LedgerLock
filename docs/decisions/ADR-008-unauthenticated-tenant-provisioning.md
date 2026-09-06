# ADR-008: Unauthenticated Tenant Provisioning Endpoint

## Status
**OPEN RISK — partially mitigated, not resolved. Accepted for development/bootstrap use only. Must be revisited before any production/public deployment.**

## Context

`POST /v1/tenants` creates a new tenant and its first API key in a single
atomic transaction (see `TenantProvisioningService`). This endpoint cannot
require an API key for authentication, because a brand-new tenant has no
key yet — that's the entire problem it exists to solve. There is no
existing credential to gate it behind.

## Decision

For now, `POST /v1/tenants` remains genuinely unauthenticated. Anyone who
can reach the API can call it and create a tenant plus a valid, usable API
key for that tenant, with no approval step and no legitimacy check.

**Partial mitigation added:** `TenantProvisioningRateLimitGuard` throttles
this endpoint to 5 requests per hour per source IP (Redis-backed fixed
window, keyed by `req.ip`, deliberately fail-open on Redis failure — see
the guard's own doc comment for why that failure direction is correct
here despite being the opposite of every authorization-critical Redis
path elsewhere in this project). **This is exactly the "at minimum rate
limiting" step named below as the plausible near-term mitigation — it
does not close this finding.** A rate limit slows a single-source
attacker; it does nothing against a distributed one rotating IPs, and it
adds no legitimacy checking at all. R-001 remains OPEN.

This is a deliberate, tracked trade-off — not an oversight, and not
something later phases should assume has been quietly solved. It is
flagged in three places: this ADR, the controller's own doc comment
(`tenants.controller.ts`), and `docs/risk-register.md`.

## Why this is not being fully "fixed" right now

Closing this properly requires one of:

- **Platform-admin authentication** — a separate credential/identity system
  for Anthropic-Ledger-Lock-operator-level actors, distinct from the
  per-tenant API keys this project's phases build. Inventing this now,
  ahead of any actual requirement to operate it, would be exactly the kind
  of "security theater" / speculative infrastructure this project's
  engineering principles reject — a fake admin system built to make a
  finding look closed, with no real operator, no real login flow, and no
  real threat model of its own.
- **An invitation/approval flow** — requires deciding who issues
  invitations and how, which is itself a platform-admin-shaped question.
- **Rate limiting / abuse monitoring** — now partially implemented (see
  above). It doesn't require inventing new identity concepts, and was the
  most plausible near-term step, but it still doesn't fully close the
  finding (it slows abuse, it doesn't require legitimacy).

Platform-admin auth and an invitation flow are not "genuinely required by
the current architecture" in the sense of blocking any phase's
RBAC/authorization/caching work, so neither is being built speculatively
here. Full closure is explicitly deferred to a future **hardening phase**,
not silently dropped.

## Production-readiness warning

**Do not deploy Ledger-Lock to any environment reachable by untrusted
parties with this endpoint only rate-limited and not authenticated.**
Before any production or public deployment, this ADR's status must change
from OPEN to RESOLVED, with platform-admin auth or an invitation flow (or
an equivalent) actually implemented and tested — not just documented.

## Consequences

- Every phase after this one that touches tenant creation must treat this
  as still open, not assume it has been fully addressed.
- The current threat model (Phase 1, Phase 4 security findings) explicitly
  lists this rather than omitting tenant-creation abuse as an
  out-of-scope concern.
- The rate limit's fixed thresholds (5/hour/IP) are a reasonable starting
  default, not a tuned production value — revisit if real abuse patterns
  emerge.
