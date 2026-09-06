import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DecisionEngineService } from './decision-engine/decision-engine.service';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { RequestId } from '../common/decorators/request-id.decorator';
import type { AuthenticatedTenant } from '../auth/types/authenticated-request';
import { CheckRequestDto } from './dto/check-request.dto';
import { CheckBatchRequestDto } from './dto/check-batch-request.dto';
import { CheckBatchResponseDto, CheckResponseDto } from './dto/check-response.dto';
import { toCheckRequestInput } from './dto/check-request.mapper';

@ApiTags('authorization')
@ApiBearerAuth('bearer')
@UseGuards(ApiKeyGuard)
@Controller({ path: 'check', version: '1' })
export class AuthorizationController {
  constructor(private readonly decisionEngine: DecisionEngineService) {}

  @Post()
  @ApiOperation({ summary: 'Can this user perform this action (optionally on this resource)?' })
  @ApiResponse({ status: 200, type: CheckResponseDto })
  async check(
    @CurrentTenant() tenant: AuthenticatedTenant,
    @Body() dto: CheckRequestDto,
    @RequestId() requestId: string,
  ): Promise<CheckResponseDto> {
    return this.decisionEngine.evaluate(tenant.id, toCheckRequestInput(dto), requestId);
  }

  @Post('batch')
  @ApiOperation({ summary: 'Evaluate multiple authorization checks in one request.' })
  @ApiResponse({ status: 200, type: CheckBatchResponseDto })
  @ApiResponse({ status: 400, description: 'Batch exceeds the maximum allowed size, or a request is malformed.' })
  async checkBatch(
    @CurrentTenant() tenant: AuthenticatedTenant,
    @Body() dto: CheckBatchRequestDto,
    @RequestId() requestId: string,
  ): Promise<CheckBatchResponseDto> {
    const inputs = dto.checks.map(toCheckRequestInput);
    const results = await this.decisionEngine.evaluateBatch(tenant.id, inputs, requestId);
    return { results };
  }
}
