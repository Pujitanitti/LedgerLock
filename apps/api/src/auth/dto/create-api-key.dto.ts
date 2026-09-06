import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateApiKeyDto {
  @ApiProperty({ example: 'CI pipeline key', description: 'A human-readable label for this key.' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({
    example: '2027-01-01T00:00:00.000Z',
    description: 'Optional ISO-8601 expiration timestamp. Omit for a key that never expires.',
  })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  // Deliberately no `tenantId` field. Global ValidationPipe is configured
  // with { whitelist: true, forbidNonWhitelisted: true } (see main.ts), so
  // a client that includes a `tenantId` in the request body gets a 400,
  // not a silently-ignored field and never a substituted tenant — see
  // create-api-key.dto.spec.ts for a direct test of this.
}
