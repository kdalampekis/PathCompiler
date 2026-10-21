import { z } from "zod";
import { ClientInputSchema } from "../../../../lib/model";
import {
  DemoError,
  handleRequest,
  readJson,
  readSession,
  requireEditor,
  writeSession,
} from "../../../../lib/session";

const UpdateSchema = z.union([
  ClientInputSchema,
  z.strictObject({ active: z.literal(false) }),
]);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleRequest(async () => {
    const session = await readSession();
    requireEditor(session);
    const { id } = await context.params;
    const client = session.clients.find((item) => item.id === id);
    if (!client) throw new DemoError("Client not found", 404);
    const input = UpdateSchema.parse(await readJson(request));
    Object.assign(client, input);
    return writeSession(session, client);
  });
}
