import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * `conditions` is deliberately typed as `unknown` here rather than
 * validated by class-validator decorators — it's validated by
 * validateConditions() (authorization/conditions/condition-validator.ts)
 * inside PoliciesService instead, since that validator already encodes
 * the exact structural rules (field format, operator whitelist, value
 * shape) and duplicating that as class-validator decorators would mean
 * maintaining the same rules in two places.
 */
export class CreatePolicyDto {
  @ApiProperty({ example: 'finance-invoice-ownership' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ example: 'Finance department can update invoices they own.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ enum: ['allow', 'deny'] })
  @IsIn(['allow', 'deny'])
  effect!: 'allow' | 'deny';

  @ApiProperty({ example: ['invoices:update'], description: '"resource:action" patterns, or "*".' })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  actions!: string[];

  @ApiProperty({ example: ['invoice'], description: 'Resource type patterns, or "*".' })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  resourceTypes!: string[];

  @ApiProperty({
    example: [{ field: 'resource.ownerId', operator: 'equals', value: { ref: 'subject.id' } }],
    description: 'Array of Condition objects. See ADR-009 for the full operator/field grammar.',
  })
  conditions!: unknown;

  @ApiPropertyOptional({ example: 0, description: 'Tiebreaker for provenance only — see ADR-010.' })
  @IsOptional()
  @IsInt()
  priority?: number;
}

/** Same content shape as create — used for the "new version" endpoint. */
export class UpdatePolicyContentDto {
  @ApiProperty({ enum: ['allow', 'deny'] })
  @IsIn(['allow', 'deny'])
  effect!: 'allow' | 'deny';

  @ApiProperty({ example: ['invoices:update'] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  actions!: string[];

  @ApiProperty({ example: ['invoice'] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  resourceTypes!: string[];

  @ApiProperty()
  conditions!: unknown;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  priority?: number;
}
