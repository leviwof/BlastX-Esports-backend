import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { healthStatus } from './common/health-status';
import { PrismaService } from './prisma/prisma.service';

describe('AppController', () => {
  let appController: AppController;
  const prisma = { ping: jest.fn().mockResolvedValue(true) };

  beforeEach(async () => {
    prisma.ping.mockReset();
    prisma.ping.mockResolvedValue(true);
    healthStatus.redis = true;

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  it('returns the BlastiX greeting', () => {
    expect(appController.getHello()).toBe('Hello BlastiX Esports!');
  });

  it('reports dependency status from /health', async () => {
    await expect(appController.health()).resolves.toMatchObject({
      healthy: true,
      db: true,
      redis: true,
    });
  });

  it('still answers /health when the database is down', async () => {
    prisma.ping.mockResolvedValueOnce(false);
    healthStatus.redis = false;

    await expect(appController.health()).resolves.toMatchObject({
      healthy: true,
      db: false,
      redis: false,
    });
  });
});
