import { z } from "zod";
import { runIntake } from "@/lib/ai/intake/intake";

// Suggests a profile only. Never runs the planner; the UI must show, let the caregiver edit, and confirm first.
const IntakeRequest = z.object({ text: z.string().trim().min(1, "Describe the person first").max(2000, "Keep it under 2000 characters") });

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = IntakeRequest.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  return Response.json(await runIntake(parsed.data.text));
}
