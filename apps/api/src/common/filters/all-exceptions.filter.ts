import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}

/**
 * Single place where every thrown error is converted into the public error
 * shape from the API spec. This is the enforcement point for "never expose
 * stack traces / SQL errors / Redis details / secrets / filesystem paths" —
 * no controller or service is trusted to redact this itself.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();
    const requestId = request.requestId ?? 'unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred.';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      // Prefer an explicit `code` set by a typed domain error (e.g.
      // RevokedApiKeyError) over the generic status-derived mapping, so
      // callers get a stable, specific machine-readable code rather than
      // a coarse "UNAUTHENTICATED" for every 401.
      const explicitCode = typeof res === 'object' && res !== null ? (res as { code?: unknown }).code : undefined;
      code = typeof explicitCode === 'string' ? explicitCode : httpStatusToCode(status);
      message =
        typeof res === 'string'
          ? res
          : Array.isArray((res as { message?: unknown }).message)
            ? ((res as { message: string[] }).message.join('; '))
            : ((res as { message?: string }).message ?? exception.message);
    } else {
      // Unknown/unhandled errors (Prisma, Redis, etc.) are logged in full
      // server-side, but the client only ever sees a generic message.
      this.logger.error(
        `Unhandled exception [requestId=${requestId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorBody = { error: { code, message, requestId } };
    response.status(status).json(body);
  }
}

function httpStatusToCode(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'BAD_REQUEST';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHENTICATED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'RATE_LIMITED';
    default:
      return 'INTERNAL_ERROR';
  }
}
