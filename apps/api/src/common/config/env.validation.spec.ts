import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const validConfig = {
    NODE_ENV: 'development',
    PORT: '3000',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    API_KEY_HMAC_PEPPER: 'a-sufficiently-long-pepper-value',
  };

  it('accepts a valid, complete configuration', () => {
    expect(() => validateEnv(validConfig)).not.toThrow();
  });

  it('applies defaults for optional fields', () => {
    const result = validateEnv(validConfig);
    expect(result.AUTHZ_CACHE_TTL_SECONDS).toBe(60);
    expect(result.PORT).toBe(3000);
  });

  it('rejects a missing DATABASE_URL rather than defaulting silently', () => {
    const { DATABASE_URL: _omit, ...rest } = validConfig;
    expect(() => validateEnv(rest)).toThrow(/Invalid environment configuration/);
  });

  it('rejects a missing API_KEY_HMAC_PEPPER rather than defaulting to empty', () => {
    const { API_KEY_HMAC_PEPPER: _omit, ...rest } = validConfig;
    expect(() => validateEnv(rest)).toThrow(/Invalid environment configuration/);
  });

  it('rejects an invalid NODE_ENV value', () => {
    expect(() => validateEnv({ ...validConfig, NODE_ENV: 'staging-typo' })).toThrow();
  });

  it('rejects a PORT outside the valid range', () => {
    expect(() => validateEnv({ ...validConfig, PORT: '70000' })).toThrow();
  });

  it('accepts a config with no API_KEY_HMAC_PEPPER_PREVIOUS (the normal, non-rotating case)', () => {
    const result = validateEnv(validConfig);
    expect(result.API_KEY_HMAC_PEPPER_PREVIOUS).toBeUndefined();
  });

  it('accepts an API_KEY_HMAC_PEPPER_PREVIOUS during a rotation window', () => {
    const result = validateEnv({ ...validConfig, API_KEY_HMAC_PEPPER_PREVIOUS: 'the-old-pepper-value' });
    expect(result.API_KEY_HMAC_PEPPER_PREVIOUS).toBe('the-old-pepper-value');
  });
});
