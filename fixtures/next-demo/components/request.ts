import { z } from "zod";

const ErrorResponseSchema = z.object({ error: z.string() });

export async function save(
  url: string,
  method: "POST" | "PATCH",
  body: unknown,
): Promise<void> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload: unknown = await response.json();
    const parsed = ErrorResponseSchema.safeParse(payload);
    throw new Error(
      parsed.success
        ? parsed.data.error
        : `Request failed (${response.status})`,
    );
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unable to save. Please try again.";
}
