import { describeCondition } from "@pathcompiler/workflow-compiler";
import { notFound } from "next/navigation";
import { approveWorkflow, rejectWorkflow } from "../../../../../lib/actions";
import { ProjectShell, requireProject, short } from "../../../../../lib/shell";
import { workflow as readWorkflow } from "../../../../../lib/store";

export const dynamic = "force-dynamic";

export default async function WorkflowDetail(props: {
  params: Promise<{ project: string; id: string }>;
  searchParams: Promise<{ message?: string; error?: string }>;
}) {
  const { project: name, id } = await props.params;
  const target = requireProject(name);
  const detail = await readWorkflow(target, id);
  if (!detail) notFound();
  const notice = await props.searchParams;
  const record =
    detail.approved ?? detail.deprecated ?? detail.rejected ?? detail.candidate;
  if (!record) notFound();
  const workflow = record.workflow;
  const pending = detail.proposals.filter(
    (item) => item.proposal.review.status === "pending",
  );
  return (
    <ProjectShell
      project={target}
      current="/workflows"
      title={workflow.title}
      notice={notice}
    >
      <p>
        <code>{workflow.id}</code>{" "}
        <span className={`badge state-${detail.state}`}>{detail.state}</span>
      </p>
      <dl>
        <dt>Current commit</dt>
        <dd>
          <code>{workflow.repository.commit}</code>
        </dd>
        {detail.approved && (
          <>
            <dt>Approved</dt>
            <dd>
              by {detail.approved.approval.approvedBy} at{" "}
              {detail.approved.approval.approvedAt}
            </dd>
          </>
        )}
        {detail.deprecated && (
          <>
            <dt>Deprecated</dt>
            <dd>
              by {detail.deprecated.deprecation.deprecatedBy} at{" "}
              <code>
                {short(detail.deprecated.deprecation.deprecatedCommit)}
              </code>
              : {detail.deprecated.deprecation.reasons.join(", ")}
            </dd>
          </>
        )}
        <dt>Confidence</dt>
        <dd>
          {workflow.confidence.overall}
          {workflow.confidence.dimensions &&
            ` (${Object.entries(workflow.confidence.dimensions)
              .map(([key, value]) => `${key} ${value}`)
              .join(", ")})`}{" "}
          <span className="empty">rule strength, not probability</span>
        </dd>
        <dt>Entry</dt>
        <dd>
          {workflow.entrypoints
            .map((entry) => entry.route ?? entry.state)
            .join(", ")}
        </dd>
      </dl>

      {detail.state === "candidate" && (
        <section aria-labelledby="review">
          <h2 id="review">Review</h2>
          {detail.candidate?.ambiguities.length ? (
            <ul>
              {detail.candidate.ambiguities.map((item) => (
                <li key={item.code}>
                  <code>{item.code}</code>: {item.message}
                </li>
              ))}
            </ul>
          ) : null}
          <form className="review" action={approveWorkflow}>
            <input type="hidden" name="project" value={target.name} />
            <input type="hidden" name="id" value={workflow.id} />
            <label>
              Reviewer
              <input
                name="reviewer"
                required
                defaultValue={process.env.PATHCOMPILER_USER ?? ""}
              />
            </label>
            <button type="submit">Approve</button>
          </form>
          <form className="review" action={rejectWorkflow}>
            <input type="hidden" name="project" value={target.name} />
            <input type="hidden" name="id" value={workflow.id} />
            <label>
              Reviewer
              <input
                name="reviewer"
                required
                defaultValue={process.env.PATHCOMPILER_USER ?? ""}
              />
            </label>
            <label>
              Reason
              <input name="reason" />
            </label>
            <button type="submit">Reject</button>
          </form>
        </section>
      )}

      <section aria-labelledby="steps">
        <h2 id="steps">Steps</h2>
        <table>
          <thead>
            <tr>
              <th scope="col">Step</th>
              <th scope="col">Action</th>
              <th scope="col">Expected</th>
              <th scope="col">Source evidence</th>
            </tr>
          </thead>
          <tbody>
            {workflow.steps.map((step) => (
              <tr key={step.id}>
                <td>
                  <code>{step.id}</code>
                  <br />
                  {step.instruction?.text}
                </td>
                <td>
                  {step.action.type}
                  {step.target && (
                    <>
                      {" "}
                      <code>{step.target}</code>
                    </>
                  )}
                  {step.next && <div className="empty">next {step.next}</div>}
                </td>
                <td>
                  {step.expected ? describeCondition(step.expected) : "—"}
                </td>
                <td>
                  <ul>
                    {step.evidence
                      .filter((ref) => ref.type !== "test")
                      .map((ref) => (
                        <li key={ref.id}>
                          {ref.type} <code>{ref.locator}</code>
                        </li>
                      ))}
                    <li className="empty">
                      {
                        step.evidence.filter((ref) => ref.type === "test")
                          .length
                      }{" "}
                      test references
                    </li>
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="validation">
        <h2 id="validation">Validation report</h2>
        {detail.validation ? (
          <>
            <p className={detail.validation.valid ? "passed" : "failed"}>
              {detail.validation.valid ? "Valid" : "Invalid"} at{" "}
              <code>{short(detail.validation.repositoryCommit)}</code>
            </p>
            <table>
              <tbody>
                {detail.validation.checks.map((check) => (
                  <tr key={check.name}>
                    <th scope="row">{check.name}</th>
                    <td className={check.status}>{check.status}</td>
                    <td>{check.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {[...detail.validation.errors, ...detail.validation.warnings]
              .length > 0 && (
              <ul>
                {detail.validation.errors.map((item) => (
                  <li key={`e-${item.code}-${item.message}`} className="failed">
                    <code>{item.code}</code> {item.message}
                  </li>
                ))}
                {detail.validation.warnings.map((item) => (
                  <li key={`w-${item.code}-${item.message}`} className="medium">
                    <code>{item.code}</code> {item.message}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="empty">
            Not validated yet. Run{" "}
            <code>pathcompiler workflows validate {workflow.id}</code>.
          </p>
        )}
      </section>

      <section aria-labelledby="pending">
        <h2 id="pending">Pending diff</h2>
        {pending.length === 0 ? (
          <p className="empty">No pending proposals.</p>
        ) : (
          pending.map((item) => (
            <div key={item.name}>
              <p>
                <a href={`/p/${target.name}/changes#${item.name}`}>
                  {item.name}
                </a>
              </p>
              <pre>
                {item.proposal.kind === "workflow-update-proposal"
                  ? item.proposal.diff
                  : item.proposal.summary}
              </pre>
            </div>
          ))
        )}
      </section>
    </ProjectShell>
  );
}
