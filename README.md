# DayBridge

**Find activities worth going to. Make getting there possible.**

DayBridge helps older adults discover activities that match their interests and practical needs, then turn a suggestion into a plan. It considers availability, cost, mobility, transport, hearing and group preferences; explains what might prevent participation; and coordinates a ride or invitation **only with explicit consent**.

> **Why it matters:** A recommendation is not the same as an outing. DayBridge focuses on the barriers between finding something enjoyable and actually attending.

## What you can try

- **Personalized week:** Answer short onboarding questions (or choose a demo person) to get explainable activity matches.
- **Discover opportunities:** Browse public UC Berkeley event listings where live discovery is enabled. Public events are **not automatically verified** for accessibility, eligibility, price or suitability.
- **Get me there:** Review a proposed ride/invitation, approve specific actions, and follow coordination status.
- **Recover from changes:** Simulate a cancelled ride and watch the plan return to a needs-attention state rather than incorrectly remain ready.
- **Caregiver view:** Explore a same-device demo of a person's week and items needing attention.
- **Accessible input:** Use easier-view onboarding; opt-in hands-free camera input is also available. The separate Expo mobile app lives in `mobile/`.

## Try the web demo locally

Requires Node.js and npm.

```bash
npm install
cp .env.example .env.local  # optional: defaults support the local mock demo
npm run dev
```

Open **http://localhost:3000**. On Windows PowerShell use `Copy-Item .env.example .env.local` instead.

**Suggested three-minute walkthrough**

1. Open the app and use a demo profile, or complete onboarding.
2. Review the suggested activities and the explanation of fit or barriers.
3. Select **Get me there**, review approvals, then simulate the provider responses to reach **READY**.
4. Simulate a ride cancellation and show how DayBridge revokes readiness and proposes recovery.
5. Optionally show the week/calendar and caregiver view.

Provider responses in this walkthrough are **simulations**, not actual messages, rides, bookings or attendance confirmations. The demo coordinator uses local process memory, so restarting the server may clear plans.

## Verify the project

```bash
npm run check
npm run build -- --webpack
npm run demo:check
```

### Live demo checklist

- Start the production server with demo events on: `DAYBRIDGE_DEMO_EVENTS=1 npx next start -p 3000` (PowerShell: `$env:DAYBRIDGE_DEMO_EVENTS='1'; npx next start -p 3000`). Without the flag `/events` returns 403 in production.
- Run `npm run demo:check` against it once before presenting.
- **Uber/Lyft buttons: tap them on a phone with the app installed.** They open the app with the destination filled in and the pickup set to the phone's location. On desktop, Uber redirects to a generic web page and drops the destination; say "opens the Uber app" rather than expecting a prefilled page. Nothing is booked either way.
- Sign the demo browser into Google so calendar links skip the sign-in screen.
- **Analyze** calls live providers when keys are set (about 2 s); on unreliable venue Wi-Fi, use the demo profiles.

The demo smoke check expects the application to be running; see `scripts/demo-smoke.mjs` for its behavior. The Webpack build option can be useful when local Turbopack worker permissions interfere with builds.

## How it works

| Layer | Responsibility |
| --- | --- |
| Next.js / React web UI | Onboarding, matching, calendar, approvals and coordination timeline |
| TypeScript domain engine | Constraint checks, ranking, proposed interventions and state transitions |
| Consent / coordination layer | Approval boundaries, provider events, readiness and disruption recovery |
| Public event integration | Candidate discovery with source attribution and unknown fields preserved |
| Optional AI adapter | Language interpretation and explanations; it does **not** override safety or approvals |
| Simulated providers | Deterministic invitation, RSVP and ride responses for the hackathon demo |

The planner is deterministic: unknown or unmet requirements are not treated as confirmed. A requested ride is **not** a booked ride; a public event listing is **not** a guarantee of accessibility.

## Configuration and limitations

**No API keys are required for the local simulated demo.** Copy `.env.example` for optional integrations and see [environment setup](docs/integrations/ENV_SETUP.md).

- Live public events are optional and depend on source availability and feature flags.
- Google Maps venue enrichment and Uber fare estimates require optional credentials and appropriate provider access; calendar and map handoff links do not book anything.
- No real SMS/email, rideshare booking, payment processing, or automatic attendance verification.
- Cloud authentication/persistence is experimental and **not** part of the approved local demo. Do not expose state-changing coordination endpoints as a public service without proper authentication and persistence.

## Mobile

The [Expo app](mobile/README.md) shares matching/domain logic with the web project. Run it separately from `mobile/`; its features and runtime requirements are documented there.

## More documentation

- [Hackathon demo and product overview](docs/daybridge/README.md)
- [Product and engineering specification](docs/daybridge/PRODUCT_ENGINEERING_SPEC.md)
- [Product goals and user journeys](docs/product/GOALS.md)
- [Coordination contract](docs/daybridge/COORDINATION_CONTRACT.md)
- [Environment setup](docs/integrations/ENV_SETUP.md)

**Status:** Hackathon demo with simulated coordination. Feature availability may vary by branch and configuration; this README does not imply a public production deployment.
