import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

export interface RegistrationConfirmedPayload {
  userId: string;
  tournamentId: string;
  tournamentTitle: string;
  slotNumber: number;
}

export interface RoomReleasedPayload {
  tournamentId: string;
  tournamentTitle: string;
  roomId: string;
  roomPassword?: string | null;
}

export interface TournamentStartingSoonPayload {
  tournamentId: string;
  tournamentTitle: string;
  startsAt: Date;
}

export interface ResultsPublishedPayload {
  tournamentId: string;
  tournamentTitle: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  @OnEvent('registration.confirmed')
  handleRegistrationConfirmed(payload: RegistrationConfirmedPayload): void {
    this.logger.log(`[EVENT: registration_confirmed] User ${payload.userId} registered for tournament "${payload.tournamentTitle}" (Slot #${payload.slotNumber})`);
  }

  @OnEvent('room.released')
  handleRoomReleased(payload: RoomReleasedPayload): void {
    this.logger.log(`[EVENT: room_released] Room released for tournament "${payload.tournamentTitle}" (Room ID: ${payload.roomId})`);
  }

  @OnEvent('tournament.starting_soon')
  handleTournamentStartingSoon(payload: TournamentStartingSoonPayload): void {
    this.logger.log(`[EVENT: tournament_starting_soon] Tournament "${payload.tournamentTitle}" starts at ${payload.startsAt.toISOString()}`);
  }

  @OnEvent('results.published')
  handleResultsPublished(payload: ResultsPublishedPayload): void {
    this.logger.log(`[EVENT: results_published] Results published for tournament "${payload.tournamentTitle}"`);
  }
}
