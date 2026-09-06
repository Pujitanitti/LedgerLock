import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ValidateNested } from 'class-validator';
import { CheckRequestDto } from './check-request.dto';
import { MAX_BATCH_SIZE } from '../decision-engine/decision-engine.service';

export class CheckBatchRequestDto {
  @ApiProperty({ type: [CheckRequestDto], maxItems: MAX_BATCH_SIZE, minItems: 1 })
  @ValidateNested({ each: true })
  @Type(() => CheckRequestDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BATCH_SIZE)
  checks!: CheckRequestDto[];
}
