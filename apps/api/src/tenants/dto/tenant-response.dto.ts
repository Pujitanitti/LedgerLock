import { ApiProperty } from '@nestjs/swagger';
import { ApiKeyCreatedResponseDto } from '../../auth/dto/api-key-response.dto';

export class TenantResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty() createdAt!: string;
}

/**
 * Returned only from tenant provisioning. Bundles the new tenant with its
 * automatically created first API key — there is no other way to obtain
 * a first key for a brand-new tenant, since every other API-key endpoint
 * requires an API key to already exist (see AUTH_BOOTSTRAP note in
 * tenants.controller.ts).
 */
export class TenantProvisionResponseDto {
  @ApiProperty({ type: TenantResponseDto }) tenant!: TenantResponseDto;
  @ApiProperty({ type: ApiKeyCreatedResponseDto }) apiKey!: ApiKeyCreatedResponseDto;
}
