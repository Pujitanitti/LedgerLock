import { Module } from '@nestjs/common';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeyService } from './services/api-key.service';
import { ApiKeyGuard } from './guards/api-key.guard';
import { API_KEY_REPOSITORY } from './repositories/api-key-repository.port';
import { PrismaApiKeyRepository } from './repositories/prisma-api-key.repository';

@Module({
  controllers: [ApiKeysController],
  providers: [
    ApiKeyService,
    ApiKeyGuard,
    { provide: API_KEY_REPOSITORY, useClass: PrismaApiKeyRepository },
  ],
  // Exported so TenantsModule's provisioning flow can reuse the same
  // ApiKeyService/crypto logic when creating a tenant's first key, and so
  // ApiKeyGuard can be reused by future modules (Phase 4+) without
  // reimplementing authentication.
  exports: [ApiKeyService, ApiKeyGuard],
})
export class AuthModule {}
