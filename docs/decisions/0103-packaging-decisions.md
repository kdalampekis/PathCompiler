# ADR 0103 — Packaging decisions (input to BX16)

## Context

The adoption audit (docs/ADOPTION_AUDIT.md) found installation to be the largest
remaining barrier for companies without a JavaScript toolchain.

## Decision (from the project owner, 2026-10-30)

- License: **Apache-2.0**.
- npm scope: **`@pathcompiler/*`**; fallback **`@pathcompilerhq/*`** if the scope
  is unavailable.
- Publishing: **not yet.** All packages stay `private: true` until the owner says
  otherwise.
- Next milestone: the **real-software trial**, before packaging.

## Consequences

- BX16 (packaging) is prepared but not executed: it needs the verbatim Apache-2.0
  text from apache.org as `LICENSE` (not hand-written), license and repository
  metadata, removal of `private`, and a container image, in that order, after the
  trial.
