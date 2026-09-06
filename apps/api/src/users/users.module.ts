import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { USER_REPOSITORY } from './repositories/user-repository.port';
import { PrismaUserRepository } from './repositories/prisma-user.repository';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService, { provide: USER_REPOSITORY, useClass: PrismaUserRepository }],
  exports: [UsersService, USER_REPOSITORY],
})
export class UsersModule {}
