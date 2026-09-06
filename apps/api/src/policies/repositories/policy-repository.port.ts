import type {
  CreatePolicyInput,
  CreatePolicyVersionInput,
  PolicyRecord,
  PolicyVersionRecord,
  PolicyWithCurrentVersion,
} from '../types/policy-record';

export const POLICY_REPOSITORY = Symbol('POLICY_REPOSITORY');

/**
 * Note what is deliberately ABSENT from this interface: there is no
 * `updatePolicyVersion` or `deletePolicyVersion` method anywhere. That is
 * not an oversight — it's the actual enforcement mechanism for "policy
 * versions are immutable." The only way to change a policy's content is
 * `createNewVersion`, which always inserts a new row. A future
 * contributor cannot "accidentally" mutate history because the method to
 * do so does not exist.
 */
export interface PolicyRepositoryPort {
  /** Creates a Policy and its v1 PolicyVersion atomically. */
  createPolicy(input: CreatePolicyInput): Promise<PolicyWithCurrentVersion>;

  findPolicyById(tenantId: string, id: string): Promise<PolicyRecord | null>;

  findPolicyByName(tenantId: string, name: string): Promise<PolicyRecord | null>;

  listPolicies(tenantId: string): Promise<PolicyRecord[]>;

  setEnabled(tenantId: string, id: string, enabled: boolean): Promise<void>;

  deletePolicy(tenantId: string, id: string): Promise<void>;

  /** The highest-version PolicyVersion row for this policy — never mutated, only inserted. */
  getCurrentVersion(tenantId: string, policyId: string): Promise<PolicyVersionRecord | null>;

  listVersionHistory(tenantId: string, policyId: string): Promise<PolicyVersionRecord[]>;

  /** Always inserts a new row with version = (current max version) + 1. Never overwrites. */
  createNewVersion(tenantId: string, policyId: string, input: CreatePolicyVersionInput): Promise<PolicyVersionRecord>;

  /**
   * The authorization hot-path query: every ENABLED policy's CURRENT
   * version for a tenant, pre-filtered by action/resourceType pattern
   * match where practical at the SQL level, with the remainder (pattern
   * matching against wildcards, and all condition evaluation) done by the
   * pure functions in authorization/policy-engine and
   * authorization/conditions. Never returns a disabled policy's version,
   * and never returns anything outside the given tenant.
   */
  listCandidateVersionsForCheck(tenantId: string): Promise<PolicyVersionRecord[]>;
}
