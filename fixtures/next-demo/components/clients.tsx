"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import type { Client, DemoSession } from "../lib/model";
import { Modal } from "./modal";
import { errorMessage, save } from "./request";

export function Clients({ session }: { session: DemoSession }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Client | "new" | null>(null);
  const [deactivating, setDeactivating] = useState<Client | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canEdit = session.role === "editor";

  function close() {
    setEditing(null);
    setDeactivating(null);
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editing === null) return;
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await save(
        editing === "new" ? "/api/clients" : `/api/clients/${editing.id}`,
        editing === "new" ? "POST" : "PATCH",
        { name: fields.get("name"), email: fields.get("email") },
      );
      setNotice(editing === "new" ? "Client created" : "Client updated");
      close();
      router.refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    if (!deactivating) return;
    setBusy(true);
    setError("");
    try {
      await save(`/api/clients/${deactivating.id}`, "PATCH", { active: false });
      setNotice("Client deactivated");
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
          <p className="eyebrow">Workspace / Clients</p>
          <h1>Clients</h1>
          <p>Manage the people you work with.</p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => {
              setNotice("");
              setEditing("new");
            }}
          >
            Create Client
          </button>
        )}
      </div>
      {!canEdit && (
        <p className="callout">
          Viewer access. Switch to Editor to make changes.
        </p>
      )}
      <p role="status">{notice}</p>
      {session.clients.length === 0 ? (
        <div className="empty">
          <h2>No clients yet</h2>
          <p>Create a client to begin planning.</p>
        </div>
      ) : (
        <ul className="cards">
          {session.clients.map((client) => (
            <li key={client.id} className="card">
              <div>
                <h2>{client.name}</h2>
                <p>{client.email}</p>
                <span className="badge">
                  {client.active ? "Active" : "Inactive"}
                </span>
              </div>
              {canEdit && (
                <div className="actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setNotice("");
                      setEditing(client);
                    }}
                  >
                    Edit Client
                  </button>
                  {client.active && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setNotice("");
                        setDeactivating(client);
                      }}
                    >
                      Deactivate Client
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing !== null && (
        <Modal
          title={editing === "new" ? "Create Client" : "Edit Client"}
          onClose={close}
        >
          <form onSubmit={submit} noValidate>
            <label>
              Name
              <input
                name="name"
                required
                minLength={2}
                maxLength={80}
                defaultValue={editing === "new" ? "" : editing.name}
              />
            </label>
            <label>
              Email
              <input
                name="email"
                type="email"
                required
                maxLength={160}
                defaultValue={editing === "new" ? "" : editing.email}
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <button disabled={busy} type="submit">
              {busy ? "Saving…" : "Save Client"}
            </button>
          </form>
        </Modal>
      )}
      {deactivating && (
        <Modal title="Deactivate Client" onClose={close}>
          <p>
            Deactivate {deactivating.name}? Existing plans will stay available.
          </p>
          {error && <p role="alert">{error}</p>}
          <button
            type="button"
            disabled={busy}
            onClick={() => void deactivate()}
          >
            Confirm Deactivation
          </button>
        </Modal>
      )}
    </>
  );
}
