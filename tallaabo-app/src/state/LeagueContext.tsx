import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useReducer, useState } from 'react';

import { LeagueAction, LeagueState, leagueReducer } from '../domain/league';
import { Standing, computeStandings } from '../domain/scoring';
import { createSeedState } from '../domain/seed';

const STORAGE_KEY = '@tallaabo/league/v1';

interface LeagueContextValue {
  state: LeagueState;
  standings: Standing[];
  dispatch: React.Dispatch<LeagueAction>;
  /** False until the saved league has been read from disk. */
  ready: boolean;
}

const LeagueContext = createContext<LeagueContextValue | null>(null);

function isLeagueState(value: unknown): value is LeagueState {
  const s = value as LeagueState | null;
  return !!s && s.version === 1 && Array.isArray(s.members) && Array.isArray(s.history);
}

export function LeagueProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(leagueReducer, undefined, createSeedState);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (cancelled || !raw) return;
        const saved: unknown = JSON.parse(raw);
        if (isLeagueState(saved)) dispatch({ type: 'hydrate', state: saved });
      })
      .catch((e) => console.warn('Could not load saved league, starting from seed data', e))
      .finally(() => !cancelled && setReady(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // Never write before the saved copy is loaded, or the seed would overwrite it.
  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch((e) =>
      console.warn('Could not save league', e),
    );
  }, [ready, state]);

  const value = useMemo(
    () => ({ state, standings: computeStandings(state.members), dispatch, ready }),
    [state, ready],
  );

  return <LeagueContext.Provider value={value}>{children}</LeagueContext.Provider>;
}

export function useLeague(): LeagueContextValue {
  const ctx = useContext(LeagueContext);
  if (!ctx) throw new Error('useLeague must be used inside LeagueProvider');
  return ctx;
}
