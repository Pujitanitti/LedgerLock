import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTenantDto } from './create-tenant.dto';

describe('CreateTenantDto', () => {
  it('accepts a valid slug and name', async () => {
    const instance = plainToInstance(CreateTenantDto, { slug: 'acme-corp', name: 'Acme Corp' });
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toHaveLength(0);
  });

  it.each(['Acme', 'acme_corp', 'acme corp', 'acme--corp', '-acme', 'acme-', 'A'])(
    'rejects an invalid slug: %s',
    async (slug) => {
      const instance = plainToInstance(CreateTenantDto, { slug, name: 'Acme' });
      const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
      expect(errors.some((e) => e.property === 'slug')).toBe(true);
    },
  );

  it('rejects an attempt to client-supply an id or authzVersion at creation time', async () => {
    const instance = plainToInstance(CreateTenantDto, {
      slug: 'acme',
      name: 'Acme',
      id: 'tenant_attacker_controlled',
      authzVersion: 999,
    });
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.some((e) => e.property === 'id')).toBe(true);
    expect(errors.some((e) => e.property === 'authzVersion')).toBe(true);
  });

  it('rejects a missing name', async () => {
    const instance = plainToInstance(CreateTenantDto, { slug: 'acme' });
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });
});
