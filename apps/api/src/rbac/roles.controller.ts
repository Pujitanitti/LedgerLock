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
import { RolesService } from './roles.service';
import { RoleAssignmentsService } from './role-assignments.service';
import { RoleHierarchyService } from './role-hierarchy.service';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import type { AuthenticatedTenant } from '../auth/types/authenticated-request';
import { AddInheritanceDto, AssignPermissionDto, CreateRoleDto } from './dto/rbac-request.dto';
import { RoleResponseDto, toRoleResponse } from './dto/rbac-response.dto';

@ApiTags('roles')
@ApiBearerAuth('bearer')
@UseGuards(ApiKeyGuard)
@Controller({ path: 'roles', version: '1' })
export class RolesController {
  constructor(
    private readonly rolesService: RolesService,
    private readonly assignments: RoleAssignmentsService,
    private readonly hierarchy: RoleHierarchyService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a role.' })
  @ApiResponse({ status: 201, type: RoleResponseDto })
  async create(@CurrentTenant() tenant: AuthenticatedTenant, @Body() dto: CreateRoleDto): Promise<RoleResponseDto> {
    const role = await this.rolesService.create(tenant.id, dto.name);
    return toRoleResponse(role);
  }

  @Get()
  @ApiOperation({ summary: 'List roles.' })
  @ApiResponse({ status: 200, type: [RoleResponseDto] })
  async list(@CurrentTenant() tenant: AuthenticatedTenant): Promise<RoleResponseDto[]> {
    const roles = await this.rolesService.list(tenant.id);
    return roles.map(toRoleResponse);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a role by ID.' })
  @ApiResponse({ status: 200, type: RoleResponseDto })
  @ApiResponse({ status: 404, description: 'Not found, or belongs to a different tenant.' })
  async getById(
    @CurrentTenant() tenant: AuthenticatedTenant,
    @Param('id') id: string,
  ): Promise<RoleResponseDto> {
    const role = await this.rolesService.getById(tenant.id, id);
    return toRoleResponse(role);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a role. Cascades to its permission/user assignments and inheritance edges.' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, description: 'Not found, or belongs to a different tenant.' })
  async delete(@CurrentTenant() tenant: AuthenticatedTenant, @Param('id') id: string): Promise<void> {
    await this.rolesService.delete(tenant.id, id);
  }

  @Post(':id/permissions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Grant a permission to this role.' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, description: 'Role or permission not found for this tenant.' })
  async assignPermission(
    @CurrentTenant() tenant: AuthenticatedTenant,
    @Param('id') roleId: string,
    @Body() dto: AssignPermissionDto,
  ): Promise<void> {
    await this.assignments.assignPermissionToRole(tenant.id, roleId, dto.permissionId);
  }

  @Delete(':id/permissions/:permissionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a permission from this role.' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, description: 'Role or permission not found for this tenant.' })
  async removePermission(
    @CurrentTenant() tenant: AuthenticatedTenant,
    @Param('id') roleId: string,
    @Param('permissionId') permissionId: string,
  ): Promise<void> {
    await this.assignments.removePermissionFromRole(tenant.id, roleId, permissionId);
  }

  @Post(':id/inherit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Make this role inherit permissions from another role.' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, description: 'One of the roles was not found for this tenant.' })
  @ApiResponse({ status: 409, description: 'This edge would create a cycle in the role hierarchy.' })
  async addInheritance(
    @CurrentTenant() tenant: AuthenticatedTenant,
    @Param('id') childRoleId: string,
    @Body() dto: AddInheritanceDto,
  ): Promise<void> {
    await this.hierarchy.addInheritance(tenant.id, dto.parentRoleId, childRoleId);
  }
}
