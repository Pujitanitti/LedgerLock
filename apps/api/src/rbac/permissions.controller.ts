import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PermissionsService } from './permissions.service';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import type { AuthenticatedTenant } from '../auth/types/authenticated-request';
import { CreatePermissionDto } from './dto/rbac-request.dto';
import { PermissionResponseDto, toPermissionResponse } from './dto/rbac-response.dto';

@ApiTags('permissions')
@ApiBearerAuth('bearer')
@UseGuards(ApiKeyGuard)
@Controller({ path: 'permissions', version: '1' })
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Post()
  @ApiOperation({ summary: 'Create (or idempotently fetch) a permission by its resource:action string.' })
  @ApiResponse({ status: 201, type: PermissionResponseDto })
  async create(
    @CurrentTenant() tenant: AuthenticatedTenant,
    @Body() dto: CreatePermissionDto,
  ): Promise<PermissionResponseDto> {
    const permission = await this.permissionsService.createOrGet(tenant.id, dto.action);
    return toPermissionResponse(permission);
  }

  @Get()
  @ApiOperation({ summary: 'List permissions.' })
  @ApiResponse({ status: 200, type: [PermissionResponseDto] })
  async list(@CurrentTenant() tenant: AuthenticatedTenant): Promise<PermissionResponseDto[]> {
    const permissions = await this.permissionsService.list(tenant.id);
    return permissions.map(toPermissionResponse);
  }
}
