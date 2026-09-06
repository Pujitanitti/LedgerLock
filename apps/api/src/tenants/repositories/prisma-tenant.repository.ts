import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { CreateTenantInput, TenantRecord } from '../types/tenant-record';
import type { TenantRepositoryPort } from './tenant-repository.port';

/**
 * Same verification-status note as PrismaApiKeyRepository: this calls
 * `this.prisma.tenant.*`, which requires a real generated Prisma Client.
 * Environment-blocked in this sandbox — see the Phase 2 verification
 * report. Written as correct production code, verifiable once `npm run
 * prisma:generate` succeeds in an unrestricted environment.
 */
@Injectable()
export class PrismaTenantRepository implements TenantRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateTenantInput): Promise<TenantRecord> {
    return this.prisma.tenant.create({ data: { slug: input.slug, name: input.name } });
  }

  async findBySlug(slug: string): Promise<TenantRecord | null> {
    return this.prisma.tenant.findUnique({ where: { slug } });
  }

  async findById(id: string): Promise<TenantRecord | null> {
    return this.prisma.tenant.findUnique({ where: { id } });
  }

  async getAuthzVersion(tenantId: string): Promise<number | null> {
    const row = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { authzVersion: true },
    });
    return row ? row.authzVersion : null;
  }

  async incrementAuthzVersion(tenantId: string): Promise<void> {
    await this.prisma.tenant.updateMany({
      where: { id: tenantId },
      data: { authzVersion: { increment: 1 } },
    });
  }
}
