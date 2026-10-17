# DayBridge — mobile (Expo)

Native app for DayBridge. Same product and data contract as the web app in `../src`; the matching
engine is **shared, not copied**: `@/domain/engine`, `@/domain/activities` and `@/lib/schema`
resolve to `../src/...` (see `tsconfig.json` paths + `metro.config.js`).

## Run it

```bash
cd mobile
npm install
npx expo start          # scan the QR code with Expo Go (phone on the same Wi-Fi as the laptop)
npx expo start --web    # browser preview
```

## Live AI (optional)

By default results are computed **on-device** with the shared engine. To use the web app's
`/api/analyze` (live AI explanation), run the web dev server on the laptop and create `mobile/.env`:

```
EXPO_PUBLIC_API_URL=http://10.59.130.27:3000
```

(`10.59.130.27` is the laptop's current LAN IP — check with `ipconfig getifaddr en0`.)
Restart `npx expo start` after changing `.env`. If the server is unreachable or slower than 4s,
the app silently falls back to on-device; the UI labels which one was used (`source` in the store).

## Layout

- `app/` — expo-router routes: `index` → `/onboarding`; tabs `matches`, `week`, `details`
- `lib/store.tsx` — `AppProvider` / `useApp()` (profile, result, added, analyze…)
- `lib/onboarding.ts` — question set + `answersToProfile` (ported from web `CardDeck.tsx`)
- `lib/theme.ts` — colors, type scale, spacing, radius, tap size

## Checks

```bash
npx tsc --noEmit
npx expo export --platform ios --output-dir /tmp/dbx-ios && rm -rf /tmp/dbx-ios
```
