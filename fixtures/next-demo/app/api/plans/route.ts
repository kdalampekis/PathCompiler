import { randomUUID } from "node:crypto";
import { PlanInputSchema } from "../../../lib/model";
import {
  DemoError,
  handleRequest,
  readJson,
  readSession,
  requireEditor,
  writeSession,
} from "../../../lib/session";

export async function POST(request: Request) {
  return handleRequest(async () => {
    const session = await readSession();
    requireEditor(session);
    const input = PlanInputSchema.parse(await readJson(request));
    if (
      !session.clients.some(
        (client) => client.id === input.clientId && client.active,
      )
    ) {
      throw new DemoError("Choose an active client");
    }
    const plan = {
      ...input,
      id: randomUUID(),
      structure: "simple" as const,
      archived: false,
    };
    session.plans.push(plan);
    return writeSession(session, plan, 201);
  });
}
