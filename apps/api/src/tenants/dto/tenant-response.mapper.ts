import type { TenantRecord } from '../types/tenant-record';
import type { TenantResponseDto } from './tenant-response.dto';

export function toTenantResponse(record: TenantRecord): TenantResponseDto {
  return {
    id: record.id,
    slug: record.slug,
    name: record.name,
    createdAt: record.createdAt.toISOString(),
  };
}
