import Link from "next/link";
import { Missing, ProjectShell, requireProject } from "../../../lib/shell";
import { report, workflows } from "../../../lib/store";

export const dynamic = "force-dynamic";

type Capabilities = {
  capabilities: {
    id: string;
    domain: string;
    title: string;
    routeIds: string[];
    surfaceIds: string[];
    confidence: number;
    reviewReasons: string[];
  }[];
};

/** Product map: capabilities by domain, with routes and workflow coverage. */
export default async function ProductMap(props: {
  params: Promise<{ project: string }>;
}) {
  const target = requireProject((await props.params).project);
  const [capabilities, entries] = await Promise.all([
    report<Capabilities>(target, "capabilities"),
    workflows(target),
  ]);
  const states = new Map(entries.map((entry) => [entry.id, entry.state]));
  const domains = new Map<string, Capabilities["capabilities"]>();
  for (const capability of capabilities?.capabilities ?? [])
    domains.set(capability.domain, [
      ...(domains.get(capability.domain) ?? []),
      capability,
    ]);
  return (
    <ProjectShell project={target} current="" title="Product map">
      {!capabilities && (
        <Missing command="pathcompiler capabilities discover <directory>" />
      )}
      {[...domains].map(([domain, items]) => (
        <section key={domain} aria-labelledby={`domain-${domain}`}>
          <h2 id={`domain-${domain}`}>{domain}</h2>
          <table>
            <thead>
              <tr>
                <th scope="col">Capability</th>
                <th scope="col">Routes</th>
                <th scope="col">Confidence</th>
                <th scope="col">Workflow</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const state = states.get(item.id);
                return (
                  <tr key={item.id}>
                    <td>
                      {item.title} <code>{item.id}</code>
                    </td>
                    <td>
                      {item.routeIds
                        .map((route) => route.replace(/^route:/, ""))
                        .join(", ")}
                    </td>
                    <td>{item.confidence}</td>
                    <td>
                      {state ? (
                        <Link
                          className={`state-${state}`}
                          href={`/p/${target.name}/workflows/${item.id}`}
                        >
                          {state}
                        </Link>
                      ) : (
                        <span className="empty">no workflow</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}
    </ProjectShell>
  );
}
