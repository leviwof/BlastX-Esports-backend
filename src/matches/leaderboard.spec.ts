import { LeaderboardEntry } from './match.mapper';

describe('Leaderboard Tie-Breakers', () => {
  function sortLeaderboard(entries: Omit<LeaderboardEntry, 'rank'>[]): LeaderboardEntry[] {
    const copy = [...entries];
    copy.sort((a, b) => {
      if (b.total_points !== a.total_points) return b.total_points - a.total_points;
      if (b.booyahs !== a.booyahs) return b.booyahs - a.booyahs;
      if (b.total_kills !== a.total_kills) return b.total_kills - a.total_kills;
      return a.last_match_placement - b.last_match_placement;
    });

    return copy.map((item, index) => ({ rank: index + 1, ...item }));
  }

  it('ranks primarily by total points', () => {
    const entries = [
      { registration_id: '1', participant_name: 'Team A', total_points: 20, placement_points: 12, kill_points: 8, total_kills: 8, booyahs: 1, last_match_placement: 1 },
      { registration_id: '2', participant_name: 'Team B', total_points: 25, placement_points: 15, kill_points: 10, total_kills: 10, booyahs: 1, last_match_placement: 2 },
    ];

    const sorted = sortLeaderboard(entries);
    expect(sorted[0].participant_name).toBe('Team B');
    expect(sorted[1].participant_name).toBe('Team A');
  });

  it('breaks ties by booyahs when total points are equal', () => {
    const entries = [
      { registration_id: '1', participant_name: 'Team A (0 Booyahs)', total_points: 30, placement_points: 15, kill_points: 15, total_kills: 15, booyahs: 0, last_match_placement: 2 },
      { registration_id: '2', participant_name: 'Team B (1 Booyah)', total_points: 30, placement_points: 18, kill_points: 12, total_kills: 12, booyahs: 1, last_match_placement: 5 },
    ];

    const sorted = sortLeaderboard(entries);
    expect(sorted[0].participant_name).toBe('Team B (1 Booyah)');
    expect(sorted[1].participant_name).toBe('Team A (0 Booyahs)');
  });

  it('breaks ties by total kills when points and booyahs are equal', () => {
    const entries = [
      { registration_id: '1', participant_name: 'Team A (5 kills)', total_points: 30, placement_points: 25, kill_points: 5, total_kills: 5, booyahs: 1, last_match_placement: 3 },
      { registration_id: '2', participant_name: 'Team B (10 kills)', total_points: 30, placement_points: 20, kill_points: 10, total_kills: 10, booyahs: 1, last_match_placement: 4 },
    ];

    const sorted = sortLeaderboard(entries);
    expect(sorted[0].participant_name).toBe('Team B (10 kills)');
  });

  it('breaks ties by last match placement (lower number is better) when points, booyahs, and kills are equal', () => {
    const entries = [
      { registration_id: '1', participant_name: 'Team A (Placement 5)', total_points: 30, placement_points: 20, kill_points: 10, total_kills: 10, booyahs: 1, last_match_placement: 5 },
      { registration_id: '2', participant_name: 'Team B (Placement 2)', total_points: 30, placement_points: 20, kill_points: 10, total_kills: 10, booyahs: 1, last_match_placement: 2 },
    ];

    const sorted = sortLeaderboard(entries);
    expect(sorted[0].participant_name).toBe('Team B (Placement 2)');
  });
});
