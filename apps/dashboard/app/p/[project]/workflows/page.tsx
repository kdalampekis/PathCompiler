import Link from "next/link";
import { ProjectShell, requireProject, short } from "../../../../lib/shell";
import { workflows } from "../../../../lib/store";

export const dynamic = "force-dynamic";

export default async function Workflows(props: {
  params: Promise<{ project: string }>;
}) {
  const target = requireProject((await props.params).project);
  const entries = await workflows(target);
  return (
    <ProjectShell project={target} current="/workflows" title="Workflows">
      {entries.length === 0 ? (
        <p className="empty">
          No workflows yet. Run <code>pathcompiler workflows discover</code>.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Workflow</th>
              <th scope="col">State</th>
              <th scope="col">Confidence</th>
              <th scope="col">Commit</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>
                  <Link href={`/p/${target.name}/workflows/${entry.id}`}>
                    {entry.title}
                  </Link>{" "}
                  <code>{entry.id}</code>
                </td>
                <td className={`state-${entry.state}`}>{entry.state}</td>
                <td>{entry.confidence}</td>
                <td>
                  <code>{short(entry.commit)}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ProjectShell>
  );
}
