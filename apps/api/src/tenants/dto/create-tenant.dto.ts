import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateTenantDto {
  @ApiProperty({
    example: 'acme',
    description: 'Lowercase, hyphen-separated identifier. Immutable once created.',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(63)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase alphanumeric segments separated by single hyphens',
  })
  slug!: string;

  @ApiProperty({ example: 'Acme Inc.' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;
}
