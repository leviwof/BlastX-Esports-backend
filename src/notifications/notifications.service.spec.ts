import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service';

jest.mock('@nestjs/event-emitter', () => ({
  OnEvent: () => () => undefined,
}));
jest.mock('@nestjs/config', () => ({
  ConfigService: class ConfigService {},
}));
jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));
jest.mock('firebase-admin/app', () => ({
  cert: jest.fn(),
  getApps: jest.fn(() => []),
  initializeApp: jest.fn(),
}));
jest.mock('firebase-admin/messaging', () => ({
  getMessaging: jest.fn(),
}));

import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  const userUpdate = jest.fn();
  const prisma = {
    user: {
      update: userUpdate,
      findMany: jest.fn(),
    },
  } as unknown as PrismaService;
  const config = {
    get: jest.fn().mockReturnValue(undefined),
  } as unknown as ConfigService;
  let service: NotificationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotificationsService(prisma, config);
  });

  it('stores an authenticated user device token and platform', async () => {
    userUpdate.mockResolvedValue({});

    await expect(
      service.registerFcmToken('user-1', 'test-device-token', 'android'),
    ).resolves.toEqual({
      status: true,
      message: 'FCM Token updated successfully',
    });

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        fcmToken: 'test-device-token',
        fcmUpdatedAt: expect.any(Date),
        deviceType: 'android',
      },
    });
  });

  it('does not pretend a broadcast was sent without Firebase configured', async () => {
    await expect(service.broadcast({ title: 'Notice', body: 'Message' })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
