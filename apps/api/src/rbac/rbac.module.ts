import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { AuthzVersionModule } from '../authorization/authz-version/authz-version.module';
import { RolesController } from './roles.controller';
import { PermissionsController } from './permissions.controller';
import { UserRolesController } from './user-roles.controller';
import { RolesService } from './roles.service';
import { PermissionsService } from './permissions.service';
import { RoleAssignmentsService } from './role-assignments.service';
import { RoleHierarchyService } from './role-hierarchy.service';
import { RBAC_REPOSITORY } from './repositories/rbac-repository.port';
import { PrismaRbacRepository } from './repositories/prisma-rbac.repository';

@Module({
  imports: [AuthModule, UsersModule, AuthzVersionModule],
  controllers: [RolesController, PermissionsController, UserRolesController],
  providers: [
    RolesService,
    PermissionsService,
    RoleAssignmentsService,
    RoleHierarchyService,
    { provide: RBAC_REPOSITORY, useClass: PrismaRbacRepository },
  ],
  exports: [RolesService, PermissionsService, RBAC_REPOSITORY],
})
export class RbacModule {}
