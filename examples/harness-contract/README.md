# Harness contract examples

Provider-neutral files for external coding harnesses (mode 6; ADR 0086).

| File | What it is |
| --- | --- |
| `HarnessTaskSpec.schema.json` | JSON Schema of the task PathCompiler hands to a harness |
| `MutationResult.schema.json` | JSON Schema of the result a harness returns |
| `task.json` | Restore Create Client for editors after a permission regression |
| `result.json` | A completed result naming its candidate commit |
| `blocked-result.json` | A harness refusing the task, with its reason (a valid outcome) |

A harness should:
- validate the task before touching the repository, and refuse unsupported
  major versions (`schemaVersion` `1.x`);
- validate its result before returning it.

PathCompiler never trusts the result's claims. It evaluates the candidate
commit independently (`pathcompiler evaluate`).

The schema files are generated from `@pathcompiler/harness-contracts`, and a
test fails if they drift.
