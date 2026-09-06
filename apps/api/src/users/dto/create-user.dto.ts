import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({
    example: 'user_123',
    description: "The identifier YOUR application uses for this user. Never Ledger-Lock's own ID.",
  })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  externalId!: string;

  @ApiPropertyOptional({
    example: { department: 'finance' },
    description: 'Arbitrary attributes reserved for future ABAC policy evaluation (Phase 5). Not evaluated yet.',
  })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  // No tenantId field — see the same enforcement pattern documented in
  // auth/dto/create-api-key.dto.ts.
}
