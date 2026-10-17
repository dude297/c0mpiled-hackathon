# Handoff: Swipe Onboarding (ui/swipe-onboarding)

**State: committed and green.** Branch `ui/swipe-onboarding` off `origin/main` (commit `2e8a...` range: one commit on top of `26b9762`). `npm run check` passes: 3 files, 20 tests, typecheck + lint clean.

## What's built

**1. `src/components/onboarding/CardDeck.tsx` (new, committed)**
- Full card-deck onboarding: 10 interest cards (❤️/✕ swipe via pointer drag, with buttons as fallback), then "when are you free" (multi-pick), "how far is too far" (**fuzzy buckets**: 5/15/30/45/90 min — "down the block", "a short drive", etc.), "what about stairs" (phrased gently: fine / hassle / avoid → maps to `full`/`cane`/`walker`), weekly budget buckets ($0/10/25/50).
- `answersToProfile(answers, name)` — pure function mapping answers → schema-valid `Profile`. Defaults when answers are skipped: interests→`["learning"]`, travel→30, times→`["morning","afternoon"]`, budget→10, mobility→`full`. Transport is *derived* from the stairs answer (walker/cane → `["bus","paratransit","family"]`; full → `["drive","walk","bus"]`).
- Tests: `src/components/onboarding/CardDeck.test.ts` (8 tests, all green).

**2. `src/app/page.tsx` (modified, uncommitted)**
- Two-mode shell: `onboarding` (CardDeck on top, "Or use the classic form" escape hatch at the bottom) ↔ `dashboard` (existing panels, unchanged). `onComplete` → sets profile → runs `/api/analyze` → flips to dashboard. `run()` now flips to dashboard after the fetch (success or error). Demo buttons also flip to dashboard.

## Not yet built (ordered)

1. **Feed view** (P1): post-analysis results as match cards ("❤️ Add to my week") instead of the current list panels; weekly strip Mon–Sun; restyle "Why not these?" as red "Not a match — here's why" cards. Files: `src/components/dashboard/panels.tsx` (Hiro's file — coordinate) or a new `src/components/feed/`.
2. **Big-button accessibility mode** (P2): settings toggle that swaps swipe-drag for 56px ❤️/✕ buttons only (already possible — buttons exist; just add a toggle that hides the drag hint).
3. **Copilot chat widget** (P3): side panel answering "is X right for me?" from deterministic plan data only.

## Gotchas

- `SwipeCard`'s drag is pointer-events only; it never fires `onSwipe` unless drag passes 90px — buttons are the reliable demo path. For the demo, **buttons are safer**.
- Don't add npm packages; `framer-motion` is tempting but not approved.
- `answersToProfile` is exported and pure — reuse it for the feed's re-match flow if you add one.
- Next.js 16: read `node_modules/next/dist/docs/` before touching server code (per AGENTS.md).

## Run it

```bash
npm install && npm run dev   # http://localhost:3000 — onboarding deck is the landing view
npm run check                # must be green before merge
```

Demo flow: type name → ❤️ a few interests → pick times → travel bucket → stairs → budget → "See my matches" → dashboard renders Margaret-style plan.
