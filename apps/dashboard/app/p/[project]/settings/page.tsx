import { ProjectShell, requireProject } from "../../../../lib/shell";
import { settings } from "../../../../lib/store";

export const dynamic = "force-dynamic";

export default async function Settings(props: {
  params: Promise<{ project: string }>;
}) {
  const target = requireProject((await props.params).project);
  const values = await settings(target);
  return (
    <ProjectShell project={target} current="/settings" title="Settings">
      <dl>
        <dt>Repository</dt>
        <dd>
          <code>{values.root}</code>
        </dd>
        <dt>PathCompiler directory</dt>
        <dd>
          <code>{values.out}</code>
        </dd>
        <dt>Compiler version</dt>
        <dd>{values.compilerVersion}</dd>
        <dt>Default reviewer (PATHCOMPILER_USER)</dt>
        <dd>{values.reviewerConfigured ? "configured" : "not set"}</dd>
        <dt>GitHub token (GITHUB_TOKEN)</dt>
        <dd>{values.githubTokenConfigured ? "configured" : "not set"}</dd>
      </dl>
      <h2>Generated artifacts</h2>
      <table>
        <tbody>
          {values.generated.map((item) => (
            <tr key={item.name}>
              <th scope="row">{item.name}.json</th>
              <td>
                {item.updated ?? (
                  <span className="empty">
                    not built — run pathcompiler build
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="empty">
        Projects are configured with PATHCOMPILER_PROJECTS. This dashboard is
        for local use and has no authentication; bind it to 127.0.0.1.
      </p>
    </ProjectShell>
  );
}
