import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = isHttp ? exception.getResponse() : null;
    let message: string;
    let errorCode: string | undefined;

    if (typeof payload === 'object' && payload !== null) {
      const p = payload as any;
      if (Array.isArray(p.message)) {
        message = p.message.join(', ');
      } else if (typeof p.message === 'string') {
        message = p.message;
      } else if (p.error && typeof p.error === 'object' && typeof p.error.message === 'string') {
        message = p.error.message;
      } else {
        message = isHttp ? exception.message : 'Internal server error';
      }

      if (typeof p.code === 'string') {
        errorCode = p.code;
      } else if (p.error && typeof p.error === 'object' && typeof p.error.code === 'string') {
        errorCode = p.error.code;
      }
    } else {
      message = isHttp ? exception.message : 'Internal server error';
    }

    if (!errorCode) {
      if (status === HttpStatus.UNAUTHORIZED) {
        errorCode = 'UNAUTHORIZED';
      } else if (status === HttpStatus.NOT_FOUND) {
        errorCode = 'NOT_FOUND';
      } else if (status === HttpStatus.BAD_REQUEST) {
        errorCode = 'BAD_REQUEST';
      } else if (status === HttpStatus.CONFLICT) {
        errorCode = 'CONFLICT';
      } else if (status >= 500) {
        errorCode = 'INTERNAL_SERVER_ERROR';
      }
    }

    if (!isHttp || status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} [${status}]: ${
          exception instanceof Error ? exception.stack : String(exception)
        }`,
      );
    }

    if (
      typeof payload === 'object' &&
      payload !== null &&
      (payload as any).status === 'error' &&
      typeof (payload as any).error_code === 'string' &&
      typeof (payload as any).message === 'string'
    ) {
      response.status(status).json({
        status: 'error',
        error_code: (payload as any).error_code,
        message: (payload as any).message,
      });
      return;
    }

    const responseBody: any = {
      success: false,
      status: 'error',
      message,
    };

    if (errorCode) {
      responseBody.code = errorCode;
      responseBody.error = {
        code: errorCode,
        message,
      };
    }

    // Preserve safe, client-actionable metadata from explicitly constructed
    // HTTP errors (for example the room-credential release timestamp).
    if (typeof payload === 'object' && payload !== null && typeof (payload as any).reveal_at === 'string') {
      responseBody.reveal_at = (payload as any).reveal_at;
    }

    response.status(status).json(responseBody);
  }
}
