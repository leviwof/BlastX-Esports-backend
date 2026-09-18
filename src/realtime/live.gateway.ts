import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnEvent } from '@nestjs/event-emitter';

@WebSocketGateway({
  namespace: 'live',
  cors: { origin: '*' },
})
export class LiveGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(LiveGateway.name);

  constructor(private readonly jwtService: JwtService) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const authHeader = client.handshake.headers.authorization || client.handshake.auth?.token;
      const token = typeof authHeader === 'string' ? authHeader.replace(/^Bearer\s+/i, '') : null;

      if (!token) {
        this.logger.warn(`Socket ${client.id} connection rejected: No JWT token`);
        client.disconnect();
        return;
      }

      const payload = await this.jwtService.verifyAsync(token);
      client.data.user = payload;
      this.logger.log(`Socket ${client.id} connected for user ${payload.sub}`);
    } catch (err: any) {
      this.logger.warn(`Socket ${client.id} authentication failed: ${err.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Socket ${client.id} disconnected`);
  }

  @SubscribeMessage('join_tournament')
  handleJoinTournament(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { tournament_id: string },
  ): { status: string; room: string } {
    if (!data || !data.tournament_id) {
      return { status: 'error', room: '' };
    }
    const roomName = `tournament:${data.tournament_id}`;
    void client.join(roomName);
    this.logger.log(`Socket ${client.id} joined room ${roomName}`);
    return { status: 'joined', room: roomName };
  }

  @SubscribeMessage('leave_tournament')
  handleLeaveTournament(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { tournament_id: string },
  ): { status: string; room: string } {
    if (!data || !data.tournament_id) {
      return { status: 'error', room: '' };
    }
    const roomName = `tournament:${data.tournament_id}`;
    void client.leave(roomName);
    this.logger.log(`Socket ${client.id} left room ${roomName}`);
    return { status: 'left', room: roomName };
  }

  @OnEvent('leaderboard.updated')
  handleLeaderboardUpdated(payload: { tournamentId: string; leaderboard: any }): void {
    const roomName = `tournament:${payload.tournamentId}`;
    this.server.to(roomName).emit('leaderboard_updated', payload);
    this.logger.log(`Emitted 'leaderboard_updated' to room ${roomName}`);
  }

  @OnEvent('status.changed')
  handleStatusChanged(payload: { tournamentId: string; oldStatus: string; newStatus: string }): void {
    const roomName = `tournament:${payload.tournamentId}`;
    this.server.to(roomName).emit('status_changed', payload);
    this.logger.log(`Emitted 'status_changed' to room ${roomName}`);
  }
}
