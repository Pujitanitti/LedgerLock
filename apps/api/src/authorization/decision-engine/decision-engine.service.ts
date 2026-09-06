import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { USER_REPOSITORY, type UserRepositoryPort } from '../../users/repositories/user-repository.port';
import { RBAC_REPOSITORY, type RbacRepositoryPort } from '../../rbac/repositories/rbac-repository.port';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants/repositories/tenant-repository.port';
import { PolicyEvaluationService, type AbacEvaluationResult } from '../policy-engine/policy-evaluation.service';
import { combineRbacAndAbac } from './decision-combination';
import { buildDecisionCacheKey } from '../decision-cache/cache-key';
import { DECISION_CACHE, type DecisionCachePort } from '../decision-cache/decision-cache.port';
import { AuditService } from '../../audit/audit.service';
import type { CheckRequestInput, Decision } from './types';
import type { EvaluationAttributes, SubjectAttributes } from '../conditions/condition-types';

export const MAX_BATCH_SIZE = 50;
const DEFAULT_CACHE_TTL_SECONDS = 60;

/**
 * DENY-BY-DEFAULT IS STRUCTURAL, NOT INCIDENTAL: every method below either
 * returns an explicit `{ allowed: true, ... }` from a specific, named
 * matching branch, or falls through to `{ allowed: false, ... }`. There is
 * no code path that returns early with an implicit allow, and no
 * uncaught-exception path either -- this file never throws for a
 * "couldn't determine" case; it always resolves to a Decision.
 *
 * PHASE 6 PIPELINE (see ADR-012 for the full design):
 *   resolve user -> resource-tenant check -> cache lookup
 *     -> HIT: return cached {allowed, reason} (no provenance recomputed)
 *     -> MISS: authoritative RBAC+ABAC evaluation -> cache write
 *   -> audit (unconditionally, hit or miss -- see recordAudit)
 *
 * The authoritative evaluator (`evaluateAuthoritatively`) is a private
 * method with no cache/audit concerns baked in, kept deliberately
 * separable so it can be reasoned about (and was originally tested,
 * pre-Phase-6) independent of caching.
 */
@Injectable()
export class DecisionEngineService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepositoryPort,
    @Inject(RBAC_REPOSITORY) private readonly rbacRepository: RbacRepositoryPort,
    @Inject(TENANT_REPOSITORY) private readonly tenantRepository: TenantRepositoryPort,
    @Inject(DECISION_CACHE) private readonly decisionCache: DecisionCachePort,
    private readonly policyEvaluation: PolicyEvaluationService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService,
  ) {}

  async evaluate(tenantId: string, request: CheckRequestInput, requestId: string): Promise<Decision> {
    const startedAt = Date.now();

    const user = await this.userRepository.findByExternalId(tenantId, request.userId);
    if (!user) {
      const decision: Decision = { allowed: false, reason: 'unknown_user' };
      await this.recordAudit(tenantId, request.userId, request, decision, false, startedAt, requestId);
      return decision;
    }

    if (request.resource?.tenantId && request.resource.tenantId !== tenantId) {
      const decision: Decision = { allowed: false, reason: 'resource_tenant_mismatch' };
      await this.recordAudit(tenantId, user.externalId, request, decision, false, startedAt, requestId);
      return decision;
    }

    const tenantAuthzVersion = await this.tenantRepository.getAuthzVersion(tenantId);
    const cacheKey =
      tenantAuthzVersion !== null
        ? buildDecisionCacheKey({
            tenantId,
            tenantAuthzVersion,
            userId: user.externalId,
            userAuthzVersion: user.authzVersion,
            action: request.action,
            resourceType: request.resource?.type,
            resourceId: request.resource?.id,
            resource: request.resource,
            context: request.context,
          })
        : null;

    if (cacheKey) {
      const cached = await this.decisionCache.get(cacheKey);
      if (cached) {
        const decision: Decision = { allowed: cached.allowed, reason: cached.reason };
        await this.recordAudit(tenantId, user.externalId, request, decision, true, startedAt, requestId);
        return decision;
      }
    }

    const decision = await this.evaluateAuthoritatively(tenantId, user.id, user.externalId, user.attributes, request);

    if (cacheKey) {
      await this.safeCacheSet(cacheKey, decision);
    }

    await this.recordAudit(tenantId, user.externalId, request, decision, false, startedAt, requestId);
    return decision;
  }

  /**
   * Batches DB access rather than looping HTTP-style per item:
   * - one query resolves every distinct userId in the request,
   * - the tenant's authzVersion is fetched exactly ONCE for the whole
   *   batch (it cannot change mid-batch in any way this process could
   *   observe differently across items),
   * - RBAC's effective-permission resolution and ABAC's candidate policy
   *   list are each computed/fetched at most once per distinct user /
   *   once per batch respectively, exactly as before Phase 6,
   * - a per-item cache lookup still happens (cheap -- one Redis GET), so
   *   items that are already cached skip RBAC/ABAC entirely.
   * Results are returned in the exact order the items were submitted.
   */
  async evaluateBatch(
    tenantId: string,
    requests: readonly CheckRequestInput[],
    requestId: string,
  ): Promise<Decision[]> {
    if (requests.length > MAX_BATCH_SIZE) {
      throw new BadRequestException({
        code: 'BATCH_TOO_LARGE',
        message: `A batch may contain at most ${MAX_BATCH_SIZE} checks.`,
      });
    }
    if (requests.length === 0) {
      return [];
    }

    const startedAt = Date.now();
    const uniqueExternalIds = [...new Set(requests.map((r) => r.userId))];
    const users = await this.userRepository.findManyByExternalIds(tenantId, uniqueExternalIds);
    const userByExternalId = new Map(users.map((u) => [u.externalId, u]));

    const tenantAuthzVersion = await this.tenantRepository.getAuthzVersion(tenantId);
    const rbacByUserId = new Map<string, { directRoleIds: string[]; actions: string[] }>();
    const policyCandidates = await this.policyEvaluation.fetchCandidates(tenantId);

    const decisions: Decision[] = [];
    for (const request of requests) {
      const user = userByExternalId.get(request.userId);
      if (!user) {
        const decision: Decision = { allowed: false, reason: 'unknown_user' };
        decisions.push(decision);
        await this.recordAudit(tenantId, request.userId, request, decision, false, startedAt, requestId);
        continue;
      }

      if (request.resource?.tenantId && request.resource.tenantId !== tenantId) {
        const decision: Decision = { allowed: false, reason: 'resource_tenant_mismatch' };
        decisions.push(decision);
        await this.recordAudit(tenantId, user.externalId, request, decision, false, startedAt, requestId);
        continue;
      }

      const cacheKey =
        tenantAuthzVersion !== null
          ? buildDecisionCacheKey({
              tenantId,
              tenantAuthzVersion,
              userId: user.externalId,
              userAuthzVersion: user.authzVersion,
              action: request.action,
              resourceType: request.resource?.type,
              resourceId: request.resource?.id,
              resource: request.resource,
              context: request.context,
            })
          : null;

      const cached = cacheKey ? await this.decisionCache.get(cacheKey) : null;
      if (cached) {
        const decision: Decision = { allowed: cached.allowed, reason: cached.reason };
        decisions.push(decision);
        await this.recordAudit(tenantId, user.externalId, request, decision, true, startedAt, requestId);
        continue;
      }

      let rbac = rbacByUserId.get(user.id);
      if (rbac === undefined) {
        const directRoleIds = await this.rbacRepository.listRoleIdsForUser(tenantId, user.id);
        const actions =
          directRoleIds.length > 0
            ? await this.rbacRepository.getEffectivePermissionActions(tenantId, directRoleIds)
            : [];
        rbac = { directRoleIds, actions };
        rbacByUserId.set(user.id, rbac);
      }
      const rbacAllowed = rbac.actions.includes(request.action);

      const subject: SubjectAttributes = buildSubjectAttributes(user.externalId, rbac.directRoleIds, user.attributes);
      const attributes: EvaluationAttributes = { subject, resource: request.resource, context: request.context };
      const abacResult = this.policyEvaluation.evaluateAgainstCandidates(policyCandidates, request.action, attributes);
      const decision = buildDecisionWithProvenance(rbacAllowed, rbac.directRoleIds, abacResult);

      if (cacheKey) {
        await this.safeCacheSet(cacheKey, decision);
      }

      decisions.push(decision);
      await this.recordAudit(tenantId, user.externalId, request, decision, false, startedAt, requestId);
    }

    return decisions;
  }

  /** The pure(ish) RBAC+ABAC authoritative path -- no cache, no audit concerns. */
  private async evaluateAuthoritatively(
    tenantId: string,
    userId: string,
    externalId: string,
    userAttributes: Record<string, unknown> | null,
    request: CheckRequestInput,
  ): Promise<Decision> {
    const directRoleIds = await this.rbacRepository.listRoleIdsForUser(tenantId, userId);
    const rbacActions =
      directRoleIds.length > 0 ? await this.rbacRepository.getEffectivePermissionActions(tenantId, directRoleIds) : [];
    const rbacAllowed = rbacActions.includes(request.action);

    const subject: SubjectAttributes = buildSubjectAttributes(externalId, directRoleIds, userAttributes);
    const attributes: EvaluationAttributes = { subject, resource: request.resource, context: request.context };

    const abacResult = await this.policyEvaluation.evaluate(tenantId, request.action, attributes);
    return buildDecisionWithProvenance(rbacAllowed, directRoleIds, abacResult);
  }

  private getCacheTtlSeconds(): number {
    return this.config.get<number>('AUTHZ_CACHE_TTL_SECONDS', DEFAULT_CACHE_TTL_SECONDS);
  }

  /**
   * DEFENSE IN DEPTH: DecisionCachePort implementations are contractually
   * required to never throw on `set` (see decision-cache.port.ts /
   * RedisDecisionCache's own tests) — but "a failed cache write must
   * never turn an otherwise valid authorization decision into an
   * authorization failure" is important enough to hold at this layer
   * too, not solely rely on every current and future adapter upholding
   * its own contract correctly forever.
   */
  private async safeCacheSet(cacheKey: string, decision: Decision): Promise<void> {
    try {
      await this.decisionCache.set(
        cacheKey,
        { allowed: decision.allowed, reason: decision.reason },
        this.getCacheTtlSeconds(),
      );
    } catch {
      // Intentionally swallowed — the decision was already computed
      // correctly and will still be returned/recorded; it just won't be
      // cached for the next request, which is a performance loss, not a
      // correctness one.
    }
  }

  private async recordAudit(
    tenantId: string,
    userId: string,
    request: CheckRequestInput,
    decision: Decision,
    servedFromCache: boolean,
    startedAt: number,
    requestId: string,
  ): Promise<void> {
    // Same defense-in-depth rationale as safeCacheSet above: AuditService
    // already promises never to throw, but the authorization response
    // must not depend on that promise being kept by every implementation
    // forever — audit availability must never gate authorization.
    try {
      await this.auditService.recordDecision({
        tenantId,
        userId,
        action: request.action,
        resourceType: request.resource?.type ?? null,
        resourceId: request.resource?.id ?? null,
        decision: decision.allowed ? 'allow' : 'deny',
        reason: decision.reason,
        policyId: decision.provenance?.decidingPolicyId ?? null,
        policyVersionNumber: decision.provenance?.decidingPolicyVersion ?? null,
        matchedPolicies: servedFromCache ? null : (decision.provenance?.matchedPolicies ?? []),
        servedFromCache,
        latencyMs: Date.now() - startedAt,
        requestId,
      });
    } catch {
      // Intentionally swallowed — see rationale above.
    }
  }
}

function buildDecisionWithProvenance(
  rbacAllowed: boolean,
  directRoleIds: string[],
  abacResult: AbacEvaluationResult,
): Decision {
  const combined = combineRbacAndAbac(rbacAllowed, abacResult);
  return {
    ...combined,
    provenance: {
      rbacAllowed,
      directRoleIds,
      matchedPolicies: abacResult.matchedPolicies,
      decidingPolicyId: abacResult.decidingPolicy?.policyId,
      decidingPolicyVersion: abacResult.decidingPolicy?.version,
    },
  };
}

/**
 * `id` is the CALLER's own external user identifier (not Ledger-Lock's
 * internal id) -- policy authors write conditions in terms of the IDs
 * their own application already uses (e.g. resource.ownerId will also be
 * one of their external IDs). `roles` are the user's DIRECTLY assigned
 * role IDs only, not expanded through inheritance -- see risk-register.md
 * R-006 for why, and the scoping trade-off that implies.
 */
function buildSubjectAttributes(
  externalId: string,
  directRoleIds: string[],
  attributes: Record<string, unknown> | null,
): SubjectAttributes {
  return { id: externalId, roles: directRoleIds, ...(attributes ?? {}) };
}
