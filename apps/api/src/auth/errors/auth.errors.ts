import { NotFoundException, UnauthorizedException } from '@nestjs/common';

interface ErrorPayload {
  code: string;
  message: string;
}

/**
 * Base for authentication failures. All subclasses carry a stable `code`
 * that AllExceptionsFilter surfaces directly in the API error response
 * (see section 13 of the spec) instead of a generic status-derived code.
 */
abstract class AuthenticationError extends UnauthorizedException {
  protected constructor(payload: ErrorPayload) {
    super(payload);
  }
}

export class MissingApiKeyError extends AuthenticationError {
  constructor() {
    super({ code: 'MISSING_API_KEY', message: 'An API key is required.' });
  }
}

/**
 * Deliberately used for EVERY case that could otherwise reveal whether a
 * given key exists: malformed format, unknown publicId, and a wrong
 * secret for a real publicId all produce this exact same error. Splitting
 * these into distinct errors would let an attacker distinguish "no such
 * key" from "wrong secret", turning authentication into an oracle for
 * enumerating valid publicIds.
 */
export class InvalidApiKeyError extends AuthenticationError {
  constructor() {
    super({ code: 'INVALID_API_KEY', message: 'The API key is invalid.' });
  }
}

/**
 * Unlike InvalidApiKeyError, it's safe to be specific here: the caller
 * already possesses the actual secret (they're not enumerating), so
 * confirming "this exact key was revoked" leaks nothing about other keys
 * and helps them know to rotate rather than assume a transient failure.
 */
export class RevokedApiKeyError extends AuthenticationError {
  constructor() {
    super({ code: 'REVOKED_API_KEY', message: 'This API key has been revoked.' });
  }
}

export class ExpiredApiKeyError extends AuthenticationError {
  constructor() {
    super({ code: 'EXPIRED_API_KEY', message: 'This API key has expired.' });
  }
}

/**
 * Used when a tenant references an API key that doesn't belong to it
 * (e.g. revoking another tenant's key by ID). Returns 404, not 403 —
 * confirming existence via a 403 would itself leak that the ID belongs to
 * *some* tenant, just not this one.
 */
export class ApiKeyNotFoundError extends NotFoundException {
  constructor() {
    super({ code: 'API_KEY_NOT_FOUND', message: 'API key not found.' });
  }
}
