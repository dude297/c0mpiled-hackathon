import { seedDemo } from "../_lib/service";

// Seeds fictional fixtures. Local dev or the local-demo flag only (503 when hosted).
export async function POST() {
  return seedDemo();
}
