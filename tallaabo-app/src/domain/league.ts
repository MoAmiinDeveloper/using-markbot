import { Member, pointsFor } from './scoring';

export interface DayRecord {
  title: string;
  closedAt: string;
  entries: { memberId: string; name: string; steps: number; points: number }[];
}

export interface LeagueState {
  version: 1;
  groupName: string;
  dayTitle: string;
  members: Member[];
  /** Days that have been rolled over, oldest first. */
  history: DayRecord[];
}

export type LeagueAction =
  | { type: 'hydrate'; state: LeagueState }
  | { type: 'setGroupName'; value: string }
  | { type: 'setDayTitle'; value: string }
  | { type: 'setSteps'; id: string; steps: number }
  | { type: 'addMember'; id: string; name: string }
  | { type: 'removeMember'; id: string }
  | { type: 'rollOver'; closedAt: string };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Advances "Day 3 · Nov 9" to "Day 4 · Nov 10". Parts it can't recognise are left alone. */
export function nextDayTitle(title: string): string {
  return title
    .replace(/\b(Day\s+)(\d+)/i, (_, label: string, n: string) => `${label}${Number(n) + 1}`)
    .replace(
      /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(\s+)(\d{1,2})\b/i,
      (whole: string, mon: string, gap: string, d: string) => {
        const m = MONTHS.findIndex((x) => x.toLowerCase() === mon.toLowerCase());
        const day = Number(d);
        if (day < 1 || day > MONTH_DAYS[m]) return whole;
        return day < MONTH_DAYS[m] ? `${MONTHS[m]}${gap}${day + 1}` : `${MONTHS[(m + 1) % 12]}${gap}1`;
      },
    );
}

/** Locks today's result into the past totals, bumps GP, and zeroes today's steps. */
export function rollOver(state: LeagueState, closedAt: string): LeagueState {
  return {
    ...state,
    dayTitle: nextDayTitle(state.dayTitle),
    history: [
      ...state.history,
      {
        title: state.dayTitle,
        closedAt,
        entries: state.members.map((m) => ({
          memberId: m.id,
          name: m.name,
          steps: m.todaySteps,
          points: pointsFor(m.todaySteps),
        })),
      },
    ],
    members: state.members.map((m) => ({
      ...m,
      gpPrior: m.gpPrior + 1,
      pastSteps: m.pastSteps + m.todaySteps,
      pastPoints: m.pastPoints + pointsFor(m.todaySteps),
      todaySteps: 0,
    })),
  };
}

export function leagueReducer(state: LeagueState, action: LeagueAction): LeagueState {
  switch (action.type) {
    case 'hydrate':
      return action.state;
    case 'setGroupName':
      return { ...state, groupName: action.value };
    case 'setDayTitle':
      return { ...state, dayTitle: action.value };
    case 'setSteps':
      return {
        ...state,
        members: state.members.map((m) =>
          m.id === action.id ? { ...m, todaySteps: Math.max(0, Math.floor(action.steps) || 0) } : m,
        ),
      };
    case 'addMember': {
      const name = action.name.trim();
      if (!name) return state;
      return {
        ...state,
        members: [
          ...state.members,
          { id: action.id, name, gpPrior: 0, pastSteps: 0, pastPoints: 0, todaySteps: 0 },
        ],
      };
    }
    case 'removeMember':
      return { ...state, members: state.members.filter((m) => m.id !== action.id) };
    case 'rollOver':
      return rollOver(state, action.closedAt);
  }
}
