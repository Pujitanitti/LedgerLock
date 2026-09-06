import type { UserRecord } from '../types/user-record';
import type { UserResponseDto } from './user-response.dto';

export function toUserResponse(record: UserRecord): UserResponseDto {
  return {
    id: record.id,
    externalId: record.externalId,
    attributes: record.attributes,
    createdAt: record.createdAt.toISOString(),
  };
}
