import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { type DemoSession, DemoSessionSchema } from "./model";

const cookieName = "pathcompiler-demo";

export class DemoError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export async function readSession(): Promise<DemoSession> {
  const stored = (await cookies()).get(cookieName)?.value;
  if (!stored)
    return {
      role: "editor",
      featureFlags: { planStructure: true },
      clients: [],
      plans: [],
    };
  try {
    return DemoSessionSchema.parse(
      JSON.parse(Buffer.from(stored, "base64url").toString("utf8")),
    );
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      throw new DemoError(
        "Invalid demo session. Clear this site's cookies and reload.",
      );
    }
    throw error;
  }
}

export function requireEditor(session: DemoSession): void {
  if (session.role !== "editor")
    throw new DemoError("Editor role required", 403);
}

export function writeSession(
  session: DemoSession,
  body: unknown,
  status = 200,
): NextResponse {
  const value = Buffer.from(
    JSON.stringify(DemoSessionSchema.parse(session)),
  ).toString("base64url");
  // ponytail: bounded cookie storage keeps browser tests isolated; use a real store for a product app.
  if (Buffer.byteLength(value) > 3500)
    throw new DemoError(
      "Demo storage is full. Clear this site's cookies to start again.",
      409,
    );
  const response = NextResponse.json(body, { status });
  response.cookies.set(cookieName, value, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
  });
  return response;
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new DemoError("Request body must be valid JSON");
    throw error;
  }
}

export async function handleRequest(
  action: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof ZodError)
      return NextResponse.json(
        { error: error.issues.map((issue) => issue.message).join("; ") },
        { status: 400 },
      );
    if (error instanceof DemoError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    throw error;
  }
}
