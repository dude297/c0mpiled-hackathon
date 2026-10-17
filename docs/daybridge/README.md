# DayBridge — Hackathon guide

**DayBridge helps older adults move from “that looks interesting” to a realistic, permission-based plan to participate.**

Event calendars surface possibilities. DayBridge also considers whether the outing fits the person's schedule, mobility, transport, budget and social preferences—and what support is still needed.

## Three-minute demo

1. **Build a week:** Start at `/`, complete onboarding or select a demo person. Explore suggested matches and explanations.
2. **Coordinate:** Choose an outing and select **Get me there**. Review proposed actions and approve each one explicitly.
3. **Show proof:** Simulate a friend RSVP and transport confirmation. The plan becomes **READY** only after its required dependencies are confirmed.
4. **Recover:** Simulate a ride cancellation. The plan leaves READY, explains what changed and offers a new approved path.
5. **Show the broader experience:** Open Home, Calendar or the same-device Caregiver view as time permits.

**Everything involving invitations, RSVPs, ride providers and cancellations in the golden demo is simulated.** The app does not send real messages or book transport. Demo users and some activity details are illustrative.

## Current capabilities

| Capability | Scope |
| --- | --- |
| Matching and barrier analysis | Deterministic constraints and explanations |
| Consent-based coordination | Simulated provider actions, state tracking and recovery |
| Public opportunity discovery | Optional live UC Berkeley listings; source details may be incomplete |
| Onboarding and accessibility | Explicit preference questions, easier view and opt-in hands-free input |
| Web app | Home, Matches, Calendar, Profile and Caregiver screens |
| Mobile | Separate Expo app sharing domain logic |
| Feedback | Reviewable updates rather than silent changes |

## Local setup

From the repository root:

```bash
npm install
npm run dev
```

Open http://localhost:3000. No keys are required for the mock demo. For optional integrations, copy `.env.example` to `.env.local` and follow [environment setup](../integrations/ENV_SETUP.md).

For checks, run `npm run check`, `npm run build -- --webpack` and `npm run demo:check` with the app running for the HTTP smoke test.

## Trust boundaries

- **Requested ≠ confirmed.** A ride request alone cannot make a plan READY.
- **Listed ≠ suitable.** A live public event is not assumed free, accessible or eligible.
- **Consent first.** Invitations, rides, sharing and other side effects require scoped approval.
- **No real purchases or bookings.** Payments, live messaging and production caregiver account linking are out of scope.
- **Local demo first.** In-memory state is not durable cloud storage; experimental Supabase work is separate from the approved demo.

## Architecture and references

The Next.js interface calls a typed API and deterministic TypeScript planning/coordination domain. Optional AI generates explanations or candidate structured facts; it does not authorize actions or decide readiness. Public integrations supply candidate information; simulated provider adapters supply deterministic demo responses.

- [Main README](../../README.md)
- [Engineering specification](PRODUCT_ENGINEERING_SPEC.md) — design rationale and contracts, including proposed/deferred ideas
- [Product goals](../product/GOALS.md)
- [Coordination contract](COORDINATION_CONTRACT.md)
- [Mobile setup](../../mobile/README.md)
