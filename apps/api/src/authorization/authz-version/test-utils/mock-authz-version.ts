import type { AuthzVersionService } from '../authz-version.service';

export function makeMockAuthzVersion(
  overrides: Partial<jest.Mocked<AuthzVersionService>> = {},
): jest.Mocked<AuthzVersionService> {
  return {
    bumpTenant: jest.fn().mockResolvedValue(undefined),
    bumpUser: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as jest.Mocked<AuthzVersionService>;
}
