import { validateStatusTransition } from './tournament-state-machine';
import { TournamentStatus } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';

describe('Tournament State Machine', () => {
  it('allows publishing a DRAFT tournament as UPCOMING', () => {
    expect(() => validateStatusTransition(TournamentStatus.DRAFT, TournamentStatus.UPCOMING)).not.toThrow();
    expect(() => validateStatusTransition(TournamentStatus.DRAFT, TournamentStatus.CANCELLED)).not.toThrow();
  });

  it('does not open registration from UPCOMING before the tournament is LIVE', () => {
    expect(() => validateStatusTransition(TournamentStatus.UPCOMING, TournamentStatus.REGISTRATION_OPEN)).toThrow(
      BadRequestException,
    );
    expect(() => validateStatusTransition(TournamentStatus.UPCOMING, TournamentStatus.LIVE)).not.toThrow();
  });

  it('allows legacy registration states to transition to LIVE', () => {
    expect(() => validateStatusTransition(TournamentStatus.REGISTRATION_OPEN, TournamentStatus.LIVE)).not.toThrow();
    expect(() => validateStatusTransition(TournamentStatus.REGISTRATION_CLOSED, TournamentStatus.LIVE)).not.toThrow();
  });

  it('allows valid transitions from LIVE to COMPLETED', () => {
    expect(() => validateStatusTransition(TournamentStatus.LIVE, TournamentStatus.COMPLETED)).not.toThrow();
  });

  it('throws BadRequestException for invalid transitions', () => {
    expect(() => validateStatusTransition(TournamentStatus.DRAFT, TournamentStatus.COMPLETED)).toThrow(BadRequestException);
    expect(() => validateStatusTransition(TournamentStatus.COMPLETED, TournamentStatus.LIVE)).toThrow(BadRequestException);
    expect(() => validateStatusTransition(TournamentStatus.CANCELLED, TournamentStatus.REGISTRATION_OPEN)).toThrow(BadRequestException);
  });
});
