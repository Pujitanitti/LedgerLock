import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ApiKeyService } from '../services/api-key.service';
import { InvalidApiKeyError, MissingApiKeyError } from '../errors/auth.errors';
import type { AuthenticatedRequest } from '../types/authenticated-request';

const BEARER_SCHEME = 'Bearer';

/**
 * The entire authentication flow required by section 3 of the spec lives
 * across this guard + ApiKeyService.authenticate:
 *
 *   extract header -> validate scheme -> ApiKeyService.authenticate
 *   (parse -> lookup -> verify hash -> check status) -> attach tenant
 *
 * This guard itself does no parsing, hashing, or DB access — it is a thin
 * HTTP-layer adapter, kept deliberately dumb so the actual security logic
 * lives in one place (ApiKeyService) and is testable independent of Nest's
 * request/response plumbing.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.header('authorization');

    if (!header) {
      throw new MissingApiKeyError();
    }

    const [scheme, token] = header.split(' ');
    if (scheme !== BEARER_SCHEME || !token) {
      throw new InvalidApiKeyError();
    }

    const result = await this.apiKeyService.authenticate(token);

    const authenticatedRequest = request as AuthenticatedRequest;
    authenticatedRequest.tenant = { id: result.tenantId };
    authenticatedRequest.apiKeyId = result.apiKeyId;

    return true;
  }
}
