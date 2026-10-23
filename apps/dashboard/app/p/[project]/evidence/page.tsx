import { Missing, ProjectShell, requireProject } from "../../../../lib/shell";
import { report, workflow, workflows } from "../../../../lib/store";

export const dynamic = "force-dynamic";

type Traces = {
  traces: {
    id: string;
    testName: string;
    sourceFile: string;
    partial: boolean;
    actions: unknown[];
    assertions: unknown[];
  }[];
};

export default async function Evidence(props: {
  params: Promise<{ project: string }>;
}) {
  const target = requireProject((await props.params).project);
  const traces = await report<Traces>(target, "test-traces");
  const approved = (await workflows(target)).filter(
    (entry) => entry.state === "approved",
  );
  const counts = new Map<string, Map<string, Set<string>>>();
  for (const entry of approved) {
    const record = (await workflow(target, entry.id))?.approved;
    for (const ref of record?.workflow.provenance.evidence ?? []) {
      const byType = counts.get(ref.type) ?? new Map<string, Set<string>>();
      const users = byType.get(ref.locator) ?? new Set<string>();
      users.add(entry.id);
      byType.set(ref.locator, users);
      counts.set(ref.type, byType);
    }
  }
  return (
    <ProjectShell project={target} current="/evidence" title="Evidence">
      <section aria-labelledby="sources">
        <h2 id="sources">Evidence behind approved workflows</h2>
        {counts.size === 0 && (
          <p className="empty">No approved workflows yet.</p>
        )}
        {[...counts]
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([type, locators]) => (
            <details key={type} open={type !== "test"}>
              <summary>
                {type} ({locators.size})
              </summary>
              <ul>
                {[...locators]
                  .sort(([a], [b]) => (a < b ? -1 : 1))
                  .map(([locator, users]) => (
                    <li key={locator}>
                      <code>{locator}</code> — {[...users].sort().join(", ")}
                    </li>
                  ))}
              </ul>
            </details>
          ))}
      </section>
      <section aria-labelledby="tests">
        <h2 id="tests">Playwright traces</h2>
        {!traces ? (
          <Missing command="pathcompiler tests mine <directory>" />
        ) : (
          <table>
            <tbody>
              {traces.traces.map((trace) => (
                <tr key={trace.id}>
                  <th scope="row">{trace.testName}</th>
                  <td>
                    <code>{trace.sourceFile}</code>
                  </td>
                  <td>
                    {trace.actions.length} actions, {trace.assertions.length}{" "}
                    assertions
                  </td>
                  <td>{trace.partial ? "partial" : "complete"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="empty">
          Traces are static evidence; tests were not executed.
        </p>
      </section>
    </ProjectShell>
  );
}
