import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Reads the correlation ID attached by RequestIdMiddleware (set on every
 * request before any guard/controller runs — see main.ts). Used by the
 * audit pipeline so every AuditLog row can be traced back to the exact
 * request that produced it, without threading requestId through every
 * intermediate function signature manually in every controller.
 */
export const RequestId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<Request & { requestId?: string }>();
  return request.requestId ?? 'unknown';
});
