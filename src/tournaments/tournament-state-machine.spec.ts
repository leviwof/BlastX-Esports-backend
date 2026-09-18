import { validateStatusTransition } from './tournament-state-machine';
import { TournamentStatus } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';

describe('Tournament State Machine', () => {
  it('allows valid transitions from DRAFT to UPCOMING or REGISTRATION_OPEN', () => {
    expect(() => validateStatusTransition(TournamentStatus.DRAFT, TournamentStatus.UPCOMING)).not.toThrow();
    expect(() => validateStatusTransition(TournamentStatus.DRAFT, TournamentStatus.REGISTRATION_OPEN)).not.toThrow();
    expect(() => validateStatusTransition(TournamentStatus.DRAFT, TournamentStatus.CANCELLED)).not.toThrow();
  });

  it('allows valid transitions from REGISTRATION_OPEN to REGISTRATION_CLOSED', () => {
    expect(() => validateStatusTransition(TournamentStatus.REGISTRATION_OPEN, TournamentStatus.REGISTRATION_CLOSED)).not.toThrow();
  });

  it('allows valid transitions from REGISTRATION_CLOSED to LIVE', () => {
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
