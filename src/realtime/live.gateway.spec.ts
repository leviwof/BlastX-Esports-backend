import { Test, TestingModule } from '@nestjs/testing';
import { Socket } from 'socket.io';

jest.mock('@nestjs/event-emitter', () => ({
  OnEvent: () => () => undefined,
}));

jest.mock('@nestjs/jwt', () => ({
  JwtService: jest.fn().mockImplementation(() => ({
    verifyAsync: jest.fn(),
  })),
}));

import { JwtService } from '@nestjs/jwt';
import { LiveGateway } from './live.gateway';

describe('LiveGateway', () => {
  let gateway: LiveGateway;
  let jwtService: jest.Mocked<JwtService>;

  beforeEach(async () => {
    jwtService = {
      verifyAsync: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiveGateway,
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    gateway = module.get<LiveGateway>(LiveGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('handleConnection', () => {
    it('should authenticate user and join personal room user_{userId}', async () => {
      const mockSocket = {
        id: 'socket_123',
        handshake: {
          auth: { token: 'valid_jwt_token' },
          headers: {},
          query: {},
        },
        data: {},
        join: jest.fn().mockResolvedValue(undefined),
        disconnect: jest.fn(),
        emit: jest.fn(),
      } as unknown as Socket;

      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({ sub: 'user_999' });

      await gateway.handleConnection(mockSocket);

      expect(jwtService.verifyAsync).toHaveBeenCalledWith('valid_jwt_token');
      expect(mockSocket.data.userId).toBe('user_999');
      expect(mockSocket.join).toHaveBeenCalledWith('user_user_999');
      expect(mockSocket.emit).toHaveBeenCalledWith('connected', {
        status: 'authenticated',
        userId: 'user_999',
        personalRoom: 'user_user_999',
      });
      expect(mockSocket.disconnect).not.toHaveBeenCalled();
    });

    it('should disconnect socket if token is missing', async () => {
      const mockSocket = {
        id: 'socket_no_token',
        handshake: { auth: {}, headers: {}, query: {} },
        data: {},
        join: jest.fn(),
        disconnect: jest.fn(),
        emit: jest.fn(),
      } as unknown as Socket;

      await gateway.handleConnection(mockSocket);

      expect(mockSocket.disconnect).toHaveBeenCalledWith(true);
      expect(mockSocket.join).not.toHaveBeenCalled();
    });

    it('should disconnect socket if JWT verification fails', async () => {
      const mockSocket = {
        id: 'socket_invalid_token',
        handshake: { auth: { token: 'bad_token' }, headers: {}, query: {} },
        data: {},
        join: jest.fn(),
        disconnect: jest.fn(),
        emit: jest.fn(),
      } as unknown as Socket;

      (jwtService.verifyAsync as jest.Mock).mockRejectedValue(new Error('Invalid token'));

      await gateway.handleConnection(mockSocket);

      expect(mockSocket.disconnect).toHaveBeenCalledWith(true);
      expect(mockSocket.join).not.toHaveBeenCalled();
    });
  });

  describe('Entity Rooms', () => {
    let mockSocket: Socket;

    beforeEach(() => {
      mockSocket = {
        id: 'socket_room_tester',
        join: jest.fn().mockResolvedValue(undefined),
        leave: jest.fn().mockResolvedValue(undefined),
      } as unknown as Socket;
    });

    it('should join tournament room via handleJoinTournament', async () => {
      const res = await gateway.handleJoinTournament(mockSocket, { tournament_id: 'tourn_1' });
      expect(res).toEqual({ status: 'joined', room: 'tournament_tourn_1' });
      expect(mockSocket.join).toHaveBeenCalledWith('tournament_tourn_1');
    });

    it('should join team room via handleJoinTeam', async () => {
      const res = await gateway.handleJoinTeam(mockSocket, { team_id: 'team_1' });
      expect(res).toEqual({ status: 'joined', room: 'team_team_1' });
      expect(mockSocket.join).toHaveBeenCalledWith('team_team_1');
    });

    it('should join match room via handleJoinMatch', async () => {
      const res = await gateway.handleJoinMatch(mockSocket, { match_id: 'match_1' });
      expect(res).toEqual({ status: 'joined', room: 'match_match_1' });
      expect(mockSocket.join).toHaveBeenCalledWith('match_match_1');
    });

    it('should join custom room via handleJoinRoom', async () => {
      const res = await gateway.handleJoinRoom(mockSocket, { room: 'tournament_xyz' });
      expect(res).toEqual({ status: 'joined', room: 'tournament_xyz' });
      expect(mockSocket.join).toHaveBeenCalledWith('tournament_xyz');
    });

    it('should leave room via handleLeaveRoom', async () => {
      const res = await gateway.handleLeaveRoom(mockSocket, { room: 'tournament_xyz' });
      expect(res).toEqual({ status: 'left', room: 'tournament_xyz' });
      expect(mockSocket.leave).toHaveBeenCalledWith('tournament_xyz');
    });
  });

  describe('DATA_UPDATED Emission', () => {
    it('should broadcast DATA_UPDATED to targeted room', () => {
      const mockEmit = jest.fn();
      const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
      gateway.server = { to: mockTo } as any;

      gateway.handleDataUpdatedEvent({
        room: 'tournament_tourn_100',
        entity: 'tournament',
        action: 'UPDATE',
        entityId: 'tourn_100',
      });

      expect(mockTo).toHaveBeenCalledWith('tournament_tourn_100');
      expect(mockEmit).toHaveBeenCalledWith('DATA_UPDATED', expect.objectContaining({
        entity: 'tournament',
        action: 'UPDATE',
        entityId: 'tourn_100',
      }));
    });
  });
});
