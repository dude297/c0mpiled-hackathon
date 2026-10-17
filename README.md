# DayBridge

**Find activities worth going to. Make getting there possible.**

DayBridge helps older adults discover activities that match their interests and practical needs, then turn a suggestion into a plan. It considers availability, cost, mobility, transport, hearing and group preferences; explains what might prevent participation; and coordinates a ride or invitation **only with explicit consent**.

> **Why it matters:** A recommendation is not the same as an outing. DayBridge focuses on the barriers between finding something enjoyable and actually attending.

## What you can try

- **Personalized week:** Answer short onboarding questions (or choose a demo person) to get explainable activity matches.
- **Discover opportunities:** Browse public UC Berkeley event listings where live discovery is enabled. Public events are **not automatically verified** for accessibility, eligibility, price or suitability.
- **Get me there:** Review a proposed ride/invitation, approve specific actions, and follow coordination status.
- **Recover from changes:** Simulate a cancelled ride and watch the plan return to a needs-attention state rather than incorrectly remain ready.
- **Caregiver view:** Explore the local caregiver API demo with fictional people, sharing scopes, check-ins and redacted notes. An explicitly labeled same-device view is available when that API is unavailable.
- **Accessible input:** Use easier-view onboarding; opt-in hands-free camera input is also available. The separate Expo mobile app lives in `mobile/`.

## Try the web demo locally

Requires Node.js and npm.

```bash
npm install
cp .env.example .env.local  # optional: defaults support the local mock demo
npm run dev
```

Open **http://localhost:3000**. On Windows PowerShell use `Copy-Item .env.example .env.local` instead.

For a local production build, run `npm run build`, set `DAYBRIDGE_DEMO_EVENTS=1` in `.env.local`, then run `npm start`. This enables simulated coordination and the caregiver API. Set `SHARE_STORE=memory` only if demonstrating sharing. These demo settings are for local use only.

**Suggested three-minute walkthrough**

Use a fresh private browser window, or first select **Margaret** in the person menu at `/home` before starting.

1. At `/`, choose **Demo: Margaret**. Show the actual mock/live explanation label and why the choir's stairs and garden's cost block those outings.
2. On **Dominoes & Pinochle Lounge**, select **Get me there**. Margaret's bus trip would exceed her 30-minute limit; a 15-minute family ride fits.
3. Accept the proposal, review and approve the ride to the sample contact, then send the simulated request. It stays pending until **Ride confirmed (simulated)** makes it **READY**.
4. Select **Ride cancelled (simulated)**. Show **NEEDS_REPLAN**, choose **Central Library Community Room Cards** from the offered alternatives, then **Confirm my plan**. Margaret can use the 15-minute bus route; no replacement ride is invented.
5. Optionally show Margaret's saved activities in Calendar. At `/care`, select Dana and open the separate fictional Margaret record, loading demo records if needed.

**Get me there** carries Margaret's profile into coordination. Keep this same-person flow for the walkthrough: a bare `/coordinate` URL loads a different developer fixture. After the cancelled ride, Margaret has no configured paratransit fallback; recovery changes the outing with her confirmation.

Calendar shows saved activities; it does not automatically reflect this coordination demo's final state. The caregiver Margaret record has its own plans and time zone, so present it as a separate sharing example.

Provider responses in this walkthrough are **simulations**, not actual messages, rides, bookings or attendance confirmations. The demo coordinator uses local process memory, so restarting the server may clear plans.

## Verify the project

```bash
npm run check
npm run build
npm run demo:check
```

The demo smoke check expects the application to be running with simulated coordination enabled; see `scripts/demo-smoke.mjs` for its behavior. Use the default build command, which includes the configured Turbopack stylesheet loader.

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

- Set `DAYBRIDGE_EVENTS=1` for optional live UC Berkeley listings. Discovery preserves unknown suitability fields and may use a five-minute source cache; it does not add events to the personalized week.
- Caregiver demo identities are not sign-in. Hosted caregiver requests return 503 without the local-demo flag; the UI labels any independent same-device fallback. Authorization failures do not enable that fallback.
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
