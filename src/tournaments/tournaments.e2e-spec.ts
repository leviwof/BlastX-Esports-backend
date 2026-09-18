import { ForbiddenException } from '@nestjs/common';

export function getRoomDetailsRule(params: {
  isRegistered: boolean;
  isRoomReleased: boolean;
  roomId?: string | null;
  roomPassword?: string | null;
}): { room_id: string; room_password: string } {
  if (!params.isRegistered) {
    throw new ForbiddenException('You must be registered in this tournament to view room details');
  }

  if (!params.isRoomReleased || !params.roomId || !params.roomPassword) {
    throw new ForbiddenException('Room credentials have not been released yet for this tournament');
  }

  return {
    room_id: params.roomId,
    room_password: params.roomPassword,
  };
}

describe('Tournaments E2E & Business Rules - Room Visibility & Registration Flow', () => {
  it('throws 403 Forbidden if unregistered user tries to view room credentials', () => {
    expect(() =>
      getRoomDetailsRule({
        isRegistered: false,
        isRoomReleased: true,
        roomId: 'ROOM123',
        roomPassword: 'PASS',
      }),
    ).toThrow(ForbiddenException);
  });

  it('throws 403 Forbidden if room is not yet released even if user is registered', () => {
    expect(() =>
      getRoomDetailsRule({
        isRegistered: true,
        isRoomReleased: false,
        roomId: 'ROOM123',
        roomPassword: 'PASS',
      }),
    ).toThrow(ForbiddenException);
  });

  it('returns room credentials when user is registered AND room is released', () => {
    const creds = getRoomDetailsRule({
      isRegistered: true,
      isRoomReleased: true,
      roomId: 'ROOM999',
      roomPassword: 'SECRET_PASS',
    });

    expect(creds.room_id).toBe('ROOM999');
    expect(creds.room_password).toBe('SECRET_PASS');
  });
});
