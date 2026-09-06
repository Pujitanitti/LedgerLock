import { ApiProperty } from '@nestjs/swagger';

export class CheckResponseDto {
  @ApiProperty() allowed!: boolean;
  @ApiProperty({
    enum: ['unknown_user', 'resource_tenant_mismatch', 'role_permission', 'no_matching_permission'],
  })
  reason!: string;
}

export class CheckBatchResponseDto {
  @ApiProperty({ type: [CheckResponseDto] })
  results!: CheckResponseDto[];
}
