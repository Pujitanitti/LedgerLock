import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import type { AuthenticatedTenant } from '../auth/types/authenticated-request';
import { CreateUserDto } from './dto/create-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { toUserResponse } from './dto/user-response.mapper';

@ApiTags('users')
@ApiBearerAuth('bearer')
@UseGuards(ApiKeyGuard)
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @ApiOperation({ summary: 'Register an end-user of your application with Ledger-Lock.' })
  @ApiResponse({ status: 201, type: UserResponseDto })
  async create(
    @CurrentTenant() tenant: AuthenticatedTenant,
    @Body() dto: CreateUserDto,
  ): Promise<UserResponseDto> {
    const user = await this.usersService.create(tenant.id, dto.externalId, dto.attributes);
    return toUserResponse(user);
  }

  @Get()
  @ApiOperation({ summary: "List the authenticated tenant's registered users." })
  @ApiResponse({ status: 200, type: [UserResponseDto] })
  async list(@CurrentTenant() tenant: AuthenticatedTenant): Promise<UserResponseDto[]> {
    const users = await this.usersService.list(tenant.id);
    return users.map(toUserResponse);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single user by Ledger-Lock ID.' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({ status: 404, description: 'Not found, or belongs to a different tenant.' })
  async getById(
    @CurrentTenant() tenant: AuthenticatedTenant,
    @Param('id') id: string,
  ): Promise<UserResponseDto> {
    const user = await this.usersService.getById(tenant.id, id);
    return toUserResponse(user);
  }
}
