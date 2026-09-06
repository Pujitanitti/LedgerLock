import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetPolicyEnabledDto {
  @ApiProperty({ example: false })
  @IsBoolean()
  enabled!: boolean;
}
