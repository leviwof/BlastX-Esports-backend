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

    const responseBody: any = {
      success: false,
      status: 'error',
      message,
    };

    if (errorCode) {
      responseBody.error = {
        code: errorCode,
        message,
      };
    }

    response.status(status).json(responseBody);
  }
}
