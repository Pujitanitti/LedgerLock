import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RoleAssignmentsService } from './role-assignments.service';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import type { AuthenticatedTenant } from '../auth/types/authenticated-request';
import { AssignRoleDto } from './dto/rbac-request.dto';

@ApiTags('user-roles')
@ApiBearerAuth('bearer')
@UseGuards(ApiKeyGuard)
@Controller({ path: 'users/:userId/roles', version: '1' })
export class UserRolesController {
  constructor(private readonly assignments: RoleAssignmentsService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Assign a role to a user.' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, description: 'User or role not found for this tenant.' })
  async assign(
    @CurrentTenant() tenant: AuthenticatedTenant,
    @Param('userId') userId: string,
    @Body() dto: AssignRoleDto,
  ): Promise<void> {
    await this.assignments.assignRoleToUser(tenant.id, userId, dto.roleId);
  }

  @Delete(':roleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a role from a user.' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, description: 'User or role not found for this tenant.' })
  async remove(
    @CurrentTenant() tenant: AuthenticatedTenant,
    @Param('userId') userId: string,
    @Param('roleId') roleId: string,
  ): Promise<void> {
    await this.assignments.removeRoleFromUser(tenant.id, userId, roleId);
  }
}
