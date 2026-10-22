"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import type { DemoSession, Plan } from "../lib/model";
import { Modal } from "./modal";
import { errorMessage, save } from "./request";

export function Plans({ session }: { session: DemoSession }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [structure, setStructure] = useState<Plan["structure"]>("simple");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canEdit = session.role === "editor";
  const activeClients = session.clients.filter((client) => client.active);

  function close() {
    setCreating(false);
    setEditing(null);
    setConfirming(false);
    setError("");
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await save("/api/plans", "POST", {
        title: fields.get("title"),
        clientId: fields.get("clientId"),
      });
      setNotice("Plan created");
      close();
      router.refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function changeStructure(confirmed = false) {
    if (!editing) return;
    if (
      editing.structure === "weekly" &&
      structure === "simple" &&
      !confirmed
    ) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await save(`/api/plans/${editing.id}`, "PATCH", { structure, confirmed });
      setNotice("Plan structure changed");
      close();
      router.refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Workspace / Plans</p>
          <h1>Plans</h1>
          <p>A clear structure for each client's next steps.</p>
        </div>
        {canEdit && (
          <button
            data-pathcompiler="plans.create"
            type="button"
            disabled={activeClients.length === 0}
            onClick={() => {
              setNotice("");
              setCreating(true);
            }}
          >
            Create Plan
          </button>
        )}
      </div>
      {activeClients.length === 0 && (
        <p className="callout">
          Create an active client before creating a plan.
        </p>
      )}
      {!session.featureFlags.planStructure && (
        <p className="callout">Plan structure changes are disabled.</p>
      )}
      <p data-pathcompiler="plans.feedback" role="status">
        {notice}
      </p>
      {session.plans.length === 0 ? (
        <div className="empty">
          <h2>No plans yet</h2>
          <p>Your client plans will appear here.</p>
        </div>
      ) : (
        <ul className="cards">
          {session.plans.map((plan) => (
            <li
              key={plan.id}
              data-pathcompiler="plans.row"
              data-plan-id={plan.id}
              className="card"
            >
              <div>
                <h2>{plan.title}</h2>
                <p>
                  {
                    session.clients.find(
                      (client) => client.id === plan.clientId,
                    )?.name
                  }
                </p>
                <span className="badge">
                  {plan.structure === "simple" ? "Simple" : "Weekly"} structure
                </span>
              </div>
              {canEdit && session.featureFlags.planStructure && (
                <button
                  data-pathcompiler="plans.change_structure"
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setNotice("");
                    setEditing(plan);
                    setStructure(plan.structure);
                  }}
                >
                  Change Plan Structure
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {creating && (
        <Modal title="Create Plan" onClose={close}>
          <form data-pathcompiler="plan.form" onSubmit={create} noValidate>
            <label>
              Title
              <input
                data-pathcompiler="plan.form.title"
                name="title"
                required
                minLength={2}
                maxLength={80}
              />
            </label>
            <label>
              Client
              <select
                data-pathcompiler="plan.form.client"
                aria-label="Client"
                name="clientId"
                required
              >
                {activeClients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </label>
            {error && (
              <p data-pathcompiler="plan.form.error" role="alert">
                {error}
              </p>
            )}
            <button
              data-pathcompiler="plan.form.submit"
              type="submit"
              disabled={busy}
            >
              Save Plan
            </button>
          </form>
        </Modal>
      )}
      {editing && (
        <Modal title="Change Plan Structure" onClose={close}>
          {confirming ? (
            <>
              <p>
                Switching to Simple removes the weekly grouping. Confirm this
                change.
              </p>
              <button
                type="button"
                disabled={busy}
                data-pathcompiler="plan.structure.confirm"
                onClick={() => void changeStructure(true)}
              >
                Confirm Simplification
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                data-pathcompiler="plan.structure.back"
                onClick={() => setConfirming(false)}
              >
                Back
              </button>
            </>
          ) : (
            <form
              data-pathcompiler="plan.structure.form"
              onSubmit={(event) => {
                event.preventDefault();
                void changeStructure();
              }}
            >
              <label>
                Structure
                <select
                  data-pathcompiler="plan.structure.selector"
                  aria-label="Structure"
                  value={structure}
                  onChange={(event) =>
                    setStructure(
                      event.target.value === "weekly" ? "weekly" : "simple",
                    )
                  }
                >
                  <option value="simple">Simple</option>
                  <option value="weekly">Weekly</option>
                </select>
              </label>
              <button
                data-pathcompiler="plan.structure.submit"
                type="submit"
                disabled={busy}
              >
                Save Structure
              </button>
            </form>
          )}
          {error && (
            <p data-pathcompiler="plan.structure.error" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
    </>
  );
}
