import { Inject, Injectable } from '@nestjs/common';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from './repositories/tenant-repository.port';
import type { TenantRecord } from './types/tenant-record';

@Injectable()
export class TenantsService {
  constructor(@Inject(TENANT_REPOSITORY) private readonly repository: TenantRepositoryPort) {}

  async findBySlug(slug: string): Promise<TenantRecord | null> {
    return this.repository.findBySlug(slug);
  }

  async findById(id: string): Promise<TenantRecord | null> {
    return this.repository.findById(id);
  }
}
