import { UsersService } from './users.service';
import { UserRole, RegistrationStatus } from '@prisma/client';

describe('Users Profile Stats & Game Profile Service', () => {
  let service: UsersService;
  let mockPrisma: any;

  const mockUser = {
    id: 'user_123',
    name: 'Alex Mercer',
    email: 'alex.mercer@gmail.com',
    profilePic: 'https://example.com/avatar.jpg',
    googleId: null,
    role: UserRole.USER,
    isActive: true,
    createdAt: new Date('2024-01-15T10:30:00.000Z'),
    updatedAt: new Date('2024-01-15T10:30:00.000Z'),
    gameProfiles: [
      {
        id: 'gp_9988',
        userId: 'user_123',
        gameId: 'game_ff',
        inGameUid: '512839401',
        inGameName: 'ProGamer_X',
        createdAt: new Date(),
        updatedAt: new Date(),
        game: {
          slug: 'free_fire',
          name: 'Free Fire',
        },
      },
    ],
  };

  const mockRegistrations = [
    { id: 'reg_1', tournamentId: 't1', finalRank: 1 },
    { id: 'reg_2', tournamentId: 't2', finalRank: 2 },
    { id: 'reg_3', tournamentId: 't3', finalRank: 5 },
  ];

  beforeEach(() => {
    mockPrisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(mockUser),
        update: jest.fn().mockResolvedValue(mockUser),
      },
      teamMember: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      tournamentRegistration: {
        findMany: jest.fn().mockResolvedValue(mockRegistrations),
      },
      matchResult: {
        aggregate: jest.fn().mockResolvedValue({
          _sum: { kills: 98 },
        }),
      },
      game: {
        findUnique: jest.fn().mockResolvedValue({ id: 'game_ff', slug: 'free_fire' }),
      },
      gameProfile: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(mockUser.gameProfiles[0]),
        upsert: jest.fn().mockResolvedValue(mockUser.gameProfiles[0]),
      },
    };

    service = new UsersService(mockPrisma);
  });

  describe('getProfileWithStats', () => {
    it('returns exact profile statistics contract expected by Flutter app', async () => {
      const result = await service.getProfileWithStats('user_123');

      expect(result).toBeDefined();
      expect(result!.id).toBe('user_123');
      expect(result!.name).toBe('Alex Mercer');
      expect(result!.email).toBe('alex.mercer@gmail.com');
      expect(result!.profile_pic).toBe('https://example.com/avatar.jpg');
      expect(result!.role).toBe('PLAYER'); // Mapped from USER -> PLAYER
      expect(result!.is_active).toBe(true);
      expect(result!.tournaments_played).toBe(3);
      expect(result!.tournaments_won).toBe(1);
      expect(result!.total_kills).toBe(98);
      expect(result!.win_rate).toBe('33.3%');
      expect(result!.xp).toBe(0);
      expect(result!.rank).toBe(0);
      expect(result!.game_profile).toEqual({
        id: 'gp_9988',
        game_slug: 'free_fire',
        game_name: 'Free Fire',
        in_game_uid: '512839401',
        in_game_name: 'ProGamer_X',
      });
    });

    it('handles zero played tournaments gracefully with 0.0% win rate', async () => {
      mockPrisma.tournamentRegistration.findMany.mockResolvedValueOnce([]);
      mockPrisma.matchResult.aggregate.mockResolvedValueOnce({ _sum: { kills: null } });

      const result = await service.getProfileWithStats('user_123');

      expect(result!.tournaments_played).toBe(0);
      expect(result!.tournaments_won).toBe(0);
      expect(result!.total_kills).toBe(0);
      expect(result!.win_rate).toBe('0.0%');
    });
  });

  describe('upsertGameProfile', () => {
    it('upserts game profile for Free Fire successfully', async () => {
      const dto = {
        game_slug: 'free_fire',
        in_game_uid: '512839401',
        in_game_name: 'ProGamer_X',
      };

      const result = await service.upsertGameProfile('user_123', dto);

      expect(result).toBeDefined();
      expect(result.inGameUid).toBe('512839401');
      expect(result.inGameName).toBe('ProGamer_X');
    });
  });
});
