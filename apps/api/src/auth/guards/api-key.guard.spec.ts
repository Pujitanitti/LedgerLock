import { ExecutionContext } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeyService } from '../services/api-key.service';
import { InvalidApiKeyError, MissingApiKeyError, RevokedApiKeyError } from '../errors/auth.errors';
import type { AuthenticatedRequest } from '../types/authenticated-request';

function makeContext(headers: Record<string, string | undefined>): {
  context: ExecutionContext;
  request: Record<string, unknown>;
} {
  const request: Record<string, unknown> = {
    header: (name: string) => headers[name.toLowerCase()],
  };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
  return { context, request };
}

function makeService(): jest.Mocked<Pick<ApiKeyService, 'authenticate'>> {
  return { authenticate: jest.fn() };
}

describe('ApiKeyGuard', () => {
  it('throws MissingApiKeyError when no Authorization header is present', async () => {
    const service = makeService();
    const guard = new ApiKeyGuard(service as unknown as ApiKeyService);
    const { context } = makeContext({});

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(MissingApiKeyError);
    expect(service.authenticate).not.toHaveBeenCalled();
  });

  it('throws InvalidApiKeyError for a non-Bearer scheme', async () => {
    const service = makeService();
    const guard = new ApiKeyGuard(service as unknown as ApiKeyService);
    const { context } = makeContext({ authorization: 'Basic dXNlcjpwYXNz' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(InvalidApiKeyError);
    expect(service.authenticate).not.toHaveBeenCalled();
  });

  it('throws InvalidApiKeyError when Bearer scheme has no token', async () => {
    const service = makeService();
    const guard = new ApiKeyGuard(service as unknown as ApiKeyService);
    const { context } = makeContext({ authorization: 'Bearer' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(InvalidApiKeyError);
  });

  it('delegates the extracted token to ApiKeyService.authenticate', async () => {
    const service = makeService();
    service.authenticate.mockResolvedValue({ tenantId: 't1', apiKeyId: 'k1' });
    const guard = new ApiKeyGuard(service as unknown as ApiKeyService);
    const { context } = makeContext({ authorization: 'Bearer ll_live_abcdef0123456789_somesecret' });

    await guard.canActivate(context);

    expect(service.authenticate).toHaveBeenCalledWith('ll_live_abcdef0123456789_somesecret');
  });

  it('attaches the authenticated tenant and apiKeyId to the request on success', async () => {
    const service = makeService();
    service.authenticate.mockResolvedValue({ tenantId: 'tenant_acme', apiKeyId: 'key_123' });
    const guard = new ApiKeyGuard(service as unknown as ApiKeyService);
    const { context, request } = makeContext({ authorization: 'Bearer ll_live_abcdef0123456789_x' });

    const allowed = await guard.canActivate(context);

    expect(allowed).toBe(true);
    const authRequest = request as unknown as AuthenticatedRequest;
    expect(authRequest.tenant).toEqual({ id: 'tenant_acme' });
    expect(authRequest.apiKeyId).toBe('key_123');
  });

  it('propagates a RevokedApiKeyError from the service without attaching any tenant', async () => {
    const service = makeService();
    service.authenticate.mockRejectedValue(new RevokedApiKeyError());
    const guard = new ApiKeyGuard(service as unknown as ApiKeyService);
    const { context, request } = makeContext({ authorization: 'Bearer ll_live_abcdef0123456789_x' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(RevokedApiKeyError);
    expect((request as Partial<AuthenticatedRequest>).tenant).toBeUndefined();
  });
});
