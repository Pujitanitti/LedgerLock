import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { generateApiKey, hashApiKeySecret } from '../auth/crypto/api-key-crypto';
import type { ApiKeyRecord } from '../auth/types/api-key-record';
import type { CreateTenantDto } from './dto/create-tenant.dto';
import type { TenantRecord } from './types/tenant-record';

export interface ProvisionedTenant {
  tenant: TenantRecord;
  apiKey: { record: ApiKeyRecord; rawKey: string };
}

/**
 * Creating a tenant and its first API key must be atomic — a tenant that
 * exists with no usable key, or a key that exists pointing at a tenant
 * that failed to commit, are both broken states a client could otherwise
 * observe. That atomicity requires a single database transaction spanning
 * two tables, which the ApiKeyRepositoryPort / TenantRepositoryPort
 * abstraction (each scoped to one aggregate) isn't designed for — so this
 * service uses PrismaService.$transaction directly rather than composing
 * the two ports. This is a deliberate, narrow exception, not a departure
 * from the port pattern used everywhere else in Phase 3.
 *
 * VERIFICATION STATUS: like the two Prisma*Repository files, this calls
 * `this.prisma.$transaction` / `.tenant.create` / `.apiKey.create`
 * directly and is environment-blocked until Prisma Client is generated.
 */
@Injectable()
export class TenantProvisioningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async provisionTenant(dto: CreateTenantDto): Promise<ProvisionedTenant> {
    const existing = await this.prisma.tenant.findUnique({ where: { slug: dto.slug } });
    if (existing) {
      throw new ConflictException({
        code: 'TENANT_SLUG_TAKEN',
        message: 'A tenant with this slug already exists.',
      });
    }

    const pepper = this.config.getOrThrow<string>('API_KEY_HMAC_PEPPER');
    const generated = generateApiKey();
    const secretHash = hashApiKeySecret(generated.secret, pepper);

    const { tenant, apiKey } = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const createdTenant = await tx.tenant.create({
        data: { slug: dto.slug, name: dto.name },
      });
      const createdApiKey = await tx.apiKey.create({
        data: {
          tenantId: createdTenant.id,
          publicId: generated.publicId,
          secretHash,
          name: 'Default key (created with tenant)',
        },
      });
      return { tenant: createdTenant, apiKey: createdApiKey };
    });

    return { tenant, apiKey: { record: apiKey, rawKey: generated.raw } };
  }
}
