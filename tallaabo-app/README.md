# Tallaabo iyo Tasbiix

Step-tracking league scoreboard for Android and iOS, built with Expo (SDK 58) and React Native.

## Run it

```bash
npm install
npx expo start        # scan the QR code with Expo Go, or press a / i
```

## Build an installable Android APK

```bash
npm install -g eas-cli
eas login
eas build --platform android --profile preview   # produces an .apk
```

`eas build --platform ios` builds for iOS (needs an Apple Developer account).

## Checks

```bash
npm test            # scoring, standings and roll-over rules
npm run typecheck
```

## How scoring works

- 15.0 km = 18,701 steps (1 km = 1,246.7333 steps).
- WIN (+3): 18,701 steps or more. CLOSE (+1): 12,467–18,700. LOSS (0): under 12,467 or no update.
- Standings sort by total points, then total steps. Rank 1 gets the ★ MVP badge.
- **Roll Over to Next Day** adds today's points and steps to the past totals, adds one game played
  for every member, resets today's steps to 0 and advances the day title.
- The GP column counts the current day once a member has steps entered.

## Where things live

| Path | What |
| --- | --- |
| `src/domain/scoring.ts` | Tiers, km conversion, standings and tie-breaker |
| `src/domain/league.ts` | League state, reducer, roll-over |
| `src/domain/seed.ts` | Starting 13-member roster |
| `src/state/LeagueContext.tsx` | AsyncStorage persistence |
| `src/screens/ScoreboardScreen.tsx` | Table, image capture and sharing |
| `src/screens/AdminScreen.tsx` | Step entry, members, roll-over |
| `src/hooks/usePedometer.ts` | Optional phone step sensor |

## Notes

- Sharing opens the system share sheet with the scoreboard PNG; pick WhatsApp there.
- The pedometer reads the phone's motion sensor (`expo-sensors`). On iOS it gives steps since
  midnight; on Android it only counts from the moment you tap Connect. It does not read
  Apple Health or Health Connect records.
