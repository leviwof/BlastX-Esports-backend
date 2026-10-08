import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnEvent } from '@nestjs/event-emitter';

export interface DataUpdatedPayload {
  entity: string;
  action: string;
  entityId?: string;
  timestamp: string;
  data?: any;
  room?: string;
}

@WebSocketGateway({
  cors: { origin: '*' },
})
export class LiveGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(LiveGateway.name);

  constructor(private readonly jwtService: JwtService) {}

  afterInit(server: Server) {
    this.logger.log('WebSocket Gateway initialized');
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const auth = client.handshake.auth || {};
      const headers = client.handshake.headers || {};
      const query = client.handshake.query || {};

      let token: string | undefined =
        auth.token ||
        auth.authorization ||
        headers.authorization ||
        (query.token as string);

      if (typeof token === 'string' && token.startsWith('Bearer ')) {
        token = token.substring(7).trim();
      }

      if (!token) {
        this.logger.warn(`Socket ${client.id} connection rejected: No JWT token provided`);
        client.emit('error', { message: 'Authentication required. Missing token.' });
        client.disconnect(true);
        return;
      }

      const payload = await this.jwtService.verifyAsync(token);
      const userId = payload.sub || payload.userId || payload.id;

      if (!userId) {
        this.logger.warn(`Socket ${client.id} connection rejected: Payload missing userId`);
        client.emit('error', { message: 'Authentication failed. Missing user identifier.' });
        client.disconnect(true);
        return;
      }

      // Assign authenticated userId to socket instance
      client.data.userId = userId;
      client.data.user = payload;

      // Personal Room (user_${userId}): Upon authentication, automatically make the socket join user_${userId} room.
      const personalRoom = `user_${userId}`;
      await client.join(personalRoom);

      this.logger.log(`Socket ${client.id} connected & authenticated for user ${userId}. Joined ${personalRoom}`);

      client.emit('connected', {
        status: 'authenticated',
        userId,
        personalRoom,
      });
    } catch (err: any) {
      this.logger.warn(`Socket ${client.id} authentication failed: ${err?.message || err}`);
      client.emit('error', { message: 'Authentication failed. Invalid token.' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Socket ${client.id} disconnected`);
  }

  private normalizeRoomName(input: any): string | null {
    if (!input) return null;

    if (typeof input === 'string') {
      let trimmed = input.trim().replace(':', '_');
      if (
        trimmed.startsWith('tournament_') ||
        trimmed.startsWith('team_') ||
        trimmed.startsWith('match_') ||
        trimmed.startsWith('user_')
      ) {
        return trimmed;
      }
      return trimmed;
    }

    if (typeof input === 'object') {
      if (input.room && typeof input.room === 'string') {
        return this.normalizeRoomName(input.room);
      }

      const entityType = input.entity || input.type;
      const entityId =
        input.id ||
        input.entityId ||
        input.tournament_id ||
        input.team_id ||
        input.match_id;

      if (entityType && entityId) {
        return `${entityType}_${entityId}`;
      }
    }

    return null;
  }

  @SubscribeMessage('join_room')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: any,
  ) {
    const room = this.normalizeRoomName(body);
    if (!room) {
      return { status: 'error', message: 'Invalid room specification' };
    }
    await client.join(room);
    this.logger.log(`Socket ${client.id} joined room ${room}`);
    return { status: 'joined', room };
  }

  @SubscribeMessage('leave_room')
  async handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: any,
  ) {
    const room = this.normalizeRoomName(body);
    if (!room) {
      return { status: 'error', message: 'Invalid room specification' };
    }
    await client.leave(room);
    this.logger.log(`Socket ${client.id} left room ${room}`);
    return { status: 'left', room };
  }

  @SubscribeMessage('join_tournament')
  async handleJoinTournament(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { tournament_id?: string; tournamentId?: string; id?: string },
  ) {
    const id = data?.tournament_id || data?.tournamentId || data?.id;
    if (!id) return { status: 'error', message: 'Missing tournament ID' };
    const room = `tournament_${id}`;
    await client.join(room);
    this.logger.log(`Socket ${client.id} joined room ${room}`);
    return { status: 'joined', room };
  }

  @SubscribeMessage('leave_tournament')
  async handleLeaveTournament(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { tournament_id?: string; tournamentId?: string; id?: string },
  ) {
    const id = data?.tournament_id || data?.tournamentId || data?.id;
    if (!id) return { status: 'error', message: 'Missing tournament ID' };
    const room = `tournament_${id}`;
    await client.leave(room);
    this.logger.log(`Socket ${client.id} left room ${room}`);
    return { status: 'left', room };
  }

  @SubscribeMessage('join_team')
  async handleJoinTeam(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { team_id?: string; teamId?: string; id?: string },
  ) {
    const id = data?.team_id || data?.teamId || data?.id;
    if (!id) return { status: 'error', message: 'Missing team ID' };
    const room = `team_${id}`;
    await client.join(room);
    this.logger.log(`Socket ${client.id} joined room ${room}`);
    return { status: 'joined', room };
  }

  @SubscribeMessage('leave_team')
  async handleLeaveTeam(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { team_id?: string; teamId?: string; id?: string },
  ) {
    const id = data?.team_id || data?.teamId || data?.id;
    if (!id) return { status: 'error', message: 'Missing team ID' };
    const room = `team_${id}`;
    await client.leave(room);
    this.logger.log(`Socket ${client.id} left room ${room}`);
    return { status: 'left', room };
  }

  @SubscribeMessage('join_match')
  async handleJoinMatch(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { match_id?: string; matchId?: string; id?: string },
  ) {
    const id = data?.match_id || data?.matchId || data?.id;
    if (!id) return { status: 'error', message: 'Missing match ID' };
    const room = `match_${id}`;
    await client.join(room);
    this.logger.log(`Socket ${client.id} joined room ${room}`);
    return { status: 'joined', room };
  }

  @SubscribeMessage('leave_match')
  async handleLeaveMatch(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { match_id?: string; matchId?: string; id?: string },
  ) {
    const id = data?.match_id || data?.matchId || data?.id;
    if (!id) return { status: 'error', message: 'Missing match ID' };
    const room = `match_${id}`;
    await client.leave(room);
    this.logger.log(`Socket ${client.id} left room ${room}`);
    return { status: 'left', room };
  }

  /**
   * Main Event Emission handler for DB/State Mutations.
   * Emits `DATA_UPDATED` event to specified room(s).
   */
  @OnEvent('data.updated')
  @OnEvent('DATA_UPDATED')
  handleDataUpdatedEvent(payload: {
    room?: string;
    rooms?: string[];
    entity: string;
    action?: string;
    entityId?: string;
    data?: any;
    timestamp?: string;
  }): void {
    if (!this.server) {
      this.logger.warn('Server instance not initialized yet. Skipping emission.');
      return;
    }

    const targetRooms = new Set<string>();

    if (payload.room) {
      const norm = this.normalizeRoomName(payload.room) || payload.room;
      if (norm) targetRooms.add(norm);
    }

    if (Array.isArray(payload.rooms)) {
      payload.rooms.forEach((r) => {
        const norm = this.normalizeRoomName(r) || r;
        if (norm) targetRooms.add(norm);
      });
    }

    // Default target room if no room specified explicitly
    if (targetRooms.size === 0 && payload.entity && payload.entityId) {
      targetRooms.add(`${payload.entity}_${payload.entityId}`);
    }

    const dataUpdatedPayload: DataUpdatedPayload = {
      entity: payload.entity,
      action: payload.action || 'MUTATION',
      entityId: payload.entityId,
      timestamp: payload.timestamp || new Date().toISOString(),
      data: payload.data,
    };

    targetRooms.forEach((roomName) => {
      this.server.to(roomName).emit('DATA_UPDATED', dataUpdatedPayload);
      this.logger.log(`[DATA_UPDATED] Emitted to room '${roomName}': ${JSON.stringify(dataUpdatedPayload)}`);
    });
  }

  @OnEvent('leaderboard.updated')
  handleLeaderboardUpdated(payload: { tournamentId: string; leaderboard: any }): void {
    const roomName = `tournament_${payload.tournamentId}`;
    if (this.server) {
      this.server.to(roomName).emit('DATA_UPDATED', {
        entity: 'tournament',
        action: 'LEADERBOARD_UPDATED',
        entityId: payload.tournamentId,
        timestamp: new Date().toISOString(),
        data: payload.leaderboard,
      });
      this.server.to(roomName).emit('leaderboard_updated', payload);
    }
  }

  @OnEvent('status.changed')
  handleStatusChanged(payload: { tournamentId: string; oldStatus: string; newStatus: string }): void {
    const roomName = `tournament_${payload.tournamentId}`;
    if (this.server) {
      this.server.to(roomName).emit('DATA_UPDATED', {
        entity: 'tournament',
        action: 'STATUS_CHANGED',
        entityId: payload.tournamentId,
        timestamp: new Date().toISOString(),
        data: { oldStatus: payload.oldStatus, newStatus: payload.newStatus },
      });
      this.server.to(roomName).emit('status_changed', payload);
    }
  }
}
