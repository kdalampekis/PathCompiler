import { PathCompilerError, type RuntimeTransport } from "./index.js";

export type HttpTransportOptions = {
  /** Service origin and optional path prefix, e.g. `http://127.0.0.1:4310`. */
  baseUrl: string;
  /** Bearer API token. Keep it server-side; do not embed secrets in browser bundles. */
  token?: string;
  fetch?: typeof fetch;
};

/**
 * Transport for the PathCompiler HTTP service. Network failures propagate
 * unchanged; HTTP error responses become typed PathCompilerErrors.
 */
export function createHttpTransport(
  options: HttpTransportOptions,
): RuntimeTransport {
  let base: URL;
  try {
    base = new URL(
      options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`,
    );
  } catch (error) {
    throw new PathCompilerError(
      "invalid-request",
      "baseUrl must be an absolute http(s) URL.",
      { cause: error },
    );
  }
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password
  )
    throw new PathCompilerError(
      "invalid-request",
      "baseUrl must be an http(s) URL without embedded credentials.",
    );
  const send = options.fetch ?? globalThis.fetch.bind(globalThis);
  async function request(path: string, body?: unknown): Promise<unknown> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (options.token !== undefined)
      headers.authorization = `Bearer ${options.token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await send(new URL(path, base), {
      method: body === undefined ? "GET" : "POST",
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new PathCompilerError(
        "invalid-response",
        `The service returned a non-JSON response (HTTP ${response.status}).`,
        { cause: error },
      );
    }
    if (response.ok) return payload;
    const detail = (
      payload as { error?: { code?: unknown; message?: unknown } }
    )?.error;
    const message =
      typeof detail?.message === "string"
        ? detail.message
        : `The service responded with HTTP ${response.status}.`;
    const code =
      response.status === 401
        ? "unauthorized"
        : response.status === 404 && detail?.code === "workflow-not-found"
          ? "workflow-not-found"
          : response.status === 400
            ? "invalid-request"
            : "transport-failed";
    throw new PathCompilerError(code, message);
  }
  const workflow = (id: string, suffix = "") =>
    `v1/workflows/${encodeURIComponent(id)}${suffix}`;
  return {
    resolve: async (body) => request("v1/help/resolve", body) as never,
    getWorkflow: async (id) => request(workflow(id)) as never,
    getRuntimeManifest: async (id) =>
      request(workflow(id, "/runtime")) as never,
    getRelatedWorkflows: async (id) =>
      request(workflow(id, "/related")) as never,
  };
}
