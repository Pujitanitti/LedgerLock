import { ConfigService } from '@nestjs/config';
import { ApiKeyService } from './api-key.service';
import type { ApiKeyRepositoryPort } from '../repositories/api-key-repository.port';
import type { ApiKeyRecord } from '../types/api-key-record';
import { generateApiKey, hashApiKeySecret, parseRawApiKey } from '../crypto/api-key-crypto';
import {
  ApiKeyNotFoundError,
  ExpiredApiKeyError,
  InvalidApiKeyError,
  RevokedApiKeyError,
} from '../errors/auth.errors';

const PEPPER = 'test-pepper-value';

function makeConfigService(previousPepper?: string): ConfigService {
  return {
    getOrThrow: jest.fn().mockReturnValue(PEPPER),
    get: jest.fn().mockReturnValue(previousPepper),
  } as unknown as ConfigService;
}

function makeRecord(overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
  return {
    id: 'key_1',
    tenantId: 'tenant_a',
    publicId: '0'.repeat(16),
    secretHash: '',
    name: 'test key',
    revokedAt: null,
    expiresAt: null,
    lastUsedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeRepository(overrides: Partial<jest.Mocked<ApiKeyRepositoryPort>> = {}): jest.Mocked<ApiKeyRepositoryPort> {
  return {
    create: jest.fn(),
    findByPublicId: jest.fn(),
    findByIdForTenant: jest.fn(),
    listByTenant: jest.fn(),
    revoke: jest.fn(),
    touchLastUsed: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as jest.Mocked<ApiKeyRepositoryPort>;
}

describe('ApiKeyService.authenticate', () => {
  it('authenticates a valid, active key and returns its tenant', async () => {
    const generated = generateApiKey();
    const record = makeRecord({
      publicId: generated.publicId,
      secretHash: hashApiKeySecret(generated.secret, PEPPER),
      tenantId: 'tenant_acme',
    });
    const repo = makeRepository({ findByPublicId: jest.fn().mockResolvedValue(record) });
    const service = new ApiKeyService(repo, makeConfigService());

    const result = await service.authenticate(generated.raw);

    expect(result).toEqual({ tenantId: 'tenant_acme', apiKeyId: 'key_1' });
  });

  it('touches lastUsedAt as a side effect of successful authentication', async () => {
    const generated = generateApiKey();
    const record = makeRecord({
      publicId: generated.publicId,
      secretHash: hashApiKeySecret(generated.secret, PEPPER),
    });
    const repo = makeRepository({ findByPublicId: jest.fn().mockResolvedValue(record) });
    const service = new ApiKeyService(repo, makeConfigService());

    await service.authenticate(generated.raw);

    expect(repo.touchLastUsed).toHaveBeenCalledWith('key_1');
  });

  it('rejects a malformed raw key with InvalidApiKeyError', async () => {
    const repo = makeRepository();
    const service = new ApiKeyService(repo, makeConfigService());

    await expect(service.authenticate('not-a-real-key')).rejects.toBeInstanceOf(InvalidApiKeyError);
    expect(repo.findByPublicId).not.toHaveBeenCalled();
  });

  it('rejects an unknown publicId with InvalidApiKeyError (not a distinct "not found" error)', async () => {
    const generated = generateApiKey();
    const repo = makeRepository({ findByPublicId: jest.fn().mockResolvedValue(null) });
    const service = new ApiKeyService(repo, makeConfigService());

    await expect(service.authenticate(generated.raw)).rejects.toBeInstanceOf(InvalidApiKeyError);
  });

  it('rejects a correct publicId with a wrong secret using the SAME error as an unknown key', async () => {
    const generatedWithWrongSecret = generateApiKey();
    const recordWithDifferentSecret = makeRecord({
      publicId: generatedWithWrongSecret.publicId,
      secretHash: hashApiKeySecret('a-completely-different-secret', PEPPER),
    });
    const repoForWrongSecret = makeRepository({
      findByPublicId: jest.fn().mockResolvedValue(recordWithDifferentSecret),
    });
    const serviceForWrongSecret = new ApiKeyService(repoForWrongSecret, makeConfigService());

    const repoForUnknownKey = makeRepository({ findByPublicId: jest.fn().mockResolvedValue(null) });
    const serviceForUnknownKey = new ApiKeyService(repoForUnknownKey, makeConfigService());

    const unknownKeyError = await serviceForUnknownKey
      .authenticate(generateApiKey().raw)
      .catch((e: unknown) => e);
    const wrongSecretError = await serviceForWrongSecret
      .authenticate(generatedWithWrongSecret.raw)
      .catch((e: unknown) => e);

    expect(wrongSecretError).toBeInstanceOf(InvalidApiKeyError);
    expect(unknownKeyError).toBeInstanceOf(InvalidApiKeyError);
    expect((wrongSecretError as InvalidApiKeyError).getResponse()).toEqual(
      (unknownKeyError as InvalidApiKeyError).getResponse(),
    );
  });

  it('rejects a revoked key with RevokedApiKeyError', async () => {
    const generated = generateApiKey();
    const record = makeRecord({
      publicId: generated.publicId,
      secretHash: hashApiKeySecret(generated.secret, PEPPER),
      revokedAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    const repo = makeRepository({ findByPublicId: jest.fn().mockResolvedValue(record) });
    const service = new ApiKeyService(repo, makeConfigService());

    await expect(service.authenticate(generated.raw)).rejects.toBeInstanceOf(RevokedApiKeyError);
  });

  it('rejects an expired key with ExpiredApiKeyError', async () => {
    const generated = generateApiKey();
    const record = makeRecord({
      publicId: generated.publicId,
      secretHash: hashApiKeySecret(generated.secret, PEPPER),
      expiresAt: new Date('2020-01-01T00:00:00.000Z'),
    });
    const repo = makeRepository({ findByPublicId: jest.fn().mockResolvedValue(record) });
    const service = new ApiKeyService(repo, makeConfigService());

    await expect(service.authenticate(generated.raw)).rejects.toBeInstanceOf(ExpiredApiKeyError);
  });

  it('does not authenticate a revoked key even if it is also unexpired', async () => {
    const generated = generateApiKey();
    const record = makeRecord({
      publicId: generated.publicId,
      secretHash: hashApiKeySecret(generated.secret, PEPPER),
      revokedAt: new Date('2026-01-02T00:00:00.000Z'),
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    });
    const repo = makeRepository({ findByPublicId: jest.fn().mockResolvedValue(record) });
    const service = new ApiKeyService(repo, makeConfigService());

    await expect(service.authenticate(generated.raw)).rejects.toBeInstanceOf(RevokedApiKeyError);
  });

  it('never logs the raw secret, even when authentication fails', async () => {
    const generated = generateApiKey();
    const repo = makeRepository({ findByPublicId: jest.fn().mockResolvedValue(null) });
    const service = new ApiKeyService(repo, makeConfigService());

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await service.authenticate(generated.raw).catch(() => undefined);

    const allLoggedText = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .map((arg) => String(arg))
      .join('\n');

    expect(allLoggedText).not.toContain(generated.secret);
    expect(allLoggedText).not.toContain(generated.raw);

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe('ApiKeyService.createForTenant', () => {
  it('creates a key whose stored hash matches the returned raw key, hashed with the configured pepper', async () => {
    const repo = makeRepository({
      create: jest.fn().mockImplementation((input) =>
        Promise.resolve(makeRecord({ ...input, id: 'key_new' })),
      ),
    });
    const service = new ApiKeyService(repo, makeConfigService());

    const { record, rawKey } = await service.createForTenant('tenant_acme', { name: 'CI key' });

    const parsed = parseRawApiKey(rawKey);
    expect(parsed).not.toBeNull();
    expect(hashApiKeySecret(parsed!.secret, PEPPER)).toBe(record.secretHash);
  });

  it('never passes the raw secret to the repository — only its hash', async () => {
    const repo = makeRepository({
      create: jest.fn().mockImplementation((input) => Promise.resolve(makeRecord(input))),
    });
    const service = new ApiKeyService(repo, makeConfigService());

    const { rawKey } = await service.createForTenant('tenant_acme', { name: 'CI key' });

    const createCallArgs = repo.create.mock.calls[0][0];
    const serializedArgs = JSON.stringify(createCallArgs);
    const parsed = parseRawApiKey(rawKey);
    expect(parsed).not.toBeNull();
    expect(serializedArgs).not.toContain(parsed!.secret);
    expect(Object.keys(createCallArgs)).not.toContain('secret');
    expect(Object.keys(createCallArgs)).not.toContain('rawKey');
  });

  it('scopes the created key to the requested tenant', async () => {
    const repo = makeRepository({
      create: jest.fn().mockImplementation((input) => Promise.resolve(makeRecord(input))),
    });
    const service = new ApiKeyService(repo, makeConfigService());

    await service.createForTenant('tenant_globex', { name: 'key' });

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant_globex' }));
  });

  it('parses an optional expiresAt into a Date, and omits it (null) when not given', async () => {
    const repo = makeRepository({
      create: jest.fn().mockImplementation((input) => Promise.resolve(makeRecord(input))),
    });
    const service = new ApiKeyService(repo, makeConfigService());

    await service.createForTenant('tenant_acme', { name: 'k1' });
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ expiresAt: null }));

    await service.createForTenant('tenant_acme', { name: 'k2', expiresAt: '2027-01-01T00:00:00.000Z' });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAt: new Date('2027-01-01T00:00:00.000Z') }),
    );
  });
});

describe('ApiKeyService.listForTenant', () => {
  it('delegates directly to the repository, scoped by tenant', async () => {
    const records = [makeRecord({ id: 'k1' }), makeRecord({ id: 'k2' })];
    const repo = makeRepository({ listByTenant: jest.fn().mockResolvedValue(records) });
    const service = new ApiKeyService(repo, makeConfigService());

    const result = await service.listForTenant('tenant_acme');

    expect(repo.listByTenant).toHaveBeenCalledWith('tenant_acme');
    expect(result).toBe(records);
  });
});

describe('ApiKeyService.revokeForTenant — tenant isolation', () => {
  it('revokes a key that belongs to the requesting tenant', async () => {
    const record = makeRecord({ id: 'key_1', tenantId: 'tenant_a' });
    const repo = makeRepository({ findByIdForTenant: jest.fn().mockResolvedValue(record) });
    const service = new ApiKeyService(repo, makeConfigService());

    await service.revokeForTenant('tenant_a', 'key_1');

    expect(repo.findByIdForTenant).toHaveBeenCalledWith('key_1', 'tenant_a');
    expect(repo.revoke).toHaveBeenCalledWith('key_1');
  });

  it('SECURITY: refuses to revoke a key belonging to a different tenant', async () => {
    // Simulates the real repository's WHERE id=? AND tenantId=? returning
    // no row when tenant_b tries to touch tenant_a's key by ID.
    const repo = makeRepository({ findByIdForTenant: jest.fn().mockResolvedValue(null) });
    const service = new ApiKeyService(repo, makeConfigService());

    await expect(service.revokeForTenant('tenant_b', 'key_belonging_to_tenant_a')).rejects.toBeInstanceOf(
      ApiKeyNotFoundError,
    );
    expect(repo.revoke).not.toHaveBeenCalled();
  });

  it('throws ApiKeyNotFoundError (404-shaped), not a 403, for a cross-tenant attempt', async () => {
    const repo = makeRepository({ findByIdForTenant: jest.fn().mockResolvedValue(null) });
    const service = new ApiKeyService(repo, makeConfigService());

    const error = await service.revokeForTenant('tenant_b', 'someone_elses_key').catch((e: unknown) => e);
    expect((error as ApiKeyNotFoundError).getStatus()).toBe(404);
  });
});

describe('ApiKeyService.authenticate — pepper rotation (R-003)', () => {
  const NEW_PEPPER = PEPPER;
  const OLD_PEPPER = 'the-outgoing-pepper';

  it('still authenticates a key hashed under the OLD pepper when the previous pepper is configured', async () => {
    const generated = generateApiKey();
    const record = makeRecord({
      publicId: generated.publicId,
      secretHash: hashApiKeySecret(generated.secret, OLD_PEPPER),
    });
    const repo = makeRepository({ findByPublicId: jest.fn().mockResolvedValue(record) });
    const service = new ApiKeyService(repo, makeConfigService(OLD_PEPPER));

    const result = await service.authenticate(generated.raw);

    expect(result).toEqual({ tenantId: record.tenantId, apiKeyId: record.id });
  });

  it('still authenticates a key hashed under the NEW pepper when a previous pepper is also configured', async () => {
    const generated = generateApiKey();
    const record = makeRecord({
      publicId: generated.publicId,
      secretHash: hashApiKeySecret(generated.secret, NEW_PEPPER),
    });
    const repo = makeRepository({ findByPublicId: jest.fn().mockResolvedValue(record) });
    const service = new ApiKeyService(repo, makeConfigService(OLD_PEPPER));

    const result = await service.authenticate(generated.raw);

    expect(result).toEqual({ tenantId: record.tenantId, apiKeyId: record.id });
  });

  it('rejects a key hashed under the old pepper once rotation is complete and no previous pepper is configured', async () => {
    const generated = generateApiKey();
    const record = makeRecord({
      publicId: generated.publicId,
      secretHash: hashApiKeySecret(generated.secret, OLD_PEPPER),
    });
    const repo = makeRepository({ findByPublicId: jest.fn().mockResolvedValue(record) });
    const service = new ApiKeyService(repo, makeConfigService(undefined));

    await expect(service.authenticate(generated.raw)).rejects.toBeInstanceOf(InvalidApiKeyError);
  });

  it('newly created keys are ALWAYS hashed with only the current pepper, never the previous one', async () => {
    const repo = makeRepository({
      create: jest.fn().mockImplementation((input) => Promise.resolve(makeRecord(input))),
    });
    const service = new ApiKeyService(repo, makeConfigService(OLD_PEPPER));

    const { record, rawKey } = await service.createForTenant('tenant_a', { name: 'new key' });

    const parsedSecret = parseRawApiKey(rawKey);
    expect(parsedSecret).not.toBeNull();
    expect(hashApiKeySecret(parsedSecret!.secret, NEW_PEPPER)).toBe(record.secretHash);
    expect(hashApiKeySecret(parsedSecret!.secret, OLD_PEPPER)).not.toBe(record.secretHash);
  });
});
