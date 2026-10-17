import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { DEMO_PROFILES } from "@/domain/activities";
import type { CoordinationPlan, PlanState } from "@/lib/schema";
import { NOT_STARTED, type PlanStatus } from "@/components/shell/helpers";
import { buildCareModel, dayAndTime, fieldsInWords, possessive, type CareInput } from "./care-model";
import { CareView, SetUp } from "./CareDashboard";

const ride = (id: string, recipientId: string, status: "proposed" | "approved" = "proposed") => ({
  id,
  interventionId: `i-${id}`,
  planVersion: 1,
  scope: { kind: "ride" as const, activityId: "bridge", recipientId, sharedFields: ["name", "pickupWindow", "mobility"], when: "Wed afternoon" },
  description: "Ride from Dan (6 min)",
  status,
  idempotencyKey: id,
});

function plan(activityId: string, state: PlanState, extra: Partial<CoordinationPlan> = {}): CoordinationPlan {
  return {
    id: `p-${activityId}`,
    contractVersion: "1.0.0",
    version: 1,
    state,
    profile: DEMO_PROFILES.margaret,
    profileVersion: 1,
    contacts: [{ id: "dan", name: "Dan", relation: "son", canDrive: true }],
    activityId,
    activityName: activityId,
    when: "Wed afternoon",
    blockers: [],
    interventions: [],
    actions: [],
    dependencies: [],
    approvals: [],
    alternatives: [],
    preferencePatches: [],
    dataSource: "mock",
    createdAt: "2026-10-17T00:00:00Z",
    updatedAt: "2026-10-17T00:00:00Z",
    ...extra,
  };
}

function input(statuses: Record<string, PlanStatus>, over: Partial<CareInput> = {}): CareInput {
  return {
    name: "Margaret",
    week: ["garden", "bridge"],
    plans: Object.fromEntries(Object.entries(statuses).map(([a, s]) => [a, s.planId ?? "x"])),
    result: null,
    statusFor: (id) => statuses[id] ?? NOT_STARTED,
    unavailable: false,
    ...over,
  };
}
const st = (p: CoordinationPlan): PlanStatus => ({ state: p.state, planId: p.id, plan: p });

describe("care model helpers", () => {
  it("formats day and time, possessives and shared fields in words", () => {
    expect(dayAndTime("Wed afternoon")).toBe("Wednesday afternoon");
    expect(dayAndTime("someday")).toBe("someday");
    expect(possessive("Margaret")).toBe("Margaret's");
    expect(possessive("You")).toBe("Your");
    expect(fieldsInWords(["name", "pickupWindow", "mobility"])).toBe("first name, pickup time and walking aid");
    expect(fieldsInWords(["homeAddress"])).toBe("homeAddress"); // unknown fields are never hidden
  });
});

describe("buildCareModel", () => {
  it("no plan ids yet: every outing Not started, honest start line, calendar primary", () => {
    const m = buildCareModel(input({}));
    expect(m.week.map((o) => o.activityId)).toEqual(["bridge", "garden"]); // Wed before Sat
    expect(m.week.every((o) => o.view.word === "Not started")).toBe(true);
    expect(m.week[0].whenLabel).toBe("Wednesday afternoon");
    expect(m.noPlansYet).toBe(true);
    expect(m.startHref).toBe("/coordinate?activityId=bridge");
    expect(m.needsFixing).toEqual([]);
    expect(m.approvals).toEqual([]);
    expect(m.primary).toEqual({ label: "See Margaret's calendar", href: "/calendar" });
  });

  it("empty week: primary switches to user mode and picks activities", () => {
    const m = buildCareModel(input({}, { week: [] }));
    expect(m.primary).toEqual({ label: "Pick activities with Margaret", href: "/matches", toUserMode: true });
  });

  it("NEEDS_REPLAN comes first, says what changed, and the primary resumes that plan", () => {
    const blocked = plan("garden", "BLOCKED", { blockers: [{ rule: "access", severity: "hard", detail: "Entrance has stairs" }] });
    const replan = plan("bridge", "NEEDS_REPLAN", {
      dependencies: [{ id: "d1", actionId: "a1", kind: "ride", label: "Ride from Dan (6 min)", status: "cancelled", lastSequence: 2 }],
    });
    const m = buildCareModel(input({ garden: st(blocked), bridge: st(replan) }));
    expect(m.needsFixing.map((r) => r.activityId)).toEqual(["bridge", "garden"]);
    expect(m.needsFixing[0].text).toBe("The ride to Central Library Community Room Cards was cancelled. A new plan is waiting.");
    expect(m.needsFixing[1].detail).toBe("Saturday morning · Entrance has stairs");
    expect(m.primary).toEqual({ label: "Open with Margaret", href: "/coordinate?activityId=bridge&planId=p-bridge" });
    expect(m.noPlansYet).toBe(false);
  });

  it("approvals waiting list current-version proposed actions in plain words; caregiver word uses the name", () => {
    const awaiting = plan("bridge", "AWAITING_APPROVAL", { actions: [ride("a1", "dan"), ride("a2", "paratransit", "approved"), { ...ride("a3", "dan"), planVersion: 0 }] });
    const m = buildCareModel(input({ bridge: st(awaiting) }));
    expect(m.approvals).toEqual([
      { key: "bridge:a1", activityId: "bridge", what: "Ride with Dan", detail: "Central Library Community Room Cards · Wednesday afternoon", href: "/coordinate?activityId=bridge&planId=p-bridge" },
    ]);
    expect(m.week.find((o) => o.activityId === "bridge")!.view.word).toBe("Needs Margaret's OK");
    expect(m.primary.label).toBe("Open with Margaret");
  });

  it("an outing needing her OK wins the primary over an earlier plan that is only started", () => {
    const proposed = plan("walk", "PROPOSED");
    const awaiting = plan("bridge", "AWAITING_APPROVAL", { actions: [ride("a1", "dan")] });
    const m = buildCareModel(input({ walk: st(proposed), bridge: st(awaiting) }, { week: ["walk", "bridge"] }));
    expect(m.week[0].activityId).toBe("walk"); // Monday comes first in the week
    expect(m.primary.href).toBe("/coordinate?activityId=bridge&planId=p-bridge");
  });

  it("what was shared: per approval, revoked kept and flagged", () => {
    const ready = plan("bridge", "READY", {
      approvals: [
        { id: "ap1", actionId: "a1", scope: ride("a1", "dan").scope, approvedBy: "user", approvedAt: "", expiresAt: "", revoked: false },
        { id: "ap2", actionId: "a2", scope: ride("a2", "paratransit").scope, approvedBy: "user", approvedAt: "", expiresAt: "", revoked: true },
      ],
    });
    const m = buildCareModel(input({ bridge: st(ready) }));
    expect(m.shared.map((s) => [s.recipient, s.kind, s.revoked])).toEqual([["Dan", "ride", false], ["Paratransit", "ride", true]]);
    expect(m.shared[0].fields).toBe("first name, pickup time and walking aid");
    expect(m.primary.label).toBe("See Margaret's calendar"); // everything Ready
  });

  it("503: no fix/approval/shared rows and the calendar is the primary", () => {
    const replan = plan("bridge", "NEEDS_REPLAN");
    const m = buildCareModel(input({ bridge: st(replan) }, { unavailable: true }));
    expect(m.needsFixing).toEqual([]);
    expect(m.shared).toEqual([]);
    expect(m.primary.href).toBe("/calendar");
  });
});

describe("C1 markup", () => {
  it("shows the demo label once, exactly one primary, and never an approve button", () => {
    const awaiting = plan("bridge", "AWAITING_APPROVAL", { actions: [ride("a1", "dan")] });
    const model = buildCareModel(input({ bridge: st(awaiting) }));
    const html = renderToStaticMarkup(createElement(CareView, { model, unavailable: false, analyzing: false, error: null }));
    expect(html.match(/Same-device demo/g)).toHaveLength(1);
    expect(html.match(/min-h-14/g)).toHaveLength(1);
    expect(html).toContain("Margaret&#x27;s week");
    expect(html).toContain("Only Margaret can say OK");
    expect(html).not.toMatch(/approve/i);
    expect(html).not.toMatch(/AWAITING_APPROVAL|READY|NEEDS_REPLAN/);
  });

  it("no saved answers: one Set up action to onboarding", () => {
    const html = renderToStaticMarkup(createElement(SetUp, { name: "Margaret" }));
    expect(html).toContain("Set up Margaret");
    expect(html).toContain('href="/"');
  });
});
