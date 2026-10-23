import Link from "next/link";
import { decideProposal } from "../../../../lib/actions";
import {
  Missing,
  ProjectShell,
  requireProject,
  short,
} from "../../../../lib/shell";
import { proposals, report } from "../../../../lib/store";

export const dynamic = "force-dynamic";

type Impact = {
  base: { commit: string };
  head: { commit: string };
  impacts: {
    workflowId: string;
    severity: string;
    reasons: { code: string; message: string }[];
    affectedSteps: string[];
  }[];
};
type NewWorkflows = {
  detections: {
    capabilityId: string;
    title: string;
    status: string;
    confidence: number;
    signals: { signal: string }[];
  }[];
};

export default async function PendingChanges(props: {
  params: Promise<{ project: string }>;
  searchParams: Promise<{ message?: string; error?: string }>;
}) {
  const target = requireProject((await props.params).project);
  const notice = await props.searchParams;
  const [items, impact, detected] = await Promise.all([
    proposals(target),
    report<Impact>(target, "workflow-impact"),
    report<NewWorkflows>(target, "new-workflows"),
  ]);
  const pending = items.filter(
    (item) => item.proposal.review.status === "pending",
  );
  const decided = items.filter(
    (item) => item.proposal.review.status !== "pending",
  );
  return (
    <ProjectShell
      project={target}
      current="/changes"
      title="Pending changes"
      notice={notice}
    >
      <section aria-labelledby="proposals">
        <h2 id="proposals">Proposals ({pending.length} pending)</h2>
        {pending.length === 0 && (
          <p className="empty">
            Nothing to review. Generate proposals with{" "}
            <code>
              pathcompiler proposals generate &lt;base&gt; &lt;head&gt;
            </code>
            .
          </p>
        )}
        {pending.map(({ name, proposal }) => {
          const update = proposal.kind === "workflow-update-proposal";
          return (
            <article key={name} id={name} aria-labelledby={`${name}-title`}>
              <h3 id={`${name}-title`}>
                {update ? "Update" : "Deprecate"}{" "}
                <Link
                  href={`/p/${target.name}/workflows/${proposal.workflowId}`}
                >
                  {proposal.workflowId}
                </Link>{" "}
                <span className={`badge ${proposal.impact.severity}`}>
                  {proposal.impact.severity}
                </span>
              </h3>
              <p className="empty">
                {short(proposal.approved.commit)} →{" "}
                {short(proposal.head.commit)}
                {update &&
                  proposal.validation &&
                  ` · proposed workflow ${proposal.validation.valid ? "valid" : "invalid"}`}
              </p>
              <pre>{update ? proposal.diff : proposal.summary}</pre>
              <form className="review" action={decideProposal}>
                <input type="hidden" name="project" value={target.name} />
                <input type="hidden" name="name" value={name} />
                <input
                  type="hidden"
                  name="kind"
                  value={update ? "update" : "deprecation"}
                />
                <label>
                  Reviewer
                  <input
                    name="reviewer"
                    required
                    defaultValue={process.env.PATHCOMPILER_USER ?? ""}
                  />
                </label>
                <label>
                  Note
                  <input name="reason" />
                </label>
                <button type="submit" name="decision" value="accept">
                  Accept
                </button>
                <button type="submit" name="decision" value="reject">
                  Reject
                </button>
                <button type="submit" name="decision" value="ignore">
                  Ignore for this change
                </button>
              </form>
            </article>
          );
        })}
        {decided.length > 0 && (
          <>
            <h3>Decided</h3>
            <ul>
              {decided.map(({ name, proposal }) => (
                <li key={name}>
                  <code>{name}</code>: {proposal.review.status}
                  {"decidedBy" in proposal.review &&
                    ` by ${proposal.review.decidedBy}`}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section aria-labelledby="impact">
        <h2 id="impact">Latest impact</h2>
        {!impact ? (
          <Missing command="pathcompiler impact <base> <head>" />
        ) : (
          <table>
            <caption>
              {short(impact.base.commit)} → {short(impact.head.commit)}
            </caption>
            <tbody>
              {impact.impacts.map((item) => (
                <tr key={item.workflowId}>
                  <th scope="row">{item.workflowId}</th>
                  <td className={item.severity}>{item.severity}</td>
                  <td>
                    {item.reasons.map((reason) => reason.message).join(" ")}
                  </td>
                  <td>{item.affectedSteps.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section aria-labelledby="new">
        <h2 id="new">Possible new workflows</h2>
        {!detected ? (
          <Missing command="pathcompiler workflows detect <base> <head>" />
        ) : detected.detections.length === 0 ? (
          <p className="empty">None detected.</p>
        ) : (
          <ul>
            {detected.detections.map((item) => (
              <li key={item.capabilityId}>
                {item.title} <code>{item.capabilityId}</code> — {item.status},
                confidence {item.confidence} (
                {item.signals.map((signal) => signal.signal).join(", ")})
              </li>
            ))}
          </ul>
        )}
      </section>
    </ProjectShell>
  );
}
