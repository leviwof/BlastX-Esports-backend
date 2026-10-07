import { ForbiddenException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  it('preserves an explicitly shaped error response', () => {
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ method: 'POST', url: '/v1/tournaments/tour-1/register' }),
      }),
    };
    const exception = new ForbiddenException({
      status: 'error',
      error_code: 'NON_LEADER_REGISTRATION_FORBIDDEN',
      message: 'please ask team leader to register the tournament',
    });

    new AllExceptionsFilter().catch(exception, host as any);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({
      status: 'error',
      error_code: 'NON_LEADER_REGISTRATION_FORBIDDEN',
      message: 'please ask team leader to register the tournament',
    });
  });
});
