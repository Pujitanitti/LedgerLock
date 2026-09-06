import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PoliciesService } from './policies.service';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import type { AuthenticatedTenant } from '../auth/types/authenticated-request';
import { CreatePolicyDto, UpdatePolicyContentDto } from './dto/policy-request.dto';
import { SetPolicyEnabledDto } from './dto/set-policy-enabled.dto';
import {
  PolicyResponseDto,
  PolicyVersionResponseDto,
  PolicyWithVersionResponseDto,
  toPolicyResponse,
  toPolicyVersionResponse,
} from './dto/policy-response.dto';

@ApiTags('policies')
@ApiBearerAuth('bearer')
@UseGuards(ApiKeyGuard)
@Controller({ path: 'policies', version: '1' })
export class PoliciesController {
  constructor(private readonly policiesService: PoliciesService) {}

  @Post()
  @ApiOperation({ summary: 'Create an ABAC policy (creates version 1).' })
  @ApiResponse({ status: 201, type: PolicyWithVersionResponseDto })
  @ApiResponse({ status: 409, description: 'A policy with this name already exists for this tenant.' })
  @ApiResponse({ status: 400, description: 'Malformed condition(s) — see the error message for detail.' })
  async create(
    @CurrentTenant() tenant: AuthenticatedTenant,
    @Body() dto: CreatePolicyDto,
  ): Promise<PolicyWithVersionResponseDto> {
    const { policy, currentVersion } = await this.policiesService.create(tenant.id, dto);
    return { policy: toPolicyResponse(policy), currentVersion: toPolicyVersionResponse(currentVersion) };
  }

  @Get()
  @ApiOperation({ summary: 'List policies.' })
  @ApiResponse({ status: 200, type: [PolicyResponseDto] })
  async list(@CurrentTenant() tenant: AuthenticatedTenant): Promise<PolicyResponseDto[]> {
    const policies = await this.policiesService.list(tenant.id);
    return policies.map(toPolicyResponse);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a policy by ID.' })
  @ApiResponse({ status: 200, type: PolicyResponseDto })
  @ApiResponse({ status: 404, description: 'Not found, or belongs to a different tenant.' })
  async getById(
    @CurrentTenant() tenant: AuthenticatedTenant,
    @Param('id') id: string,
  ): Promise<PolicyResponseDto> {
    const policy = await this.policiesService.getById(tenant.id, id);
    return toPolicyResponse(policy);
  }

  @Get(':id/versions')
  @ApiOperation({ summary: 'Get the full immutable version history for a policy.' })
  @ApiResponse({ status: 200, type: [PolicyVersionResponseDto] })
  @ApiResponse({ status: 404, description: 'Not found, or belongs to a different tenant.' })
  async getVersionHistory(
    @CurrentTenant() tenant: AuthenticatedTenant,
    @Param('id') id: string,
  ): Promise<PolicyVersionResponseDto[]> {
    const versions = await this.policiesService.getVersionHistory(tenant.id, id);
    return versions.map(toPolicyVersionResponse);
  }

  @Get(':id/versions/current')
  @ApiOperation({ summary: 'Get the currently active version of a policy.' })
  @ApiResponse({ status: 200, type: PolicyVersionResponseDto })
  @ApiResponse({ status: 404, description: 'Not found, or belongs to a different tenant.' })
  async getCurrentVersion(
    @CurrentTenant() tenant: AuthenticatedTenant,
    @Param('id') id: string,
  ): Promise<PolicyVersionResponseDto> {
    const version = await this.policiesService.getCurrentVersion(tenant.id, id);
    return toPolicyVersionResponse(version);
  }

  @Post(':id/versions')
  @ApiOperation({
    summary: 'Create a new version of this policy. NEVER overwrites the current version — always inserts.',
  })
  @ApiResponse({ status: 201, type: PolicyVersionResponseDto })
  @ApiResponse({ status: 404, description: 'Not found, or belongs to a different tenant.' })
  @ApiResponse({ status: 400, description: 'Malformed condition(s).' })
  async update(
    @CurrentTenant() tenant: AuthenticatedTenant,
    @Param('id') id: string,
    @Body() dto: UpdatePolicyContentDto,
  ): Promise<PolicyVersionResponseDto> {
    const version = await this.policiesService.update(tenant.id, id, dto);
    return toPolicyVersionResponse(version);
  }

  @Patch(':id/enabled')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Enable or disable a policy. Disabled policies never influence decisions.' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, description: 'Not found, or belongs to a different tenant.' })
  async setEnabled(
    @CurrentTenant() tenant: AuthenticatedTenant,
    @Param('id') id: string,
    @Body() dto: SetPolicyEnabledDto,
  ): Promise<void> {
    await this.policiesService.setEnabled(tenant.id, id, dto.enabled);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a policy and its entire version history.' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, description: 'Not found, or belongs to a different tenant.' })
  async delete(@CurrentTenant() tenant: AuthenticatedTenant, @Param('id') id: string): Promise<void> {
    await this.policiesService.delete(tenant.id, id);
  }
}
