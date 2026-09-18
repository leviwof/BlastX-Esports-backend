import { TeamMode } from '@prisma/client';

export function validateRegistrationRules(params: {
  status: string;
  now: Date;
  opensAt: Date;
  closesAt: Date;
  registeredCount: number;
  maxSlots: number;
  teamMode: TeamMode;
  teamRosterSize?: number;
  hasGameProfile: boolean;
}): { valid: boolean; error?: string } {
  if (params.status !== 'REGISTRATION_OPEN') {
    return { valid: false, error: 'Tournament is not open for registration' };
  }

  if (params.now < params.opensAt || params.now > params.closesAt) {
    return { valid: false, error: 'Tournament registration window is currently closed' };
  }

  if (params.registeredCount >= params.maxSlots) {
    return { valid: false, error: 'Tournament registration is full' };
  }

  if (!params.hasGameProfile) {
    return { valid: false, error: 'You must set up your Free Fire game profile before registering' };
  }

  if (params.teamMode === TeamMode.DUO) {
    if (!params.teamRosterSize || params.teamRosterSize < 2) {
      return { valid: false, error: 'A DUO tournament requires a team with at least 2 players' };
    }
  } else if (params.teamMode === TeamMode.SQUAD) {
    if (!params.teamRosterSize || params.teamRosterSize < 4 || params.teamRosterSize > 5) {
      return { valid: false, error: 'A SQUAD tournament requires 4 players + optional 1 substitute (total 4 or 5 members)' };
    }
  }

  return { valid: true };
}

describe('Registration Rules & Validations', () => {
  const baseParams = {
    status: 'REGISTRATION_OPEN',
    now: new Date('2026-09-19T10:00:00Z'),
    opensAt: new Date('2026-09-19T08:00:00Z'),
    closesAt: new Date('2026-09-19T18:00:00Z'),
    registeredCount: 5,
    maxSlots: 10,
    teamMode: TeamMode.SOLO,
    hasGameProfile: true,
  };

  it('approves valid SOLO registration', () => {
    const res = validateRegistrationRules(baseParams);
    expect(res.valid).toBe(true);
  });

  it('rejects registration when status is not REGISTRATION_OPEN', () => {
    const res = validateRegistrationRules({ ...baseParams, status: 'UPCOMING' });
    expect(res.valid).toBe(false);
    expect(res.error).toContain('not open');
  });

  it('rejects registration outside window', () => {
    const res = validateRegistrationRules({ ...baseParams, now: new Date('2026-09-19T19:00:00Z') });
    expect(res.valid).toBe(false);
    expect(res.error).toContain('window is currently closed');
  });

  it('rejects registration when slots are full', () => {
    const res = validateRegistrationRules({ ...baseParams, registeredCount: 10, maxSlots: 10 });
    expect(res.valid).toBe(false);
    expect(res.error).toContain('full');
  });

  it('rejects registration when game profile is missing', () => {
    const res = validateRegistrationRules({ ...baseParams, hasGameProfile: false });
    expect(res.valid).toBe(false);
    expect(res.error).toContain('game profile');
  });

  it('validates SQUAD team roster size (4 or 5 allowed, 3 rejected)', () => {
    const invalidRoster = validateRegistrationRules({
      ...baseParams,
      teamMode: TeamMode.SQUAD,
      teamRosterSize: 3,
    });
    expect(invalidRoster.valid).toBe(false);

    const valid4 = validateRegistrationRules({
      ...baseParams,
      teamMode: TeamMode.SQUAD,
      teamRosterSize: 4,
    });
    expect(valid4.valid).toBe(true);

    const valid5 = validateRegistrationRules({
      ...baseParams,
      teamMode: TeamMode.SQUAD,
      teamRosterSize: 5,
    });
    expect(valid5.valid).toBe(true);
  });
});
