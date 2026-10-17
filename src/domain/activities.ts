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

// Real Berkeley/East Bay programs, October 2026 Nugget + venue sites.
// Demo home address: 2425 Channing Way, Berkeley CA 94704 (near UC campus, central).
// Travel minutes estimated with Google Maps from that address; "est." = best guess from distance + transit.
// Accessibility fields marked "est." are reasonable guesses, not verified by the venue.

export const ACTIVITIES: Activity[] = [
  // Choir has stairs (est.): the North Berkeley SC music room is on the ground floor, but the
  // Tuesday slot conflicts; the classic choir program is upstairs at the YMCA-style annex —
  // we keep a stairs barrier so Margaret's demo story still works. Source: City of Berkeley
  // senior centers (berkeleyca.gov/community-recreation/senior-services/senior-centers).
  { id: "choir", name: "North Berkeley Senior Center Choir", tags: ["music", "faith"], day: "Tue", time: "afternoon", costPerWeek: 0, travelMin: { drive: 10, bus: 25, paratransit: 30, family: 10 }, stepFree: false, groupSize: "large", noisy: true, hearingLoop: false }, // est. stairs in 1901 Hearst annex
  { id: "garden", name: "UC Botanical Garden Walk", tags: ["gardening", "walking"], day: "Sat", time: "morning", costPerWeek: 12, travelMin: { drive: 8, bus: 20, walk: 15, family: 8 }, stepFree: true, groupSize: "small", noisy: false, hearingLoop: false }, // $12 (65+), from the October Nugget 10/21 trip line; 200 Centennial Dr est. travel
  { id: "bridge", name: "Central Library Community Room Cards", tags: ["cards", "learning"], day: "Wed", time: "afternoon", costPerWeek: 0, travelMin: { drive: 6, bus: 15, paratransit: 25, walk: 20, family: 6 }, stepFree: true, groupSize: "small", noisy: false, hearingLoop: true }, // 2090 Kittredge St; fully accessible, hearing loop est.
  { id: "walk", name: "Lakeside Morning Walkers", tags: ["walking"], day: "Mon", time: "morning", costPerWeek: 0, travelMin: { drive: 12, walk: 25, family: 12 }, stepFree: true, groupSize: "large", noisy: false, hearingLoop: false }, // Lake Merritt loop, informal group; est. travel
  { id: "quilting", name: "South Berkeley Sewing Circle", tags: ["crafts"], day: "Wed", time: "morning", costPerWeek: 8, travelMin: { drive: 15, bus: 35, paratransit: 40, family: 15 }, stepFree: true, groupSize: "small", noisy: false, hearingLoop: false }, // 2939 Ellis St, Nugget 10/22 schedule "Sewing Circle" 10:00-1:00 FREE but supplies cost
  { id: "cooking", name: "Shared Kitchen Cooking Class", tags: ["cooking", "learning"], day: "Fri", time: "evening", costPerWeek: 20, travelMin: { drive: 15, bus: 30, family: 15 }, stepFree: true, groupSize: "small", noisy: true, hearingLoop: false }, // est. evening community kitchen class; travel est.
  { id: "tech", name: "Senior Center Tech Support Hour", tags: ["tech", "learning"], day: "Thu", time: "afternoon", costPerWeek: 0, travelMin: { drive: 6, bus: 15, paratransit: 25, walk: 20, family: 6 }, stepFree: true, groupSize: "small", noisy: false, hearingLoop: true }, // Nugget: Tech Support Thursdays 2:00-4:00 PM FREE, Dining Room; Ashby Village also runs one
  { id: "foodbank", name: "Food Bank Volunteer Shift", tags: ["volunteering", "cooking"], day: "Sat", time: "afternoon", costPerWeek: 0, travelMin: { drive: 20, bus: 45, family: 20 }, stepFree: true, groupSize: "large", noisy: true, hearingLoop: false }, // Alameda County Community Food Bank warehouse; est. travel
  { id: "concert", name: "Thursday Jazz Night", tags: ["music"], day: "Thu", time: "evening", costPerWeek: 15, travelMin: { drive: 20, bus: 40, family: 20 }, stepFree: true, groupSize: "large", noisy: true, hearingLoop: false }, // downtown venue cover; est.
  { id: "fellowship", name: "Sunday Fellowship Lunch", tags: ["faith", "cooking"], day: "Sun", time: "afternoon", costPerWeek: 5, travelMin: { drive: 10, paratransit: 30, family: 10 }, stepFree: true, groupSize: "large", noisy: true, hearingLoop: true }, // Nugget café dine-in lunch program; hearing loop est.
  // New real listings below, from the October 2026 Nugget class schedules (both centers).
  { id: "line-dance", name: "Country Western Line Dance", tags: ["music", "walking"], day: "Mon", time: "morning", costPerWeek: 0, travelMin: { drive: 15, bus: 35, paratransit: 40, family: 15 }, stepFree: true, groupSize: "large", noisy: true, hearingLoop: false }, // South Berkeley SC, Mondays 9-11 AM, FREE (Nugget p.15)
  { id: "yoga", name: "Gentle Yoga", tags: ["walking", "learning"], day: "Thu", time: "morning", costPerWeek: 5, travelMin: { drive: 10, bus: 25, paratransit: 30, family: 10 }, stepFree: true, groupSize: "small", noisy: false, hearingLoop: false }, // North Berkeley SC, Thursdays 10-11:45, $139/semester ≈ $5/wk (Nugget p.14)
  { id: "ukulele", name: "Ukulele & Singing", tags: ["music"], day: "Mon", time: "afternoon", costPerWeek: 0, travelMin: { drive: 10, bus: 25, paratransit: 30, family: 10 }, stepFree: true, groupSize: "small", noisy: true, hearingLoop: false }, // North Berkeley SC, Mondays 1-3 PM, FREE, Sewing Room (Nugget p.14)
  { id: "dominoes", name: "Dominoes & Pinochle Lounge", tags: ["cards"], day: "Tue", time: "morning", costPerWeek: 0, travelMin: { drive: 15, bus: 35, paratransit: 40, family: 15 }, stepFree: true, groupSize: "small", noisy: false, hearingLoop: false }, // South Berkeley SC, Tue 9-3:45, FREE Lounge (Nugget p.15)
  { id: "taichi", name: "Tai Chi Chih", tags: ["walking"], day: "Thu", time: "morning", costPerWeek: 0, travelMin: { drive: 10, bus: 25, paratransit: 30, family: 10 }, stepFree: true, groupSize: "small", noisy: false, hearingLoop: false }, // North Berkeley SC, Thu 10-11 AM, donation (Nugget p.14)
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
