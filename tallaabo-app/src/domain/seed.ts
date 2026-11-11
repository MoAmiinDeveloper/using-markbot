import { LeagueState } from './league';

// name, GP prior, past steps (Nov 7–8), past points, today's steps (Nov 9)
const ROSTER: [string, number, number, number, number][] = [
  ['Khalid Abdilahi', 2, 62213, 6, 28820],
  ['Aw muuse', 2, 45295, 6, 31134],
  ['Jamiil Tarah', 2, 41323, 6, 20934],
  ['Mohamed Adam', 2, 34957, 4, 19174],
  ['Ayanle Ismail', 2, 35195, 3, 24497],
  ['Abdirahman Samater', 2, 26142, 2, 21718],
  ['cabdi axmed', 2, 18116, 1, 24623],
  ["mohamed sa'ad", 1, 13686, 1, 21338],
  ['Caadil Ibrahim', 1, 4240, 0, 15407],
  ['Kaafi Osman', 1, 3688, 0, 4764],
  ['Abdirahman Hussein', 1, 5223, 0, 0],
  ['Abdirahman Ahmed', 2, 0, 0, 0],
  ['khaalid yusouf', 2, 0, 0, 0],
];

export function createSeedState(): LeagueState {
  return {
    version: 1,
    groupName: 'Tallaabo iyo Tasbiix',
    dayTitle: 'Day 3 · Nov 9',
    history: [],
    members: ROSTER.map(([name, gpPrior, pastSteps, pastPoints, todaySteps], i) => ({
      id: `seed-${i + 1}`,
      name,
      gpPrior,
      pastSteps,
      pastPoints,
      todaySteps,
    })),
  };
}
