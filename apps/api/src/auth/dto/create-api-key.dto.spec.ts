import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateApiKeyDto } from './create-api-key.dto';

/**
 * `forbidNonWhitelisted: true` on the global ValidationPipe (see main.ts)
 * is what actually closes the "client sends tenantId in the body" vector.
 * This test exercises that exact validation configuration directly
 * against the DTO, independent of a full Nest HTTP bootstrap, to prove
 * the vector is closed at the input layer — not just "the code never
 * reads req.body.tenantId", but "the request is rejected outright before
 * a handler ever sees it".
 */
describe('CreateApiKeyDto — tenantId injection is rejected', () => {
  it('accepts a valid payload with only the documented fields', async () => {
    const instance = plainToInstance(CreateApiKeyDto, { name: 'CI key' });
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toHaveLength(0);
  });

  it('rejects a payload that includes a client-supplied tenantId', async () => {
    const instance = plainToInstance(CreateApiKeyDto, {
      name: 'CI key',
      tenantId: 'tenant_someone_elses',
    });
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });

    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'tenantId')).toBe(true);
  });

  it('rejects a payload with any other unexpected extra field the same way', async () => {
    const instance = plainToInstance(CreateApiKeyDto, { name: 'CI key', role: 'admin' });
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.some((e) => e.property === 'role')).toBe(true);
  });

  it('rejects a missing name', async () => {
    const instance = plainToInstance(CreateApiKeyDto, {});
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('rejects a non-ISO8601 expiresAt', async () => {
    const instance = plainToInstance(CreateApiKeyDto, { name: 'k', expiresAt: 'not-a-date' });
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.some((e) => e.property === 'expiresAt')).toBe(true);
  });

  it('accepts a valid ISO8601 expiresAt', async () => {
    const instance = plainToInstance(CreateApiKeyDto, {
      name: 'k',
      expiresAt: '2027-01-01T00:00:00.000Z',
    });
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toHaveLength(0);
  });
});
