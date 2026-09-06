import { BadRequestException } from '@nestjs/common';
import { toCheckRequestInput } from './check-request.mapper';
import type { CheckRequestDto } from './check-request.dto';

describe('toCheckRequestInput', () => {
  it('maps a request with no resource', () => {
    const dto: CheckRequestDto = { userId: 'ext_1', action: 'projects:read' };
    expect(toCheckRequestInput(dto)).toEqual({ userId: 'ext_1', action: 'projects:read', resource: undefined });
  });

  it('maps a valid resource, preserving extra forward-compatible attributes untouched', () => {
    const dto: CheckRequestDto = {
      userId: 'ext_1',
      action: 'invoices:update',
      resource: { type: 'invoice', id: 'inv_1', tenantId: 'tenant_a', ownerId: 'ext_1' },
    };
    expect(toCheckRequestInput(dto).resource).toEqual({
      type: 'invoice',
      id: 'inv_1',
      tenantId: 'tenant_a',
      ownerId: 'ext_1',
    });
  });

  it('throws BadRequestException when resource.type is missing', () => {
    const dto: CheckRequestDto = { userId: 'ext_1', action: 'x:read', resource: { id: 'r1' } };
    expect(() => toCheckRequestInput(dto)).toThrow(BadRequestException);
  });

  it('throws BadRequestException when resource.id is missing', () => {
    const dto: CheckRequestDto = { userId: 'ext_1', action: 'x:read', resource: { type: 'thing' } };
    expect(() => toCheckRequestInput(dto)).toThrow(BadRequestException);
  });

  it('throws BadRequestException when resource.type is not a string', () => {
    const dto: CheckRequestDto = {
      userId: 'ext_1',
      action: 'x:read',
      resource: { type: 123, id: 'r1' } as unknown as Record<string, unknown>,
    };
    expect(() => toCheckRequestInput(dto)).toThrow(BadRequestException);
  });

  it('throws BadRequestException when resource.tenantId is present but not a string', () => {
    const dto: CheckRequestDto = {
      userId: 'ext_1',
      action: 'x:read',
      resource: { type: 'thing', id: 'r1', tenantId: 42 } as unknown as Record<string, unknown>,
    };
    expect(() => toCheckRequestInput(dto)).toThrow(BadRequestException);
  });

  it('accepts a resource with no tenantId at all', () => {
    const dto: CheckRequestDto = { userId: 'ext_1', action: 'x:read', resource: { type: 'thing', id: 'r1' } };
    expect(() => toCheckRequestInput(dto)).not.toThrow();
  });

  describe('M-1 regression: resource: null', () => {
    it('does NOT throw when resource is explicitly null', () => {
      // class-validator's @IsOptional() lets a literal JSON `null` through
      // untouched (dto.resource ends up === null, not undefined) — this
      // must never reach the unhandled `raw.type` property access that
      // previously threw an unhandled TypeError here.
      const dto = { userId: 'ext_1', action: 'x:read', resource: null } as unknown as CheckRequestDto;
      expect(() => toCheckRequestInput(dto)).not.toThrow();
    });

    it('treats resource: null identically to resource omitted entirely', () => {
      const withNull = { userId: 'ext_1', action: 'x:read', resource: null } as unknown as CheckRequestDto;
      const omitted: CheckRequestDto = { userId: 'ext_1', action: 'x:read' };

      expect(toCheckRequestInput(withNull)).toEqual(toCheckRequestInput(omitted));
      expect(toCheckRequestInput(withNull).resource).toBeUndefined();
    });

    it('still correctly rejects a non-null, structurally invalid resource after the fix', () => {
      // Confirms the fix didn't weaken validation for real malformed input —
      // only the `null` case changed behavior.
      const dto: CheckRequestDto = { userId: 'ext_1', action: 'x:read', resource: { id: 'r1' } };
      expect(() => toCheckRequestInput(dto)).toThrow(BadRequestException);
    });

    it('still correctly parses a valid resource after the fix', () => {
      const dto: CheckRequestDto = {
        userId: 'ext_1',
        action: 'x:read',
        resource: { type: 'invoice', id: 'inv_1' },
      };
      expect(toCheckRequestInput(dto).resource).toEqual({ type: 'invoice', id: 'inv_1' });
    });
  });
});
