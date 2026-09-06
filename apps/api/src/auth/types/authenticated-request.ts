import type { Request } from 'express';

/** The authenticated tenant, resolved exclusively from a verified API key. */
export interface AuthenticatedTenant {
  id: string;
}

/**
 * Request shape after ApiKeyGuard has run. `tenant` is set ONLY by the
 * guard, never by any DTO or query param — this is the type-level half of
 * the "client-supplied tenantId can never override the authenticated
 * tenant" invariant. Controllers must obtain the tenant via @CurrentTenant()
 * (which reads this field), never from the request body.
 */
export type AuthenticatedRequest = Request & {
  tenant: AuthenticatedTenant;
  apiKeyId: string;
};
