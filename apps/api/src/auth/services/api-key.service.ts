import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  generateApiKey,
  hashApiKeySecret,
  parseRawApiKey,
  verifyApiKeySecretAgainstPeppers,
} from '../crypto/api-key-crypto';
import { evaluateApiKeyStatus } from '../policies/api-key-status.policy';
import {
  ApiKeyNotFoundError,
  ExpiredApiKeyError,
  InvalidApiKeyError,
  RevokedApiKeyError,
} from '../errors/auth.errors';
import { API_KEY_REPOSITORY, type ApiKeyRepositoryPort } from '../repositories/api-key-repository.port';
import type { ApiKeyRecord } from '../types/api-key-record';

export interface AuthenticationResult {
  tenantId: string;
  apiKeyId: string;
}

export interface CreateApiKeyInput {
  name: string;
  /** ISO-8601 string, already validated by the DTO layer. */
  expiresAt?: string;
}

export interface CreatedApiKey {
  record: ApiKeyRecord;
  /** The full secret — present ONLY on this return value, never again. */
  rawKey: string;
}

/**
 * Note on the raw-key lifecycle: `rawKey` above and inside `authenticate`'s
 * local variables are the only places the plaintext secret exists in this
 * service. It is never logged (no logger call in this file ever receives
 * `rawKey`, `secret`, or `token`) and is never included in anything
 * persisted via ApiKeyRepositoryPort.create, which only accepts a
 * `secretHash`.
 */
@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);

  constructor(
    @Inject(API_KEY_REPOSITORY) private readonly repository: ApiKeyRepositoryPort,
    private readonly config: ConfigService,
  ) {}

  /**
   * Authenticates a raw presented API key end-to-end:
   * parse -> indexed lookup -> constant-time hash verification -> status
   * check. Every failure path throws a typed error; there is no code path
   * that returns a "maybe allowed" or falls through to an implicit allow —
   * see the throws below and ApiKeyGuard, which does nothing but attach
   * the result to the request.
   */
  async authenticate(rawKey: string): Promise<AuthenticationResult> {
    const parsed = parseRawApiKey(rawKey);
    if (!parsed) {
      throw new InvalidApiKeyError();
    }

    const record = await this.repository.findByPublicId(parsed.publicId);
    if (!record) {
      // Same error as a hash mismatch below — see InvalidApiKeyError's
      // doc comment on why these two cases must be indistinguishable.
      throw new InvalidApiKeyError();
    }

    const pepper = this.config.getOrThrow<string>('API_KEY_HMAC_PEPPER');
    const previousPepper = this.config.get<string | undefined>('API_KEY_HMAC_PEPPER_PREVIOUS');
    // R-003 fix: verification tries the current pepper first, then the
    // previous one if configured — this is what lets an operator rotate
    // the pepper without instantly invalidating every existing key. See
    // ApiKeyService.createForTenant below: creation NEVER uses this
    // multi-pepper list, only the single current pepper, so a newly
    // issued key is always hashed under the pepper that's meant to be
    // current going forward, never the outgoing one.
    const peppers = previousPepper ? [pepper, previousPepper] : [pepper];
    if (!verifyApiKeySecretAgainstPeppers(parsed.secret, record.secretHash, peppers)) {
      throw new InvalidApiKeyError();
    }

    const status = evaluateApiKeyStatus(record);
    if (status === 'revoked') {
      throw new RevokedApiKeyError();
    }
    if (status === 'expired') {
      throw new ExpiredApiKeyError();
    }

    // Best-effort — usage tracking must never be able to affect or delay
    // the authentication decision itself, which has already been made.
    this.repository.touchLastUsed(record.id).catch((err: unknown) => {
      this.logger.warn(`Failed to update lastUsedAt for API key ${record.id}: ${String(err)}`);
    });

    return { tenantId: record.tenantId, apiKeyId: record.id };
  }

  async createForTenant(tenantId: string, input: CreateApiKeyInput): Promise<CreatedApiKey> {
    const pepper = this.config.getOrThrow<string>('API_KEY_HMAC_PEPPER');
    const generated = generateApiKey();
    const secretHash = hashApiKeySecret(generated.secret, pepper);

    const record = await this.repository.create({
      tenantId,
      publicId: generated.publicId,
      secretHash,
      name: input.name,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    });

    return { record, rawKey: generated.raw };
  }

  async listForTenant(tenantId: string): Promise<ApiKeyRecord[]> {
    return this.repository.listByTenant(tenantId);
  }

  async revokeForTenant(tenantId: string, apiKeyId: string): Promise<void> {
    const record = await this.repository.findByIdForTenant(apiKeyId, tenantId);
    if (!record) {
      // Covers both "doesn't exist" and "belongs to another tenant" —
      // deliberately the same outcome; see ApiKeyNotFoundError.
      throw new ApiKeyNotFoundError();
    }
    await this.repository.revoke(record.id);
  }
}
