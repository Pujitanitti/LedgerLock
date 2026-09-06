import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Metadata-only view of an API key. Structurally has no `secretHash` and
 * no raw-secret field at all — there is no way to accidentally serialize
 * either, because the type doesn't carry them, not because a mapper
 * remembered to strip them.
 */
export class ApiKeyMetadataResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'Non-secret lookup identifier; safe to display.' }) publicId!: string;
  @ApiPropertyOptional({ nullable: true }) revokedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) expiresAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) lastUsedAt!: string | null;
  @ApiProperty() createdAt!: string;
}

/**
 * Returned ONLY from the creation endpoint. `rawKey` is the one and only
 * place in the entire API surface where the plaintext secret ever appears
 * in a response.
 */
export class ApiKeyCreatedResponseDto extends ApiKeyMetadataResponseDto {
  @ApiProperty({ description: 'The full API key secret. Shown once — it cannot be retrieved again.' })
  rawKey!: string;
}
