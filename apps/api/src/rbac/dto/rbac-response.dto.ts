import { ApiProperty } from '@nestjs/swagger';
import type { PermissionRecord, RoleRecord } from '../types/rbac-record';

export class RoleResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() createdAt!: string;
}

export class PermissionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() action!: string;
  @ApiProperty() createdAt!: string;
}

export function toRoleResponse(record: RoleRecord): RoleResponseDto {
  return { id: record.id, name: record.name, createdAt: record.createdAt.toISOString() };
}

export function toPermissionResponse(record: PermissionRecord): PermissionResponseDto {
  return { id: record.id, action: record.action, createdAt: record.createdAt.toISOString() };
}
