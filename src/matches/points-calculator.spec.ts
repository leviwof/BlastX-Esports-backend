import { calculatePoints } from './points-calculator';
import { TournamentFormat } from '@prisma/client';

describe('Points Calculator', () => {
  it('calculates Battle Royale points correctly for 1st place with kills', () => {
    const res = calculatePoints(TournamentFormat.BATTLE_ROYALE, 1, 5);
    expect(res.placementPoints).toBe(12);
    expect(res.killPoints).toBe(5);
    expect(res.totalPoints).toBe(17);
  });

  it('calculates Battle Royale points correctly for 2nd and 3rd place', () => {
    const second = calculatePoints(TournamentFormat.BATTLE_ROYALE, 2, 2);
    expect(second.placementPoints).toBe(9);
    expect(second.totalPoints).toBe(11);

    const third = calculatePoints(TournamentFormat.BATTLE_ROYALE, 3, 0);
    expect(third.placementPoints).toBe(8);
    expect(third.totalPoints).toBe(8);
  });

  it('calculates Battle Royale points for 11th+ place as 0 placement points', () => {
    const eleventh = calculatePoints(TournamentFormat.BATTLE_ROYALE, 11, 4);
    expect(eleventh.placementPoints).toBe(0);
    expect(eleventh.totalPoints).toBe(4);
  });

  it('calculates Clash Squad points correctly', () => {
    const win = calculatePoints(TournamentFormat.CLASH_SQUAD, 1, 8);
    expect(win.placementPoints).toBe(1);
    expect(win.killPoints).toBe(8);
    expect(win.totalPoints).toBe(9);

    const loss = calculatePoints(TournamentFormat.CLASH_SQUAD, 2, 3);
    expect(loss.placementPoints).toBe(0);
    expect(loss.totalPoints).toBe(3);
  });
});
