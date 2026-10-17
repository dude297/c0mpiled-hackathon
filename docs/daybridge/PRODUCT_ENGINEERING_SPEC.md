# DayBridge

**Product & Engineering Specification — Reach platform / Unlock hackathon MVP**  
**Version:** 0.1 | **Date:** October 17, 2026 | **Status:** Working design / implementation handoff

> **One-line pitch:** DayBridge helps older adults participate in activities they actually want to attend by discovering the barriers, computing the smallest feasible intervention, coordinating the plan with permission, and learning from what happens.

**Document convention:** **DECIDED** = direction previously agreed in brainstorming; **PROPOSED** = recommended implementation choice to validate during build; **DEFERRED** = explicitly outside the hackathon MVP. The example users and events in this document are fictional demo fixtures, not verified availability or real commitments.

## 1. Executive summary

DayBridge is **not another activity recommendation chatbot**. Existing calendars, event search, and messaging tools may identify interesting events, but they do not reliably connect a person's preferences and real constraints to an outcome. For an older adult, a plan can fail because of a ride, timing, unsuitable group size, cost, accessibility, uncertainty about who else is going, or last-minute cancellation.

**DECIDED product structure:**

- **DayBridge Reach:** Long-term product: an adaptive participation companion and coordination platform.
- **DayBridge Unlock:** Hackathon-ready core: find the binding barrier to participation and propose the minimum viable, feasible intervention; obtain consent; coordinate invitations, RSVPs, transport; replan on disruption; learn preferences through feedback.
- **DayBridge Collective:** Future module for group marketplace/purchasing and group negotiation. Not a dependency of Unlock.

**Hackathon thesis:** The demo should prove that DayBridge turns an otherwise unsuccessful plan into a feasible, consented, coordinated plan, and can recover when one assumption changes. The agent's value must be observable in **state changes, constraint satisfaction, and verified coordination**, not just a pleasant response.

### 1.1 North-star outcome

**Confirmed participation-ready plans**, defined as plans that (a) satisfy hard constraints, (b) have user approval, (c) have required participant RSVPs, (d) have a confirmed transport plan if needed, and (e) have no unresolved blocking issue. Actual attendance is recorded only with a confirmation signal; never inferred solely from an RSVP.

### 1.2 Product principles

1. **Participation, not recommendations.** Focus on removing an obstacle.
2. **Autonomy with permission.** Prepare and propose autonomously; execute external actions only when explicitly authorized.
3. **Hard constraints before preferences.** Never trade an accessibility requirement for a higher match score.
4. **Explain the intervention.** Show which barrier changed and why.
5. **Preference learning is reviewable.** Confirm consequential inferences and allow correction.
6. **Local-first AI option.** Keep model inference behind an adapter to enable on-device/local deployment.
7. **Demo reliability.** Core transitions should run deterministically with reproducible fixtures.

## 2. Users, problems and jobs to be done

**Primary user:** An older adult who wants to participate in community, educational, leisure, or social activities while maintaining control over their choices. Design for clarity and dignity; do not assume technical helplessness or medical disability.

**Secondary users:** Invited friends or group participants, family supporters when delegated, community organizers, and approved transport providers.

**Jobs to be done**

| Need | Example barrier | What DayBridge changes |
|---|---|---|
| Find something genuinely appealing | Recommendations are generic | Learns interests, group size and preferred setting |
| Make the plan possible | No reliable ride, time conflict, cost cap | Models requirements and finds a feasible alternative |
| Reduce social uncertainty | Not sure who will join | Sends approved invitations and tracks RSVP state |
| Handle a disruption | Ride cancels after invitation | Recalculates options, asks approval for changes |
| Learn from experience | “The activity was fun but the crowd was too big” | Proposes an explicit, reviewable preference update |

**Non-goals:** Diagnosing loneliness, providing medical care or emergency response, replacing a human care coordinator, inferring protected/health traits, or guaranteeing transportation or attendance.

## 3. Scope: the winning Unlock MVP

### 3.1 P0 — must work in a live demo

| ID | Feature | Acceptance criterion |
|---|---|---|
| P0-1 | Profile + explicit constraints | User can enter/edit availability, activity interests, group-size preference, travel limitations, spend cap and contacts; hard/soft labels are visible |
| P0-2 | Barrier discovery | For a selected event, system identifies blocking constraints with an explanation rather than hallucinating feasibility |
| P0-3 | Minimum-intervention planner | Returns feasible plan(s) ranked by intervention burden, with transparent trade-offs and a 'no feasible option' result when appropriate |
| P0-4 | Consent-gated invitations / RSVP | No outbound invitation without approval; participant responses update plan state |
| P0-5 | Transport coordination | Model a verified or simulated ride option with accepted/declined/unknown state; never label unknown as booked |
| P0-6 | Disruption and replanning | Simulated ride cancellation triggers a new constraint solve and an explicit revised proposal |
| P0-7 | Feedback learning | Natural-language feedback creates a proposed change to an explainable preference; it is applied only after confirmation |
| P0-8 | Observability | UI shows the current plan state, blocking reasons, approved actions, audit/event timeline, and before/after result |

### 3.2 P1 — valuable if P0 is solid

- Provider adapters for genuine email or calendar integrations; live send requires explicit approval and credentials.
- Small-group activity coordination (more than one invitation); accessibility and location-aware planning when reliable data exists.
- Confidence indicators for extracted preferences, simple comparative evaluation dashboard, and local model streaming.

### 3.3 P2 — deferred beyond hackathon

**DayBridge Collective** bargaining/group purchases, provider-negotiated offers, payment execution/Stripe, groceries, medication workflows, voice concierge, broad consumer marketplace, autonomous monetary commitments, and complex caregiver permission trees. Keep only a modular seam for later extensions.

## 4. Golden demo scenario (fictional fixture)

**Persona:** Maya, age 72, is interested in an art workshop but prefers small groups and needs a reliable ride. Her friend Elaine might join. The data and provider responses are **demo fixtures**, not actual event inventory or reservations.

**Initial state:** A Saturday art class fits Maya's interests, but transit is not feasible for her preferred travel constraints and Elaine has not committed. The calendar recommendation alone has not produced a participation-ready plan.

1. Maya says, “I'd love to go to the art workshop, but I can't get there by myself. I also don't want a huge group.” The language model extracts candidate preferences and constraints; the user confirms them.
2. DayBridge checks the workshop and candidate transportation/group options. The deterministic solver marks a missing ride as **blocking** and finds the smallest change that preserves her time and small-group requirement.
3. UI explains: “The activity fits. A confirmed ride is the only unresolved blocker. Proposed intervention: ask Elaine if she can share the trip; fallback: a preapproved ride service if within budget.”
4. Maya explicitly approves an invitation. The demo transport/email adapter returns an RSVP and then a ride confirmation. Only now does the plan move to **READY**.
5. Inject a disruption: Elaine cancels the ride. DayBridge moves the plan to **NEEDS_REPLAN**, identifies the broken dependency, and proposes another feasible ride or a different workshop; it does not silently spend money or message anyone.
6. Maya approves the revised plan. After the simulated event, she says, “I liked the art, but I'd prefer an even smaller group next time.” DayBridge suggests an explicit group-size preference update and requests confirmation.

**Visible transformation:** blocked plan → approved invitation → confirmed participation-ready plan → disruption → approved recovery → learned preference.

**Demo fallback:** All external replies can be simulated with deterministic buttons (“accept”, “decline”, “ride cancelled”) so the end-to-end loop works offline. Clearly identify simulation in the UI and judge narration.

## 5. Agent workflow and state machine

### 5.1 The autonomy boundary

The **LLM interprets, summarizes, and proposes**; the **deterministic application layer decides feasibility, checks authority, transitions state, and triggers authorized actions**. A persuasive model response must not bypass constraints or consent.

**Pipeline**

`Conversation / feedback → structured candidate facts → validation & confirmation → constraint solver → ranked intervention proposals → approval gate → provider adapters → event log / RSVP monitoring → replanning → outcome feedback`.

### 5.2 Plan states

| State | Meaning | Valid next events |
|---|---|---|
| DRAFT | User intent captured, fields incomplete | facts_confirmed, abandoned |
| BLOCKED | One or more hard conditions are unmet | plan_proposed, abandoned |
| PROPOSED | Feasible intervention(s) ready, not authorized | user_approved, user_rejected, facts_changed |
| APPROVED | Permission for named actions was captured | invitation_requested, ride_requested, approval_expired |
| COORDINATING | Invitations, RSVPs or transport are pending | participant_accepted, participant_declined, ride_confirmed, timed_out |
| READY | Required dependencies are confirmed | disruption_detected, event_completed, user_cancelled |
| NEEDS_REPLAN | A dependency was invalidated | plan_proposed, user_cancelled |
| COMPLETED | Attendance/outcome feedback registered | feedback_proposed, closed |
| CANCELLED | User ended the plan | closed |

**Invariant:** READY is impossible when a required ride is unknown, an invited required companion has not RSVP'd, or an applicable approval is missing. “Requested” is not “confirmed”. Event completion does **not** automatically mean verified attendance.

### 5.3 External-action policy

- Read-only discovery and internal calculations can occur without external side effects.
- Inviting a person, sending email/SMS, contacting a transport provider, booking, sharing sensitive details, or spending money needs a **specific, logged approval**.
- Every action records actor, scope, timestamp, target, idempotency key and final status.
- Retry only when safe; never double-invite or double-book due to a timeout.
- User can revoke unsent actions, correct profile details, or cancel the plan.

## 6. Preference model and feedback learning

Preferences should be structured and explainable, not a single opaque “user embedding.” Separate **hard constraints** from **soft preferences** and permit unknown values.

| Dimension | Example | Type |
|---|---|---|
| Interests | arts = high, walking groups = medium | Soft |
| Group size | prefer 2–5 people | Soft, or Hard when confirmed |
| Timing | available Saturday afternoons | Hard availability |
| Travel | cannot use public transit for this outing | Hard for the plan |
| Budget | max $20 out-of-pocket | Hard |
| Social preference | enjoys familiar faces | Soft |
| Communication | asks before inviting Elaine | Permission rule |

**Learning loop:** raw user feedback → candidate atomic updates (field, old value, proposed value, evidence, confidence) → explain “I heard...” → confirm/correct → append `preference.updated` event → rerank future activities. Keep provenance and version so a user can reverse a change. Do not infer a disability, diagnosis, religion, or other sensitive trait from casual conversation.

**Example feedback:** “Fun class, but I got overwhelmed by twelve people.” Proposed change: group-size soft preference from `2–10` to `2–5`; confidence 0.80; **needs confirmation**. A suggestion is not yet an applied update.

**Evaluation:** At least one test must show that two identical planning inputs yield different *explainable* rankings after a confirmed preference update, while all hard constraints still pass.

## 7. Minimum-intervention planning engine

The core differentiator is solving **what minimally needs to change for attendance to become possible**.

**Inputs:** person constraints `C`, activity `A`, optional companions `G`, candidate interventions `I` (rides, time swaps, invitations, alternate events), provider facts `F`, and user permissions `P`.

**Hard feasibility:** activity open/available; no schedule conflict; accessibility/travel requirements met; spending limit satisfied; required participants and rides confirmed before READY; approvals exist before external actions.

**Soft objective (PROPOSED):** Among feasible candidates, minimize a weighted intervention cost:

`cost(i) = w_money·out_of_pocket + w_effort·user_steps + w_disruption·schedule_change + w_social·preference_mismatch + w_uncertainty·unverified_dependencies`

**Important:** Weights are product parameters; the model may suggest candidate interventions but **does not select an infeasible option**. For the MVP, enumerate a small, finite option set and score it deterministically. No need for a sophisticated optimizer or ML model to demonstrate the core idea.

**Outputs:** feasible candidates, hard-constraint pass/fail report, intervention cost components, blocking dependencies, explanation trace, and the smallest feasible action list. If none pass, show “No feasible option yet” with the missing facts.

**Core algorithm sketch:**

```text
facts = validate(extracted_facts, user_confirmed_constraints)
options = generate_candidates(activity_catalog, ride_options, invitees)
feasible = [o for o in options if satisfy_hard_constraints(o, facts)]
if feasible is empty:
    return BLOCKED(blocking_reasons)
ranked = sort(feasible, by=weighted_intervention_cost)
return PROPOSED(ranked[0:3], explanations, permissions_required)
```

A verified side effect (e.g., accepted RSVP) updates evidence and triggers a new feasibility evaluation. It is not treated as success on request dispatch.

## 8. Proposed technical architecture

**DECIDED foundation:** Next.js, TypeScript, replaceable inference adapters, deterministic core rules, JSON fixtures and Vitest. Keep deployment attempts scarce by validating locally.  
**PROPOSED build details:** Next.js App Router, a small service layer, SQLite for local demo state (or an equally simple durable store), Zod contract validation, a local OpenAI-compatible inference endpoint through Ollama/llama.cpp (one adapter selected based on available hardware), and mocked providers first. These tools are choices to verify, **not established commitments**.

```text
[Next.js UI: profiles / barriers / plan / approvals / audit]
                         |
                     [API layer]
                         |
       +-----------------+--------------------+
       |                 |                    |
 [LLM adapter]    [Planning engine]    [Consent policy]
 local / cloud     pure TypeScript      explicit approval
       |                 |                    |
       +----------[Mission orchestrator]-----+
                         |
                  [Event & state store]
                         |
          [Provider adapters / simulations]
      activities | invite/email | RSVP | transport
                         |
                [Disruption monitor]
```

**Separation of concerns**

| Module | Owns | Must not own |
|---|---|---|
| `ai/` | Text-to-candidate-facts, explanations, feedback extraction | Approvals, direct booking, state truth |
| `domain/` | Typed entities, constraints, ranking, state machine | Network calls, model prompts |
| `missions/` | Workflow orchestration and idempotent transitions | Policy bypass |
| `policy/` | Consent rules and permission checks | LLM-generated authorization |
| `adapters/` | Mock and real integration implementations | Product decisions |
| `store/` | Persistence, events, audit trail | Hidden side effects |
| `app/` | Accessible user interactions, approval surfaces | Business logic in components |

### 8.1 Repository layout (PROPOSED)

```text
daybridge/
  app/                         # Next.js pages, forms, demo console
  src/domain/                  # schemas, constraints, scoring, states
  src/missions/                # orchestrator, event handlers
  src/ai/                      # extraction and explanation adapters
  src/policy/                  # consent evaluator
  src/adapters/{mock,local}/   # providers and LLM implementations
  src/store/                   # storage and event log
  src/demo/fixtures/           # profiles, activities, disruptions
  tests/{unit,integration,e2e}/
  docs/                        # spec, decision log, README
  .env.example
```

### 8.2 Suggested inference policy

Use local inference for **natural-language extraction and explanation**, and keep the rest deterministic. Inference should produce Zod-valid JSON, not a raw instruction to dispatch an action. The demo remains functional with a fixture-based parser if the model endpoint fails. Cloud adapters are useful for development comparison but are not needed for the core demo.

## 9. Contracts and sample data

Below are **reference contracts**, not yet implemented source code. Keep all IDs fictional in fixtures.

```ts
type PlanState =
  | 'DRAFT' | 'BLOCKED' | 'PROPOSED' | 'APPROVED'
  | 'COORDINATING' | 'READY' | 'NEEDS_REPLAN'
  | 'COMPLETED' | 'CANCELLED';

type Fact = {
  field: string;
  value: unknown;
  kind: 'hard' | 'soft' | 'permission';
  source: 'explicit' | 'feedback' | 'provider';
  confirmed: boolean;
};

type Intervention = {
  id: string;
  kind: 'ride' | 'invite' | 'time_change' | 'alternative_activity';
  description: string;
  costEstimate?: number;
  feasibility: 'feasible' | 'blocked' | 'unknown';
  blockingReasons: string[];
  approvalRequired: boolean;
};

type Plan = {
  id: string;
  userId: string;
  activityId: string;
  state: PlanState;
  selectedInterventions: string[];
  requiredDependencies: string[];
  approvedActionIds: string[];
  version: number;
};

type DomainEvent = {
  eventId: string;
  planId: string;
  type: string;
  at: string;
  actor: 'user' | 'agent' | 'provider' | 'demo';
  idempotencyKey?: string;
  payload: Record<string, unknown>;
};
```

**Suggested event names:** `profile.facts_confirmed`, `plan.blocked`, `plan.proposed`, `action.approved`, `invite.requested`, `invite.accepted`, `ride.requested`, `ride.confirmed`, `ride.cancelled`, `plan.replan_required`, `plan.ready`, `feedback.preference_proposed`, `preference.updated`. Avoid collapsing `requested` and `confirmed` into one status.

### 9.1 Provider interface

```ts
interface InvitationAdapter {
  sendApprovedInvite(input: { planId: string; contactId: string;
    approvedActionId: string; idempotencyKey: string }): Promise<{
      requestId: string; status: 'requested' | 'failed';
    }>;
}

interface TransportAdapter {
  requestApprovedRide(input: { planId: string; optionId: string;
    approvedActionId: string; idempotencyKey: string }): Promise<{
      requestId: string; status: 'requested' | 'failed';
    }>;
}
```

Neither `sendApprovedInvite` nor `requestApprovedRide` returns confirmation of acceptance merely because a request was accepted by an API. Confirmation requires a separate provider or participant event.

### 9.2 API surface (PROPOSED)

| Method / route | Contract |
|---|---|
| `POST /api/profile/facts` | Extract tentative profile fields; no side effects |
| `POST /api/profile/confirm` | Confirm/update preference or constraint version |
| `POST /api/plans` | Create a plan from a selected activity |
| `POST /api/plans/:id/evaluate` | Return blockers, feasible interventions and proof |
| `POST /api/plans/:id/approve` | Authorize named actions only |
| `POST /api/plans/:id/execute` | Dispatch only approved actions, idempotently |
| `POST /api/demo/events` | Inject deterministic fixture events (demo-only, disabled in production) |
| `GET /api/plans/:id/timeline` | Show event trail and authoritative state |
| `POST /api/feedback` | Propose, then confirm a preference update |

## 10. Trust, privacy and safety

**User agency:** The user can view why a constraint exists, correct it, approve an individual action, and cancel. Interfaces should not pressure participation or frame user preferences as deficiencies.

**Least data:** Store only what is required for scheduling/coordination. Do not use free-form sensitive personal histories as the default profile. Collect contact details or accessibility needs only when necessary and with permission.

**Privacy by design:** Keep roles separated; do not reveal travel/accessibility notes to peers unless the user approves that disclosure. Log permission scope, not unnecessarily verbose private conversations. Credentials stay server-side; `.env` remains uncommitted.

**Operational honesty:** UI distinguishes **proposed**, **requested**, **approved**, **accepted**, **confirmed**, **cancelled**, **completed**, and **verified attendance**. A mocked provider must be labeled **SIMULATED**. Never claim a ride was booked, a person accepted, or an event is available without an appropriate evidence event.

**Failure cases:** Unknown provider status → remain pending; no feasible alternative → explain limits; late RSVP → recompute; lost network → replay idempotently; model returns malformed JSON → reject/retry or use fixture parser; revocation → block future unauthorized calls.

## 11. Evaluation and tests

**What winning evidence looks like:** a reproducible before/after comparison showing that a blocked scenario becomes READY only after the correct barrier is resolved, not by violating constraints. Include a disrupted scenario and a learned-preference scenario.

| Metric | Definition | Hackathon target (PROPOSED) |
|---|---|---|
| Hard-constraint violations | Plans marked READY despite an unsatisfied required constraint | **0** across fixtures |
| Unauthorized external actions | Provider calls without specific approval | **0** |
| Recovery correctness | Disruptions that revoke READY and create a valid replan | **100%** of defined disruption fixtures |
| Explanation traceability | Proposed intervention tied to named barrier and evidence | Every shown plan |
| Feedback persistence | Confirmed preference changes influence later ranking | At least one end-to-end case |
| Demo stability | Golden path completes without live external services | 100% in repeated local rehearsals |

**Minimum fixture suite:** (1) only ride blocked; (2) hard cost ceiling; (3) accessibility conflict; (4) companion declines; (5) pending/unknown RSVP; (6) ride cancellation after READY; (7) user rejects outbound invitation; (8) duplicate webhook and retry; (9) feedback preference shifts ranking; (10) zero feasible options.

**Testing pyramid:** Unit tests for constraints, score, transitions and approvals; integration tests for mock adapters plus persistence; one automated golden-path browser test if time allows. Test correctness locally prior to cloud deployment.

## 12. Hackathon delivery and demo plan

### 12.1 Demo sequence (4–5 minutes, proposed)

| Time | Show | Judge takeaway |
|---|---|---|
| 0:00–0:35 | Maya's desired art workshop; highlighted ride blocker | The problem is real and concrete |
| 0:35–1:20 | Constraint diagnosis and minimum-intervention proof | More than a recommendation chatbot |
| 1:20–2:00 | Consent screen and approved invitation/ride simulation | Agency and safe autonomy |
| 2:00–2:35 | RSVP + ride evidence; plan changes to READY | Observable result |
| 2:35–3:25 | Inject cancellation; READY revoked; new proposal | Robust event-driven agent |
| 3:25–4:10 | Feedback leads to a confirmed preference update | Learning loop, not static prompt |
| 4:10–4:45 | Architecture, local inference, test metrics | Technical credibility and reproducibility |

**Suggested pitch:** “Event apps suggest what you could do. DayBridge finds what's stopping you from actually going—and coordinates the smallest safe change that makes it possible.”

**Judge objections to preempt:**

- **“Isn't this just ChatGPT plus a calendar?”** No: explicit hard constraints, minimum-intervention ranking, permissioned side effects, real state transitions, disruption recovery and testable readiness.
- **“Does the agent really act?”** It progresses a multi-step mission through approved simulated or live adapters. State changes are driven by provider evidence, not generated text.
- **“How do we trust it?”** Unconfirmed plans cannot be READY; outbound actions require auditable approval; failure states are explicit.
- **“Where is AI required?”** The local model converts messy natural language into validated candidate facts and feedback updates and explains decisions; deterministic logic enforces correctness.

### 12.2 Time-boxed development sequence

| Phase | Priority | Deliverable / exit gate |
|---|---|---|
| Foundation | First | App runs locally, types / fixtures / Vitest pass |
| Domain core | Next | Pure feasibility solver + tests; state machine + consent tests |
| Agent layer | Next | Local inference to JSON schema with deterministic fallback |
| Mission loop | Next | Approvals → simulated invites / ride → confirmations → READY |
| Recovery + learning | Next | Disruption replan, confirmed feedback changes ranking |
| Demo hardening | Last | Accessible UI, event timeline, script, benchmark panel, rehearsals |

**Deployment discipline:** Prefer local execution and mock integrations. Deploy after the golden scenario is verified, then only for meaningful milestones; avoid redeploying on minor changes because past hackathons hit deployment caps. Keep a run script, seeded fixtures, and an offline demo path that survives Wi-Fi failure.

## 13. Risks, mitigations and roadmap

| Risk | Mitigation |
|---|---|
| Scope balloons into a social marketplace | Enforce P0/P1/P2; postpone Collective/payments |
| Local model latency or malformed outputs | JSON schema validation, short prompts, timeout + deterministic fallback |
| External provider unavailable | Honest mock adapters and state-labeled simulation |
| “Agent” is only a static scripted demo | Real editable inputs, transition rules and adversarial fixtures |
| Privacy and autonomy concerns | Named approvals, minimum data, no automatic outreach |
| Optimizer overcomplication | Enumerate a bounded option set; deterministic weighted ranking |
| Unclear claims of impact | Report participation-ready evidence; distinguish simulated from actual attendance |

**Post-hackathon roadmap:** expand actual community-provider inventory; add verified mobility/transport provider integrations; richer delegated participation coordination; optional small-group coordination; only then pursue DayBridge Collective with permissioned group marketplace logic. A paid-provider/payment capability requires separate security, legal and operational work.

## 14. Implementation handoff: non-negotiables and decisions

**Non-negotiable acceptance checklist**

- [ ] A user can correct preferences and hard constraints.
- [ ] System visibly identifies the binding blocker for a selected activity.
- [ ] At least one minimum-intervention feasible plan is explainable.
- [ ] Every outbound action is tied to approval and logged.
- [ ] `READY` is evidence-based; pending is never silently treated as confirmed.
- [ ] A disruption invalidates an earlier READY plan and triggers a new proposal.
- [ ] Feedback creates a reviewable suggestion, and confirmation changes future ranking.
- [ ] Golden demo runs locally with mock provider events and tests pass.
- [ ] Local inference is genuine when enabled; failed inference doesn't compromise core safety.
- [ ] No payments, medication, groceries, voice or group negotiation in MVP.

**Open decisions for the team:** exact runtime/model supported on demo hardware; persistence store; whether a real messaging integration is worth the setup; evaluation weights; which participation/transport data can be verified live. Record choices in `docs/decisions.md`. None should block the deterministic fixture demo.

### 14.1 Ready-to-paste coding-agent brief

> **Build DayBridge Unlock, not the full Reach/Collective platform.** Start with Next.js + TypeScript and a locally runnable, deterministic domain layer. Treat this spec as the source of truth. Implement typed profile and event fixtures, constraint feasibility with blocking explanations, an intervention ranking function, an explicit consent policy, a plan state machine and event log, mocked invite/RSVP/transport adapters, a disruption/replanning trigger, and preference-update confirmation. Use Vitest for hard constraints, approval, duplicate-event handling, and golden-path progression. Then add a local LLM adapter strictly for schema-validated extraction and explanation; never let model output directly call external tools or set plan state. Build an accessible demo UI with a prominent **SIMULATED** label on test provider actions and a reproducible sequence: blocked → proposed → approved → coordinating → ready → disrupted → replan → feedback learned. Implement only P0 until green tests, then consider P1. Keep deployment count low; finish with a README, run commands, env example, and known limitations.

---

**Design status:** This specification converts our DayBridge brainstorming into an implementable baseline. It is not evidence of a deployed system, existing partnerships, availability of real-world events, or legal readiness to operate a transport/booking service.