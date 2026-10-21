export type AppRoute = { path: string; kind: "page" | "api" };

/** Route groups and slots do not contribute URL segments. Interception is reported by the caller. */
export function discoverRoute(
  file: string,
  appDirectory: "app" | "src/app",
): AppRoute | undefined {
  if (!file.startsWith(`${appDirectory}/`)) return;
  const parts = file.slice(appDirectory.length + 1).split("/");
  const filename = parts.pop();
  const match = filename?.match(/^(page|route)\.(?:js|jsx|ts|tsx)$/);
  if (
    !match ||
    parts.some((part) => part.startsWith("_") || /^\(\.{1,3}\)/.test(part))
  )
    return;
  const segments = parts
    .filter((part) => !/^\(.*\)$/.test(part) && !part.startsWith("@"))
    .map((part) =>
      part
        .replace(/^\[\[\.\.\.(.+)\]\]$/, ":$1*")
        .replace(/^\[\.\.\.(.+)\]$/, ":$1+")
        .replace(/^\[(.+)\]$/, ":$1"),
    );
  return {
    path: `/${segments.join("/")}`,
    kind: match[1] === "page" ? "page" : "api",
  };
}

export function matchesRoute(url: string, route: string): boolean {
  const candidate = url.split(/[?#]/)[0]?.replace(/\/$/, "") || "/";
  const expression =
    route === "/"
      ? ""
      : route
          .split("/")
          .slice(1)
          .map((segment) => {
            if (segment.startsWith(":")) {
              if (segment.endsWith("*")) return "(?:/[^/]+)*";
              if (segment.endsWith("+")) return "(?:/[^/]+)+";
              return "/[^/]+";
            }
            return `/${segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`;
          })
          .join("");
  return new RegExp(`^${expression || "/"}$`).test(candidate);
}
