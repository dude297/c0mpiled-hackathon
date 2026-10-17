# Person profiles: versioned, confirmed updates

Stacked on the caregiver backend (PR #33). Code: `src/domain/caregiver/profiles.ts` (pure rules), `src/domain/caregiver/contract.ts` (types), `src/domain/caregiver/store.ts` (port + memory impl), `src/app/api/caregiver/people/[id]/profile/**` (routes).

## Model
- `Person.profileVersion` (int, starts at 1) + `Person.profile` = the current profile. Absent on legacy rows means 1.
- `ProfileVersion {personId, version, profile, createdAt, createdBy, source: create|caregiver|self|intake|feedback|revert, proposalId?}`: append-only history. Version 1 (`create`) is written by `createPerson`.
- `ProfileProposal {proposalId, personId, baseVersion, changes, evidence (≤280), source, proposedBy, planId?, status: proposed|confirmed|rejected|stale, createdAt, decidedAt?, decidedBy?}`. `changes` is `Profile.partial().strict()`: each field is validated by `Profile.shape`, and unknown fields are rejected.
- `PlanLink.profileVersion` records the person profile version a plan was created from. `POST /people/:id/plans` always uses the current profile.

**Rule:** a proposal never changes the profile. Only confirm and revert append a version.

## Endpoints (`/api/caregiver`)
| Method | Path | Who | Result |
|---|---|---|---|
| GET | `/people/:id/profile` | view, or self | `{profile, version, labels}` |
| GET | `/people/:id/profile/versions?limit&cursor` | view, or self | `{items (newest first), nextCursor}`; max limit 50 |
| GET | `/people/:id/profile/proposals?status=` | view, or self | `{proposals}`, newest first |
| POST | `/people/:id/profile/proposals` `{changes, evidence, baseVersion, source?}` | checkin, manage, or self | 201 `{proposal}`. A no-op field is dropped; all no-op → 400. Stale `baseVersion` → 409. Source is forced to `self` for the person; `self` from anyone else → 400 |
| POST | `/people/:id/profile/proposals/:pid/confirm` `{expectedVersion}` | manage, or self | 200 `{proposal, version, profile}`. Base ≠ current → 409 `{status:"stale"}` and the proposal is marked stale. `expectedVersion` ≠ current → 409 (proposal stays open). Already decided → 409 |
| POST | `/people/:id/profile/proposals/:pid/reject` | manage, or self | 200 `{proposal}` |
| POST | `/people/:id/profile/revert` `{toVersion, expectedVersion}` | manage | 201 `{version, profile, revertedTo}`: a NEW version with the old profile |
| POST | `/people/:id/plans/:planId/feedback-proposals` | manage or checkin | Plan must be linked to that person (else 404) and COMPLETED (else 409). The plan's `proposed` preference patches are re-validated and become ONE proposal (`source: "feedback"`, `planId`). 201, or 200 `duplicate:true` if an open one exists. It never confirms anything and never touches the plan |

**Errors:**
- A caller with no grant who is not the person → 404 (no existence leak).
- Missing scope → 403.

**Self access:** the person (`selfUserId`) may read their own profile, and may propose, confirm and reject changes to it. They cannot revert, and cannot import feedback. This extends PR #33's "self = check-in only" rule to the person's own preferences.

When any version is appended, every other open proposal for that person becomes `stale`, because its base is gone.

## Store port additions (for the Supabase adapter)
Every op is async, exchanges JSON, and must be atomic (one transaction or RPC).

| Method | Contract |
|---|---|
| `createPerson` | also inserts version 1 (`source:"create"`) and sets `profile_version = 1` |
| `createProposal(p)` | `"stale"` unless `p.baseVersion = person.profile_version`; `"not_found"` if no person |
| `getProposal(id)`, `listProposals(personId)` | reads; list oldest first |
| `decideProposal({personId, proposalId, decision, expectedVersion?, decidedBy, at})` | `SELECT … FOR UPDATE` on the person and proposal. Order: `not_found`, then `stale` (already stale), then `not_pending`. Reject → set status. Confirm: base ≠ current → mark stale and return `"stale"`; `expectedVersion` ≠ current → `"version_conflict"`; else `profile = profile \|\| changes` (jsonb merge), version + 1, insert a version row (`source` = the proposal source, `proposal_id`), mark the proposal confirmed, and mark the other open proposals stale |
| `appendVersion({personId, expectedVersion, profile, source, createdBy, at, proposalId?})` | compare-and-append; `"stale"` on mismatch; marks open proposals stale |
| `listVersions(personId)` | oldest first |

Suggested tables:

```sql
alter table people add column profile_version int not null default 1;
alter table plan_links add column profile_version int;

create table person_profile_versions (
  person_id uuid not null references people(person_id) on delete cascade,
  version int not null,
  profile jsonb not null,
  source text not null check (source in ('create','caregiver','self','intake','feedback','revert')),
  proposal_id uuid,
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (person_id, version)
);

create table profile_proposals (
  proposal_id uuid primary key,
  person_id uuid not null references people(person_id) on delete cascade,
  base_version int not null,
  changes jsonb not null,
  evidence text not null check (char_length(evidence) <= 280),
  source text not null check (source in ('caregiver','self','intake','feedback')),
  proposed_by text not null,
  plan_id text,
  status text not null default 'proposed' check (status in ('proposed','confirmed','rejected','stale')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text
);
create index on profile_proposals (person_id, status);
```

`unique(person_id, version)` is the backstop: two racing confirms cannot both write version N+1. On a unique violation, return `"stale"`.
