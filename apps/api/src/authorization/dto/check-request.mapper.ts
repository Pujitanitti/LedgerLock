import { BadRequestException } from '@nestjs/common';
import type { CheckRequestDto } from './check-request.dto';
import type { CheckRequestInput, ResourceContext } from '../decision-engine/types';

/**
 * `resource` is intentionally validated only at the DTO layer as "is an
 * object" (see CheckRequestDto) so arbitrary future attributes pass
 * through untouched. This function enforces the one real structural
 * requirement — `type` and `id` must be present strings if `resource` is
 * given at all — without constraining anything else about its shape.
 */
export function toCheckRequestInput(dto: CheckRequestDto): CheckRequestInput {
  return {
    userId: dto.userId,
    action: dto.action,
    resource: parseResource(dto.resource),
    context: dto.context,
  };
}

/**
 * FIX (final audit M-1): `raw` is typed as `Record<string, unknown> |
 * undefined` by the DTO, but class-validator's `@IsOptional()` treats a
 * literal JSON `null` the same as `undefined` — it skips `@IsObject()`
 * entirely — so a request body of `{"resource": null, ...}` passes DTO
 * validation with `dto.resource` actually equal to `null` at runtime, not
 * `undefined`. The original `raw === undefined` check alone let a `null`
 * value fall through to `raw.type`, throwing an unhandled TypeError
 * (caught only by the generic 500 branch of AllExceptionsFilter).
 *
 * Treating `resource: null` the same as an omitted resource (rather than
 * rejecting it as a validation error) is the smaller, more consistent
 * fix: `context: null` already behaves this way today via
 * attribute-resolver.ts's `!bag` check, and "the caller explicitly said
 * there is no resource" is a reasonable reading of an explicit `null`,
 * not obviously an error the way a malformed non-null object would be.
 * A non-null but structurally invalid resource (missing type/id, wrong
 * types) is still rejected exactly as before — this fix does not weaken
 * or bypass any existing validation.
 */
function parseResource(raw: Record<string, unknown> | undefined | null): ResourceContext | undefined {
  if (raw === undefined || raw === null) return undefined;

  if (typeof raw.type !== 'string' || raw.type.length === 0) {
    throw new BadRequestException({
      code: 'INVALID_RESOURCE',
      message: 'resource.type is required and must be a non-empty string when resource is provided.',
    });
  }
  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    throw new BadRequestException({
      code: 'INVALID_RESOURCE',
      message: 'resource.id is required and must be a non-empty string when resource is provided.',
    });
  }
  if (raw.tenantId !== undefined && typeof raw.tenantId !== 'string') {
    throw new BadRequestException({
      code: 'INVALID_RESOURCE',
      message: 'resource.tenantId must be a string when provided.',
    });
  }

  return raw as ResourceContext;
}
