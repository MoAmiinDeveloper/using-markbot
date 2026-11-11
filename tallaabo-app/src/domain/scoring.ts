/** 15.0 km = 18,701 steps, so 1 km = 1,246.7333 steps. */
export const STEPS_PER_KM = 1246.7333;
export const WIN_STEPS = 18701; // >= 15.0 km
export const CLOSE_STEPS = 12467; // >= 10.0 km

export type Tier = 'WIN' | 'CLOSE' | 'LOSS';

export interface Member {
  id: string;
  name: string;
  /** Games played before the current day. */
  gpPrior: number;
  pastSteps: number;
  pastPoints: number;
  todaySteps: number;
}

export interface Standing extends Member {
  rank: number;
  isMvp: boolean;
  tier: Tier;
  todayPoints: number;
  todayKm: string;
  gp: number;
  totalSteps: number;
  totalPoints: number;
}

export function estKm(steps: number): string {
  return (steps / STEPS_PER_KM).toFixed(1);
}

export function tierFor(steps: number): Tier {
  if (steps >= WIN_STEPS) return 'WIN';
  if (steps >= CLOSE_STEPS) return 'CLOSE';
  return 'LOSS';
}

export const TIER_POINTS: Record<Tier, number> = { WIN: 3, CLOSE: 1, LOSS: 0 };

export function pointsFor(steps: number): number {
  return TIER_POINTS[tierFor(steps)];
}

/**
 * Ranks members by total points, then total steps (both descending).
 * Members level on both keep their roster order. Rank #1 is the MVP.
 */
export function computeStandings(members: Member[]): Standing[] {
  return members
    .map((m, index) => {
      const tier = tierFor(m.todaySteps);
      const todayPoints = TIER_POINTS[tier];
      return {
        index,
        row: {
          ...m,
          tier,
          todayPoints,
          todayKm: estKm(m.todaySteps),
          // The current day counts as played once a step count is in.
          gp: m.gpPrior + (m.todaySteps > 0 ? 1 : 0),
          totalSteps: m.pastSteps + m.todaySteps,
          totalPoints: m.pastPoints + todayPoints,
        },
      };
    })
    .sort(
      (a, b) =>
        b.row.totalPoints - a.row.totalPoints ||
        b.row.totalSteps - a.row.totalSteps ||
        a.index - b.index,
    )
    .map(({ row }, i) => ({ ...row, rank: i + 1, isMvp: i === 0 }));
}
