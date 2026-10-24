"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { DemoSession } from "../lib/model";
import { errorMessage, save } from "./request";

export function DemoControls({
  role,
  planStructure,
  planArchive,
}: {
  role: DemoSession["role"];
  planStructure: boolean;
  planArchive: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [settings, setSettings] = useState({
    role,
    planStructure,
    planArchive,
  });

  async function update(next: typeof settings) {
    const previous = settings;
    setSettings(next);
    setBusy(true);
    setError("");
    try {
      await save("/api/session", "POST", next);
      startTransition(() => router.refresh());
    } catch (cause) {
      setSettings(previous);
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="demo-controls" aria-label="Demo settings">
      <span>Demo controls</span>
      <label>
        Role{" "}
        <select
          data-pathcompiler="demo.role"
          aria-label="Role"
          value={settings.role}
          disabled={busy || refreshing}
          onChange={(event) =>
            void update({
              ...settings,
              role:
                event.target.value === "viewer"
                  ? "viewer"
                  : event.target.value === "admin"
                    ? "admin"
                    : "editor",
            })
          }
        >
          <option value="admin">Admin</option>
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
        </select>
      </label>
      <label className="checkbox">
        <input
          data-pathcompiler="demo.plan_structure"
          type="checkbox"
          checked={settings.planStructure}
          disabled={busy || refreshing}
          onChange={(event) =>
            void update({ ...settings, planStructure: event.target.checked })
          }
        />{" "}
        Plan structure feature
      </label>
      <label className="checkbox">
        <input
          data-pathcompiler="demo.plan_archive"
          type="checkbox"
          checked={settings.planArchive}
          disabled={busy || refreshing}
          onChange={(event) =>
            void update({ ...settings, planArchive: event.target.checked })
          }
        />{" "}
        Plan archive feature
      </label>
      {error && <p role="alert">{error}</p>}
    </aside>
  );
}
