import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { InvalidApiKeyError, RevokedApiKeyError } from '../../auth/errors/auth.errors';

function makeHost(requestId = 'req_test123'): { host: ArgumentsHost; json: jest.Mock; status: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ requestId }),
    }),
  } as unknown as ArgumentsHost;
  return { host, json, status };
}

describe('AllExceptionsFilter', () => {
  it('uses the explicit code carried by a typed domain error, not a generic status mapping', () => {
    const filter = new AllExceptionsFilter();
    const { host, json, status } = makeHost();

    filter.catch(new RevokedApiKeyError(), host);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'REVOKED_API_KEY',
        message: 'This API key has been revoked.',
        requestId: 'req_test123',
      },
    });
  });

  it('falls back to a generic status-derived code for exceptions with no explicit code', () => {
    const filter = new AllExceptionsFilter();
    const { host, json } = makeHost();

    filter.catch(new BadRequestException('field X is required'), host);

    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'BAD_REQUEST',
        message: 'field X is required',
        requestId: 'req_test123',
      },
    });
  });

  it('never leaks internal details for an unknown/unhandled exception', () => {
    const filter = new AllExceptionsFilter();
    const { host, json, status } = makeHost();

    filter.catch(new Error('connection refused at 10.0.0.5:5432 password=hunter2'), host);

    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0];
    expect(body.error.message).not.toContain('10.0.0.5');
    expect(body.error.message).not.toContain('hunter2');
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('distinguishes different typed errors by their own codes', () => {
    const filter = new AllExceptionsFilter();
    const { host: host1, json: json1 } = makeHost();
    const { host: host2, json: json2 } = makeHost();

    filter.catch(new InvalidApiKeyError(), host1);
    filter.catch(new RevokedApiKeyError(), host2);

    expect(json1.mock.calls[0][0].error.code).toBe('INVALID_API_KEY');
    expect(json2.mock.calls[0][0].error.code).toBe('REVOKED_API_KEY');
  });
});
