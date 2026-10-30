# Refunds fixture

A small, framework-free TypeScript service used to develop and evaluate
PathCompiler's behavioral-specification features: extraction, verification,
the PR guard, the agent action gate and counterexample evals. It is not a
real payments system.

| Path | Purpose |
| --- | --- |
| `src/refunds.ts` | The service (the "base" version): guard clauses throw on invalid input |
| `db/schema.sql` | SQL constraints on payments and refund requests |
| `src/models.ts` | Zod validation models |
| `api/openapi.json` | The HTTP contract |
| `tests/refunds.test.ts` | Test assertions (documentation fixtures; not run by the repository's test runner) |
| `tests/scenarios.ts` | The same kind of example tests as plain functions; they pass on the base service and on **every** variant |
| `spec/approved-rules.json` | The rules a human approved (BehaviorIR) |
| `spec/ground-truth.json` | Hand-written expected extraction results, for precision and recall |
| `variants/*.ts` | Candidate versions of `src/refunds.ts`: three break a rule the tests do not cover, two are benign |

Roles: `support_agent`, `manager`, `customer`.

Rules the approved specification states:
- a payment's refunded total never goes below zero or above the original amount;
- a refund above 5000 needs manager approval;
- only a manager approves a refund, and never their own request;
- a refund request cannot be processed twice.

## Extracting the specification

```bash
pnpm pathcompiler behavior extract fixtures/refunds \
  --bind payment=payments --bind createRefund=refund --bind request=refund_requests \
  --exclude variants
```

`variants/` holds alternative versions of the same functions, so it is
excluded: analyze one version at a time. The PR guard (BX4) analyzes a
candidate by replacing `src/refunds.ts` with the variant.
