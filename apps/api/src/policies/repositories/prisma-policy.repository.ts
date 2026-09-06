import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { Condition } from '../../authorization/conditions/condition-types';
import type {
  CreatePolicyInput,
  CreatePolicyVersionInput,
  PolicyRecord,
  PolicyVersionRecord,
  PolicyWithCurrentVersion,
} from '../types/policy-record';
import type { PolicyRepositoryPort } from './policy-repository.port';

/**
 * VERIFICATION STATUS: same category as every other Prisma-touching file
 * in this project (PrismaApiKeyRepository, PrismaTenantRepository,
 * PrismaUserRepository, PrismaRbacRepository) — environment-blocked here
 * because `new PrismaClient()` throws immediately in this sandbox's
 * pre-generation state. Written as correct production code.
 *
 * `listCandidateVersionsForCheck` uses `$queryRaw` as a plain tagged
 * template (NOT wrapped in `Prisma.sql`) with a single scalar parameter —
 * unlike the RBAC recursive-CTE fix, there's no variable-length array to
 * bind here, so there's no need for `Prisma.join` or the manual
 * -placeholder-counting approach used there. A single interpolated value
 * in a `$queryRaw` tagged template is Prisma's most basic, universally
 * -documented parameterization mechanism, and doesn't touch the `Prisma`
 * namespace at all (only `Prisma.TransactionClient`, used purely as a
 * TYPE below, which — unlike `Prisma.sql`/`Prisma.join` — is confirmed
 * present as a real declared export even in this pre-generation stub;
 * type-only references are erased at compile time and never depend on
 * runtime presence).
 */
@Injectable()
export class PrismaPolicyRepository implements PolicyRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async createPolicy(input: CreatePolicyInput): Promise<PolicyWithCurrentVersion> {
    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const policy = await tx.policy.create({
        data: { tenantId: input.tenantId, name: input.name, description: input.description ?? null },
      });
      const version = await tx.policyVersion.create({
        data: {
          policyId: policy.id,
          tenantId: input.tenantId,
          version: 1,
          effect: input.effect,
          actions: input.actions,
          resourceTypes: input.resourceTypes,
          conditions: input.conditions as unknown as object,
          priority: input.priority ?? 0,
        },
      });
      return { policy, version };
    });

    return { policy: result.policy, currentVersion: toVersionRecord(result.version) };
  }

  async findPolicyById(tenantId: string, id: string): Promise<PolicyRecord | null> {
    return this.prisma.policy.findFirst({ where: { id, tenantId } });
  }

  async findPolicyByName(tenantId: string, name: string): Promise<PolicyRecord | null> {
    return this.prisma.policy.findUnique({ where: { tenantId_name: { tenantId, name } } });
  }

  async listPolicies(tenantId: string): Promise<PolicyRecord[]> {
    return this.prisma.policy.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
  }

  async setEnabled(tenantId: string, id: string, enabled: boolean): Promise<void> {
    await this.prisma.policy.updateMany({ where: { id, tenantId }, data: { enabled } });
  }

  async deletePolicy(tenantId: string, id: string): Promise<void> {
    await this.prisma.policy.deleteMany({ where: { id, tenantId } });
  }

  async getCurrentVersion(tenantId: string, policyId: string): Promise<PolicyVersionRecord | null> {
    const version = await this.prisma.policyVersion.findFirst({
      where: { policyId, tenantId },
      orderBy: { version: 'desc' },
    });
    return version ? toVersionRecord(version) : null;
  }

  async listVersionHistory(tenantId: string, policyId: string): Promise<PolicyVersionRecord[]> {
    const versions = await this.prisma.policyVersion.findMany({
      where: { policyId, tenantId },
      orderBy: { version: 'asc' },
    });
    return versions.map(toVersionRecord);
  }

  async createNewVersion(
    tenantId: string,
    policyId: string,
    input: CreatePolicyVersionInput,
  ): Promise<PolicyVersionRecord> {
    // Read-then-insert inside a transaction: the (policyId, version)
    // unique constraint is the actual concurrency guard — if two updates
    // race, one transaction's insert fails the unique constraint rather
    // than silently producing two rows claiming the same version number.
    const created = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const latest = await tx.policyVersion.findFirst({
        where: { policyId, tenantId },
        orderBy: { version: 'desc' },
      });
      const nextVersion = (latest?.version ?? 0) + 1;
      return tx.policyVersion.create({
        data: {
          policyId,
          tenantId,
          version: nextVersion,
          effect: input.effect,
          actions: input.actions,
          resourceTypes: input.resourceTypes,
          conditions: input.conditions as unknown as object,
          priority: input.priority ?? 0,
        },
      });
    });

    return toVersionRecord(created);
  }

  async listCandidateVersionsForCheck(tenantId: string): Promise<PolicyVersionRecord[]> {
    const rows: RawPolicyVersionRow[] = await this.prisma.$queryRaw`
      SELECT DISTINCT ON (pv."policyId")
        pv.id, pv."policyId", pv."tenantId", pv.version, pv.effect,
        pv.actions, pv."resourceTypes", pv.conditions, pv.priority, pv."createdAt"
      FROM "policy_versions" pv
      INNER JOIN "policies" p ON p.id = pv."policyId"
      WHERE p."tenantId" = ${tenantId} AND p.enabled = true
      ORDER BY pv."policyId", pv.version DESC
    `;

    return rows.map((row) => toVersionRecord(row));
  }
}

interface RawPolicyVersionRow {
  id: string;
  policyId: string;
  tenantId: string;
  version: number;
  effect: string;
  actions: string[];
  resourceTypes: string[];
  conditions: unknown;
  priority: number;
  createdAt: Date;
}

function toVersionRecord(row: RawPolicyVersionRow): PolicyVersionRecord {
  return {
    id: row.id,
    policyId: row.policyId,
    tenantId: row.tenantId,
    version: row.version,
    effect: row.effect as 'allow' | 'deny',
    actions: row.actions,
    resourceTypes: row.resourceTypes,
    conditions: row.conditions as Condition[],
    priority: row.priority,
    createdAt: row.createdAt,
  };
}
