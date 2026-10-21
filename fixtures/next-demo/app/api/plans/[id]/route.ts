import { StructureInputSchema } from "../../../../lib/model";
import {
  DemoError,
  handleRequest,
  readJson,
  readSession,
  requireEditor,
  writeSession,
} from "../../../../lib/session";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleRequest(async () => {
    const session = await readSession();
    requireEditor(session);
    if (!session.featureFlags.planStructure)
      throw new DemoError("Plan structure feature is disabled", 403);
    const { id } = await context.params;
    const plan = session.plans.find((item) => item.id === id);
    if (!plan) throw new DemoError("Plan not found", 404);
    const input = StructureInputSchema.parse(await readJson(request));
    // Intentional branch: expanding is immediate; simplifying requires explicit confirmation.
    if (
      plan.structure === "weekly" &&
      input.structure === "simple" &&
      input.confirmed !== true
    ) {
      throw new DemoError("Confirm before simplifying a weekly plan", 409);
    }
    plan.structure = input.structure;
    return writeSession(session, plan);
  });
}
