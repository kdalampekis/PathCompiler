import {
  DemoError,
  handleRequest,
  readSession,
  requireAdmin,
  writeSession,
} from "../../../../../lib/session";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleRequest(async () => {
    const session = await readSession();
    requireAdmin(session);
    if (!session.featureFlags.planArchive)
      throw new DemoError("Plan archive feature is disabled", 403);
    const { id } = await context.params;
    const plan = session.plans.find((item) => item.id === id);
    if (!plan) throw new DemoError("Plan not found", 404);
    if (plan.archived) throw new DemoError("Plan is already archived", 409);
    plan.archived = true;
    return writeSession(session, plan);
  });
}
