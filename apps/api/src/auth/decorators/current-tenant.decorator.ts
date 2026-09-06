import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest, AuthenticatedTenant } from '../types/authenticated-request';

/**
 * Injects the tenant resolved by ApiKeyGuard. There is deliberately no
 * parameter or option to select a different tenant — this decorator only
 * ever reads what the guard attached to the request, which is itself only
 * ever derived from the verified API key. A controller using this
 * decorator has no code path available to substitute a client-supplied
 * tenantId, because it never receives one from here in the first place.
 */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedTenant => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.tenant) {
      // Indicates a route used @CurrentTenant() without being behind
      // ApiKeyGuard — a wiring bug to catch in review/tests, not a
      // client-triggerable condition.
      throw new Error('@CurrentTenant() used on a route not protected by ApiKeyGuard');
    }
    return request.tenant;
  },
);
