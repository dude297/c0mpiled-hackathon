# Handoff: Teammate A, UI

Read [README.md](README.md) first (setup and rules). Branch: `git checkout -b ui/polish`.

## You own
- `src/app/page.tsx`: page state, the fetch to `/api/analyze`, demo autoload
- `src/components/dashboard/panels.tsx`: Profile, Weekly plan, "Why not these?" and Evidence panels
- `src/components/ui/**`: shadcn components (`npx shadcn add <component>` is fine)
- `src/app/layout.tsx`, `src/app/globals.css`

Don't edit `src/domain/**`, `src/lib/**` or `src/app/api/**`. Ask the lead or Claude if you need data the API doesn't return yet.

## What already works
Every Profile field is in the form. "Load demo: Margaret/Harold" fills the form and runs it. The plan cards show soft barriers as "Barrier → Workaround". There's a mock/live AI badge, a blocked list, and the evidence checks in a collapsed section. Typecheck and lint are clean. The UI hasn't been polished for the demo yet.

## Your goal
A judge understands the product in about 5 seconds, and an older adult or caregiver could actually use it.

## Tasks, in priority order
1. **First impression (P1).** The plan should be the hero: big cards, a clear day and time, and the workaround in plain words. Put a one-line pitch at the top. Keep the profile form compact (maybe collapsible after a demo loads).
2. **"Why not these?" (P1).** This is the moment that makes the demo. Show each blocked activity with a red reason ("Entrance has stairs; Margaret uses a walker").
3. **Accessibility (P2).** Body text 16–18px or larger, high contrast, buttons at least 44px tall, label every input, keyboard focus visible. The audience is older adults and caregivers.
4. **States (P2).** A loading spinner on "Build plan", readable API errors, and no blank screen when the plan is empty.
5. **Slots for teammates (P2).** Leave space for:
   - a "Describe them in your own words" textarea above the form, which calls `POST /api/intake` → `{ profile }` (the lead is building it) and fills the form;
   - a "Save & share" button under the plan, which calls `POST /api/plans` → `{ id }` and links to `/plan/{id}` (the lead is building it).
   Wire them so they're hidden, or show "coming soon", until the endpoints exist.
6. **Polish (P3).** Subtle icons from `lucide-react` (already installed), plus a print-friendly plan (`@media print`).

## Tips
- The API response type is `AnalysisResult` from `@/lib/schema`, so use it everywhere.
- Demo data: `DEMO_PROFILES` from `@/domain/activities`.
- Test both demo profiles, plus a profile where everything is blocked (budget 0, evening only).
- Before you hand off: `npm run check`, then click through the whole flow in a fresh browser tab.
