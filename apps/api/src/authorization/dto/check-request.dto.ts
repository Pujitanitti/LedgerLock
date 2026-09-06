import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CheckRequestDto {
  @ApiProperty({
    example: 'user_123',
    description: "The end-user's ID in YOUR system (matches User.externalId).",
  })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  userId!: string;

  @ApiProperty({ example: 'projects:delete', description: 'resource:action format.' })
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/, {
    message: 'action must be in "resource:action" format, e.g. "projects:delete"',
  })
  action!: string;

  @ApiPropertyOptional({
    example: { type: 'project', id: 'proj_456', tenantId: 'tenant_acme' },
    description:
      'Optional resource context. `type` and `id` are required if provided; `tenantId` is checked ' +
      'against the authenticated tenant. Additional attributes are accepted but not yet evaluated ' +
      '(reserved for Phase 5 ABAC policies) — this object is deliberately NOT strictly whitelisted ' +
      'so those future fields are forward-compatible.',
  })
  @IsOptional()
  @IsObject()
  resource?: Record<string, unknown>;

  @ApiPropertyOptional({
    example: { ip: '1.2.3.4' },
    description:
      'Optional request context (IP, etc.), available to ABAC policy conditions as "context.*". ' +
      'Same forward-compatible, non-whitelisted shape as `resource`.',
  })
  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}
