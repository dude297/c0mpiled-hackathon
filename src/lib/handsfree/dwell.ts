import type { Side, Zone } from "./signals";

// Pure dwell state machine. Feed it one sample per video frame:
//   zone: where the person is pointing (null = no face this frame), t: timestamp in ms.
// A side fires after being held continuously for dwellMs. After firing (and at the very start)
// the person must rest in the center for rearmMs before another answer can fire.

export type DwellState = {
  armed: boolean;
  centerSince: number | null;
  side: Side | null;
  sideSince: number;
};

export type DwellStep = { state: DwellState; progress: number; side: Side | null; fired: Side | null };

export const initialDwell = (): DwellState => ({ armed: false, centerSince: null, side: null, sideSince: 0 });

export function stepDwell(
  state: DwellState,
  zone: Zone | null,
  t: number,
  dwellMs: number,
  rearmMs: number,
): DwellStep {
  // Losing the face resets everything except the "must return to center" requirement.
  if (zone === null) {
    return { state: { ...state, centerSince: null, side: null }, progress: 0, side: null, fired: null };
  }

  if (!state.armed) {
    if (zone !== "center") {
      return { state: { ...state, centerSince: null, side: null }, progress: 0, side: null, fired: null };
    }
    const centerSince = state.centerSince ?? t;
    const armed = t - centerSince >= rearmMs;
    return { state: { armed, centerSince, side: null, sideSince: 0 }, progress: 0, side: null, fired: null };
  }

  if (zone === "center") {
    return { state: { ...state, side: null }, progress: 0, side: null, fired: null };
  }

  const sideSince = state.side === zone ? state.sideSince : t;
  const progress = Math.min(1, Math.max(0, (t - sideSince) / dwellMs));
  if (progress >= 1) {
    return { state: initialDwell(), progress: 1, side: zone, fired: zone };
  }
  return { state: { ...state, side: zone, sideSince }, progress, side: zone, fired: null };
}
