import type { Condition } from '../../authorization/conditions/condition-types';

export interface PolicyRecord {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Immutable once created — see docs/decisions/ADR-011-policy-versioning.md. */
export interface PolicyVersionRecord {
  id: string;
  policyId: string;
  tenantId: string;
  version: number;
  effect: 'allow' | 'deny';
  actions: string[];
  resourceTypes: string[];
  conditions: Condition[];
  priority: number;
  createdAt: Date;
}

export interface CreatePolicyInput {
  tenantId: string;
  name: string;
  description?: string;
  effect: 'allow' | 'deny';
  actions: string[];
  resourceTypes: string[];
  conditions: Condition[];
  priority?: number;
}

export interface CreatePolicyVersionInput {
  effect: 'allow' | 'deny';
  actions: string[];
  resourceTypes: string[];
  conditions: Condition[];
  priority?: number;
}

/** A policy plus its current (highest-version) content, joined for convenience. */
export interface PolicyWithCurrentVersion {
  policy: PolicyRecord;
  currentVersion: PolicyVersionRecord;
}
