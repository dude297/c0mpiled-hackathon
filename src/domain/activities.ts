import type { Profile } from "@/lib/schema";

type Interest = Profile["interests"][number];
type TimeSlot = Profile["times"][number];
type Transport = Profile["transport"][number];

export type Activity = {
  id: string;
  name: string;
  tags: Interest[];
  day: "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
  time: TimeSlot;
  costPerWeek: number;
  // minutes one way by each mode; a missing mode means it's not a practical way to get there
  travelMin: Partial<Record<Transport, number>>;
  stepFree: boolean;
  groupSize: "small" | "large";
  noisy: boolean;
  hearingLoop: boolean;
};

// ponytail: seeded demo catalog, swap for a real listings source if the demo needs live data.
export const ACTIVITIES: Activity[] = [
  { id: "choir", name: "Community Center Choir", tags: ["music", "faith"], day: "Tue", time: "afternoon", costPerWeek: 0, travelMin: { drive: 10, bus: 25, paratransit: 30, family: 10 }, stepFree: false, groupSize: "large", noisy: true, hearingLoop: false },
  { id: "garden", name: "Neighborhood Garden Club", tags: ["gardening", "walking"], day: "Sat", time: "morning", costPerWeek: 5, travelMin: { drive: 8, bus: 20, walk: 15, family: 8 }, stepFree: true, groupSize: "small", noisy: false, hearingLoop: false },
  { id: "bridge", name: "Library Bridge & Cards", tags: ["cards", "learning"], day: "Wed", time: "afternoon", costPerWeek: 0, travelMin: { drive: 6, bus: 15, paratransit: 25, walk: 20, family: 6 }, stepFree: true, groupSize: "small", noisy: false, hearingLoop: true },
  { id: "walk", name: "Lakeside Morning Walkers", tags: ["walking"], day: "Mon", time: "morning", costPerWeek: 0, travelMin: { drive: 12, walk: 25, family: 12 }, stepFree: true, groupSize: "large", noisy: false, hearingLoop: false },
  { id: "quilting", name: "Quilting Circle", tags: ["crafts"], day: "Thu", time: "morning", costPerWeek: 8, travelMin: { drive: 15, bus: 35, paratransit: 40, family: 15 }, stepFree: true, groupSize: "small", noisy: false, hearingLoop: false },
  { id: "cooking", name: "Shared Kitchen Cooking Class", tags: ["cooking", "learning"], day: "Fri", time: "evening", costPerWeek: 20, travelMin: { drive: 15, bus: 30, family: 15 }, stepFree: true, groupSize: "small", noisy: true, hearingLoop: false },
  { id: "tech", name: "Smartphone Help Hour", tags: ["tech", "learning"], day: "Thu", time: "afternoon", costPerWeek: 0, travelMin: { drive: 6, bus: 15, paratransit: 25, walk: 20, family: 6 }, stepFree: true, groupSize: "small", noisy: false, hearingLoop: true },
  { id: "foodbank", name: "Food Bank Volunteer Shift", tags: ["volunteering", "cooking"], day: "Sat", time: "afternoon", costPerWeek: 0, travelMin: { drive: 20, bus: 45, family: 20 }, stepFree: true, groupSize: "large", noisy: true, hearingLoop: false },
  { id: "concert", name: "Thursday Jazz Night", tags: ["music"], day: "Thu", time: "evening", costPerWeek: 15, travelMin: { drive: 20, bus: 40, family: 20 }, stepFree: true, groupSize: "large", noisy: true, hearingLoop: false },
  { id: "fellowship", name: "Sunday Fellowship Lunch", tags: ["faith", "cooking"], day: "Sun", time: "afternoon", costPerWeek: 5, travelMin: { drive: 10, paratransit: 30, family: 10 }, stepFree: true, groupSize: "large", noisy: true, hearingLoop: true },
];

export const DEMO_PROFILES: Record<string, Profile> = {
  margaret: {
    name: "Margaret",
    interests: ["music", "gardening", "cards"],
    mobility: "walker",
    transport: ["bus", "family"],
    maxTravelMin: 30,
    times: ["morning", "afternoon"],
    budgetPerWeek: 10,
    hearingImpaired: true,
    prefersSmallGroups: true,
  },
  harold: {
    name: "Harold",
    interests: ["music", "volunteering", "tech"],
    mobility: "cane",
    transport: ["paratransit", "walk"],
    maxTravelMin: 30,
    times: ["afternoon", "evening"],
    budgetPerWeek: 20,
    hearingImpaired: false,
    prefersSmallGroups: false,
  },
};
