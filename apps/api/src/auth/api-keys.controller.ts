import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiKeyService } from './services/api-key.service';
import { ApiKeyGuard } from './guards/api-key.guard';
import { CurrentTenant } from './decorators/current-tenant.decorator';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { ApiKeyCreatedResponseDto, ApiKeyMetadataResponseDto } from './dto/api-key-response.dto';
import { toApiKeyCreatedResponse, toApiKeyMetadataResponse } from './dto/api-key-response.mapper';
import type { AuthenticatedTenant } from './types/authenticated-request';

/**
 * Every route here is behind ApiKeyGuard and every service call is scoped
 * with @CurrentTenant() — there is no endpoint in this controller that
 * accepts a tenantId from the client in any form (body, query, or path
 * param). This is intentional: it removes the substitution vector
 * entirely rather than relying on a check to catch it.
 */
@ApiTags('api-keys')
@ApiBearerAuth('bearer')
@UseGuards(ApiKeyGuard)
@Controller({ path: 'api-keys', version: '1' })
export class ApiKeysController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new API key for the authenticated tenant.' })
  @ApiResponse({ status: 201, type: ApiKeyCreatedResponseDto })
  async create(
    @CurrentTenant() tenant: AuthenticatedTenant,
    @Body() dto: CreateApiKeyDto,
  ): Promise<ApiKeyCreatedResponseDto> {
    const { record, rawKey } = await this.apiKeyService.createForTenant(tenant.id, dto);
    return toApiKeyCreatedResponse(record, rawKey);
  }

  @Get()
  @ApiOperation({ summary: "List the authenticated tenant's API keys (metadata only)." })
  @ApiResponse({ status: 200, type: [ApiKeyMetadataResponseDto] })
  async list(@CurrentTenant() tenant: AuthenticatedTenant): Promise<ApiKeyMetadataResponseDto[]> {
    const records = await this.apiKeyService.listForTenant(tenant.id);
    return records.map(toApiKeyMetadataResponse);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Revoke one of the authenticated tenant's API keys." })
  @ApiResponse({ status: 204, description: 'Revoked.' })
  @ApiResponse({ status: 404, description: 'Not found, or belongs to a different tenant.' })
  async revoke(
    @CurrentTenant() tenant: AuthenticatedTenant,
    @Param('id') id: string,
  ): Promise<void> {
    await this.apiKeyService.revokeForTenant(tenant.id, id);
  }
}
