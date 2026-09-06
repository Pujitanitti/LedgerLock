import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() externalId!: string;
  @ApiPropertyOptional({ nullable: true, type: Object }) attributes!: Record<string, unknown> | null;
  @ApiProperty() createdAt!: string;
}
