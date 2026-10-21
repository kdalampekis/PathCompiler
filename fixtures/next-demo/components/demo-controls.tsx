"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { DemoSession } from "../lib/model";
import { errorMessage, save } from "./request";

export function DemoControls({
  role,
  planStructure,
}: {
  role: DemoSession["role"];
  planStructure: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [settings, setSettings] = useState({ role, planStructure });

  async function update(nextRole: DemoSession["role"], nextFlag: boolean) {
    const previous = settings;
    setSettings({ role: nextRole, planStructure: nextFlag });
    setBusy(true);
    setError("");
    try {
      await save("/api/session", "POST", {
        role: nextRole,
        planStructure: nextFlag,
      });
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
          aria-label="Role"
          value={settings.role}
          disabled={busy || refreshing}
          onChange={(event) =>
            void update(
              event.target.value === "viewer" ? "viewer" : "editor",
              settings.planStructure,
            )
          }
        >
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
        </select>
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={settings.planStructure}
          disabled={busy || refreshing}
          onChange={(event) => void update(settings.role, event.target.checked)}
        />{" "}
        Plan structure feature
      </label>
      {error && <p role="alert">{error}</p>}
    </aside>
  );
}
