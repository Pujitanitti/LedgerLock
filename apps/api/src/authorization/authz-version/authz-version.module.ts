import { Module } from '@nestjs/common';
import { TenantsModule } from '../../tenants/tenants.module';
import { UsersModule } from '../../users/users.module';
import { AuthzVersionService } from './authz-version.service';

@Module({
  imports: [TenantsModule, UsersModule],
  providers: [AuthzVersionService],
  exports: [AuthzVersionService],
})
export class AuthzVersionModule {}
