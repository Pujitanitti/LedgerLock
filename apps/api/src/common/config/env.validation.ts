import { Type, plainToInstance } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';

class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV = 'development';

  // Explicit @Type(() => Number) rather than relying on
  // enableImplicitConversion's reflected design:type metadata — that
  // metadata emission depends on the TS compiler/loader configuration
  // picking up emitDecoratorMetadata consistently, which isn't guaranteed
  // across ts-node/ts-jest/tsc. Being explicit here removes that fragility
  // for a check that gates whether the app boots at all.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3000;

  @IsString()
  DATABASE_URL!: string;

  @IsString()
  REDIS_URL!: string;

  @IsString()
  API_KEY_HMAC_PEPPER!: string;

  /**
   * R-003 fix: optional previous pepper, checked ONLY when verifying an
   * existing key's hash — never used to hash a newly created key. This is
   * what makes pepper rotation possible without invalidating every
   * existing API key the instant the pepper changes: during a rotation
   * window, set this to the outgoing pepper's value alongside the new
   * current one; once every real key has been re-issued (or the
   * transition window has safely elapsed), remove this variable entirely.
   * See ADR-006 and ApiKeyService.authenticate.
   */
  @IsOptional()
  @IsString()
  API_KEY_HMAC_PEPPER_PREVIOUS?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  AUTHZ_CACHE_TTL_SECONDS = 60;
}

/**
 * Ledger-Lock refuses to start with an invalid or incomplete configuration
 * rather than booting into an undefined state — e.g. a missing
 * API_KEY_HMAC_PEPPER must never silently fall back to an empty string.
 */
export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const details = errors
      .map((e) => Object.values(e.constraints ?? {}).join(', '))
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return validated;
}
