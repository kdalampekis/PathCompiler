import Link from "next/link";
import { projects, workflows } from "../lib/store";

export const dynamic = "force-dynamic";

export default async function Projects() {
  const list = await Promise.all(
    projects().map(async (item) => ({
      item,
      workflows: await workflows(item),
    })),
  );
  return (
    <>
      <h1>Projects</h1>
      <table>
        <thead>
          <tr>
            <th scope="col">Project</th>
            <th scope="col">Repository</th>
            <th scope="col">Approved</th>
            <th scope="col">Candidates</th>
          </tr>
        </thead>
        <tbody>
          {list.map(({ item, workflows: entries }) => (
            <tr key={item.name}>
              <td>
                <Link href={`/p/${item.name}`}>{item.name}</Link>
              </td>
              <td>
                <code>{item.root}</code>
              </td>
              <td>
                {entries.filter((entry) => entry.state === "approved").length}
              </td>
              <td>
                {entries.filter((entry) => entry.state === "candidate").length}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
