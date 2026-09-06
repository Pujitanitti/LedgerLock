import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { POLICY_REPOSITORY, type PolicyRepositoryPort } from './repositories/policy-repository.port';
import { validateConditions } from '../authorization/conditions/condition-validator';
import { AuthzVersionService } from '../authorization/authz-version/authz-version.service';
import type { PolicyRecord, PolicyVersionRecord, PolicyWithCurrentVersion } from './types/policy-record';

export interface UpsertPolicyContentInput {
  effect: 'allow' | 'deny';
  actions: string[];
  resourceTypes: string[];
  conditions: unknown;
  priority?: number;
}

export interface CreatePolicyRequest extends UpsertPolicyContentInput {
  name: string;
  description?: string;
}

/**
 * Every write method here bumps Tenant.authzVersion unconditionally —
 * ANY policy change (new policy, new version, enable/disable, delete) is
 * treated as tenant-wide in blast radius. This is not the "lazy
 * conservative default"; it's the CORRECT scope: unlike a role
 * assignment (naturally scoped to one user), a policy is itself a
 * tenant-wide artifact — any user's any check could match a changed
 * policy, since ABAC conditions run for every authenticated user in the
 * tenant against every applicable policy. See ADR-012.
 */
@Injectable()
export class PoliciesService {
  constructor(
    @Inject(POLICY_REPOSITORY) private readonly repository: PolicyRepositoryPort,
    private readonly authzVersion: AuthzVersionService,
  ) {}

  async create(tenantId: string, request: CreatePolicyRequest): Promise<PolicyWithCurrentVersion> {
    const existing = await this.repository.findPolicyByName(tenantId, request.name);
    if (existing) {
      throw new ConflictException({
        code: 'POLICY_NAME_TAKEN',
        message: 'A policy with this name already exists for this tenant.',
      });
    }

    // Validated BEFORE ever reaching the repository — malformed
    // conditions never get as far as being persisted. See
    // condition-validator.ts.
    const conditions = validateConditions(request.conditions);

    const result = await this.repository.createPolicy({
      tenantId,
      name: request.name,
      description: request.description,
      effect: request.effect,
      actions: request.actions,
      resourceTypes: request.resourceTypes,
      conditions,
      priority: request.priority,
    });
    await this.authzVersion.bumpTenant(tenantId);
    return result;
  }

  async getById(tenantId: string, id: string): Promise<PolicyRecord> {
    const policy = await this.repository.findPolicyById(tenantId, id);
    if (!policy) {
      throw new NotFoundException({ code: 'POLICY_NOT_FOUND', message: 'Policy not found.' });
    }
    return policy;
  }

  async list(tenantId: string): Promise<PolicyRecord[]> {
    return this.repository.listPolicies(tenantId);
  }

  /**
   * "Updating" a policy NEVER overwrites its current content — it always
   * creates a new immutable PolicyVersion row with the next version
   * number. The policy's identity (id, name) is unchanged; only which
   * version is "current" (highest version number) changes.
   */
  async update(tenantId: string, id: string, content: UpsertPolicyContentInput): Promise<PolicyVersionRecord> {
    await this.getById(tenantId, id); // tenant-ownership check
    const conditions = validateConditions(content.conditions);

    const version = await this.repository.createNewVersion(tenantId, id, {
      effect: content.effect,
      actions: content.actions,
      resourceTypes: content.resourceTypes,
      conditions,
      priority: content.priority,
    });
    await this.authzVersion.bumpTenant(tenantId);
    return version;
  }

  async setEnabled(tenantId: string, id: string, enabled: boolean): Promise<void> {
    await this.getById(tenantId, id);
    await this.repository.setEnabled(tenantId, id, enabled);
    await this.authzVersion.bumpTenant(tenantId);
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await this.getById(tenantId, id);
    await this.repository.deletePolicy(tenantId, id);
    await this.authzVersion.bumpTenant(tenantId);
  }

  async getCurrentVersion(tenantId: string, id: string): Promise<PolicyVersionRecord> {
    await this.getById(tenantId, id);
    const version = await this.repository.getCurrentVersion(tenantId, id);
    if (!version) {
      // Should be unreachable — every policy is created with a v1 version
      // in the same transaction — but handled explicitly rather than
      // assumed, per "fail closed" rather than let a null propagate.
      throw new NotFoundException({ code: 'POLICY_VERSION_NOT_FOUND', message: 'No version found for this policy.' });
    }
    return version;
  }

  async getVersionHistory(tenantId: string, id: string): Promise<PolicyVersionRecord[]> {
    await this.getById(tenantId, id);
    return this.repository.listVersionHistory(tenantId, id);
  }
}
