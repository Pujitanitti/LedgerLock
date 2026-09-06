import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { PolicyRecord, PolicyVersionRecord } from '../types/policy-record';

export class PolicyResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true }) description!: string | null;
  @ApiProperty() enabled!: boolean;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export class PolicyVersionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() policyId!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ enum: ['allow', 'deny'] }) effect!: 'allow' | 'deny';
  @ApiProperty({ type: [String] }) actions!: string[];
  @ApiProperty({ type: [String] }) resourceTypes!: string[];
  @ApiProperty() conditions!: unknown;
  @ApiProperty() priority!: number;
  @ApiProperty() createdAt!: string;
}

export class PolicyWithVersionResponseDto {
  @ApiProperty({ type: PolicyResponseDto }) policy!: PolicyResponseDto;
  @ApiProperty({ type: PolicyVersionResponseDto }) currentVersion!: PolicyVersionResponseDto;
}

export function toPolicyResponse(record: PolicyRecord): PolicyResponseDto {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    enabled: record.enabled,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toPolicyVersionResponse(record: PolicyVersionRecord): PolicyVersionResponseDto {
  return {
    id: record.id,
    policyId: record.policyId,
    version: record.version,
    effect: record.effect,
    actions: record.actions,
    resourceTypes: record.resourceTypes,
    conditions: record.conditions,
    priority: record.priority,
    createdAt: record.createdAt.toISOString(),
  };
}
