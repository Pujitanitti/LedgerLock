import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { USER_REPOSITORY, type UserRepositoryPort } from './repositories/user-repository.port';
import type { CreateUserInput, UserRecord } from './types/user-record';

@Injectable()
export class UsersService {
  constructor(@Inject(USER_REPOSITORY) private readonly repository: UserRepositoryPort) {}

  async create(tenantId: string, externalId: string, attributes?: Record<string, unknown>): Promise<UserRecord> {
    const existing = await this.repository.findByExternalId(tenantId, externalId);
    if (existing) {
      throw new ConflictException({
        code: 'USER_ALREADY_EXISTS',
        message: 'A user with this externalId already exists for this tenant.',
      });
    }
    const input: CreateUserInput = { tenantId, externalId, attributes };
    return this.repository.create(input);
  }

  async getById(tenantId: string, id: string): Promise<UserRecord> {
    const user = await this.repository.findById(tenantId, id);
    if (!user) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' });
    }
    return user;
  }

  async list(tenantId: string): Promise<UserRecord[]> {
    return this.repository.list(tenantId);
  }
}
