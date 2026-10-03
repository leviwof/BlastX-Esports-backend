import { TeamMode } from '@prisma/client';

export function validateRegistrationRules(params: {
  status: string;
  registeredCount: number;
  maxSlots: number;
  teamMode: TeamMode;
  teamRosterSize?: number;
  hasGameProfile: boolean;
}): { valid: boolean; error?: string } {
  if (params.status !== 'LIVE') {
    return { valid: false, error: 'Registration opens only when the tournament is LIVE' };
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
    if (params.teamRosterSize !== 4) {
      return { valid: false, error: 'A SQUAD tournament requires exactly 4 team members to play' };
    }
  }

  return { valid: true };
}

describe('Registration Rules & Validations', () => {
  const baseParams = {
    status: 'LIVE',
    registeredCount: 5,
    maxSlots: 10,
    teamMode: TeamMode.SOLO,
    hasGameProfile: true,
  };

  it('approves valid SOLO registration', () => {
    const res = validateRegistrationRules(baseParams);
    expect(res.valid).toBe(true);
  });

  it('rejects registration until the tournament is LIVE', () => {
    const res = validateRegistrationRules({ ...baseParams, status: 'UPCOMING' });
    expect(res.valid).toBe(false);
    expect(res.error).toContain('LIVE');
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

  it('requires exactly 4 members for SQUAD tournaments', () => {
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
    expect(valid5.valid).toBe(false);
  });
});
