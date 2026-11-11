import { leagueReducer, nextDayTitle, rollOver } from '../league';
import { computeStandings, estKm, pointsFor, tierFor } from '../scoring';
import { createSeedState } from '../seed';

describe('scoring tiers', () => {
  it.each([
    [0, 'LOSS', 0],
    [12466, 'LOSS', 0],
    [12467, 'CLOSE', 1],
    [18700, 'CLOSE', 1],
    [18701, 'WIN', 3],
    [31134, 'WIN', 3],
  ])('%i steps -> %s (%i pts)', (steps, tier, pts) => {
    expect(tierFor(steps)).toBe(tier);
    expect(pointsFor(steps)).toBe(pts);
  });

  it('converts steps to km', () => {
    expect(estKm(18701)).toBe('15.0');
    expect(estKm(12467)).toBe('10.0');
    expect(estKm(0)).toBe('0.0');
  });
});

describe('standings from seed data', () => {
  const table = computeStandings(createSeedState().members);

  it('ranks by points, then steps', () => {
    expect(table.map((r) => [r.name, r.totalPoints, r.totalSteps])).toEqual([
      ['Khalid Abdilahi', 9, 91033],
      ['Aw muuse', 9, 76429],
      ['Jamiil Tarah', 9, 62257],
      ['Mohamed Adam', 7, 54131],
      ['Ayanle Ismail', 6, 59692],
      ['Abdirahman Samater', 5, 47860],
      ['cabdi axmed', 4, 42739],
      ["mohamed sa'ad", 4, 35024],
      ['Caadil Ibrahim', 1, 19647],
      ['Kaafi Osman', 0, 8452],
      ['Abdirahman Hussein', 0, 5223],
      ['Abdirahman Ahmed', 0, 0],
      ['khaalid yusouf', 0, 0],
    ]);
  });

  it('gives MVP to rank 1 only', () => {
    expect(table.filter((r) => r.isMvp).map((r) => r.name)).toEqual(['Khalid Abdilahi']);
    expect(table.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });
});

describe('roll over', () => {
  it('locks points and steps, increments GP, resets today', () => {
    const before = createSeedState();
    const after = rollOver(before, '2026-11-09T21:00:00.000Z');
    expect(after.members[0]).toMatchObject({ gpPrior: 3, pastSteps: 91033, pastPoints: 9, todaySteps: 0 });
    expect(after.members[10]).toMatchObject({ gpPrior: 2, pastSteps: 5223, pastPoints: 0, todaySteps: 0 });
    expect(after.dayTitle).toBe('Day 4 · Nov 10');
    expect(after.history).toHaveLength(1);
    expect(after.history[0].entries[8]).toMatchObject({ name: 'Caadil Ibrahim', steps: 15407, points: 1 });
    // Totals are unchanged by the roll over itself.
    expect(computeStandings(after.members).map((r) => r.totalPoints)).toEqual(
      computeStandings(before.members).map((r) => r.totalPoints),
    );
  });

  it('advances titles across month ends and leaves free text alone', () => {
    expect(nextDayTitle('Day 24 · Nov 30')).toBe('Day 25 · Dec 1');
    expect(nextDayTitle('Finals')).toBe('Finals');
  });
});

describe('reducer', () => {
  it('adds, updates and removes members', () => {
    let s = leagueReducer(createSeedState(), { type: 'addMember', id: 'x', name: '  New Guy ' });
    expect(s.members).toHaveLength(14);
    expect(s.members[13]).toMatchObject({ name: 'New Guy', gpPrior: 0, todaySteps: 0 });
    s = leagueReducer(s, { type: 'setSteps', id: 'x', steps: 20000 });
    expect(computeStandings(s.members).find((r) => r.id === 'x')).toMatchObject({ totalPoints: 3, tier: 'WIN' });
    s = leagueReducer(s, { type: 'removeMember', id: 'x' });
    expect(s.members).toHaveLength(13);
    expect(leagueReducer(s, { type: 'addMember', id: 'y', name: '   ' })).toBe(s);
  });
});
