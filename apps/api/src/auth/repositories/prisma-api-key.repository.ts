import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ApiKeyRecord, CreateApiKeyRecordInput } from '../types/api-key-record';
import type { ApiKeyRepositoryPort } from './api-key-repository.port';

/**
 * NOTE ON VERIFICATION STATUS: this file calls `this.prisma.apiKey.*`,
 * which requires a Prisma Client generated from prisma/schema.prisma.
 * That generation step is environment-blocked in the current sandbox
 * (binaries.prisma.sh is outside the allowed egress list — see the Phase 2
 * verification report). This code is written exactly as it should run in
 * production; it is expected to fail `tsc`/`build` here until `npm run
 * prisma:generate` is run in an environment that can reach that host.
 * This is the ONLY file in the auth module with that dependency — every
 * other file (ApiKeyService, ApiKeyGuard, the crypto/policy modules) is
 * verified independently of it via the ApiKeyRepositoryPort boundary.
 */
@Injectable()
export class PrismaApiKeyRepository implements ApiKeyRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateApiKeyRecordInput): Promise<ApiKeyRecord> {
    return this.prisma.apiKey.create({
      data: {
        tenantId: input.tenantId,
        publicId: input.publicId,
        secretHash: input.secretHash,
        name: input.name,
        expiresAt: input.expiresAt,
      },
    });
  }

  async findByPublicId(publicId: string): Promise<ApiKeyRecord | null> {
    return this.prisma.apiKey.findUnique({ where: { publicId } });
  }

  async findByIdForTenant(id: string, tenantId: string): Promise<ApiKeyRecord | null> {
    // tenantId is part of the WHERE clause itself, not a post-fetch check —
    // this is the actual DB-level tenant-isolation enforcement for this
    // entity (see docs/decisions/ADR-007).
    return this.prisma.apiKey.findFirst({ where: { id, tenantId } });
  }

  async listByTenant(tenantId: string): Promise<ApiKeyRecord[]> {
    return this.prisma.apiKey.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(id: string): Promise<void> {
    await this.prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  async touchLastUsed(id: string): Promise<void> {
    await this.prisma.apiKey.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }
}
