import { NextResponse } from "next/server";
import { SessionSettingsSchema } from "../../../lib/model";
import {
  handleRequest,
  readJson,
  readSession,
  writeSession,
} from "../../../lib/session";

export async function GET() {
  return handleRequest(async () => NextResponse.json(await readSession()));
}

// Demo controls deliberately allow role switching; this is not an authentication implementation.
export async function POST(request: Request) {
  return handleRequest(async () => {
    const settings = SessionSettingsSchema.parse(await readJson(request));
    const session = await readSession();
    session.role = settings.role;
    session.featureFlags.planStructure = settings.planStructure;
    if (settings.planArchive !== undefined)
      session.featureFlags.planArchive = settings.planArchive;
    return writeSession(session, { ok: true });
  });
}
