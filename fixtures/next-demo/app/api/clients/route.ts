import { randomUUID } from "node:crypto";
import { ClientInputSchema } from "../../../lib/model";
import {
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
    const input = ClientInputSchema.parse(await readJson(request));
    const client = { ...input, id: randomUUID(), active: true };
    session.clients.push(client);
    return writeSession(session, client, 201);
  });
}
