# ADR 0026 — GitHub App workflow checks

## Context

Phase 24 builds the real GitHub integration: app installation, least-privilege
permissions, webhook signature verification, push and pull request events,
check runs and installation tokens. The handler must verify, acknowledge quickly,
enqueue, process asynchronously and publish a check result. Spec §48 requires
signature verification, least privilege and never logging credentials.

## Decision

- Add `@pathcompiler/github-app` using Node `crypto`/`http` and `fetch`. There is
  no Octokit and no framework.
- **Permissions**: the manifest requests `checks: write`, `contents: read`,
  `metadata: read`, `pull_requests: read`, and subscribes only to `push` and
  `pull_request`. Installation tokens are requested **scoped down** to
  checks/contents/metadata and cached until 60 s before expiry.
- **Webhooks**: HMAC-SHA256 over the raw body with `timingSafeEqual`, then a
  202 response before any analysis. Jobs go to an in-process sequential queue,
  deduplicated by `X-GitHub-Delivery`. Branch creation/deletion pushes and
  non-code PR actions are acknowledged and ignored.
- **Processing**: a `RepositoryProvider` makes both commits available. The
  default provider fetches into a configured local clone, passing the token
  through `GIT_CONFIG_*` environment variables, so it never appears in argv,
  URLs or logs. Git stderr is never relayed. Approved/rejected workflows are read
  from the clone's committed `.pathcompiler`. Analysis reuses graph delta, impact
  and new-workflow detection.
- **Result**: one completed `PathCompiler Workflow Check` run on the head commit,
  in the spec's summary format. Review needs and new workflows are `neutral`, a
  clean change is `success`, and analysis errors are `failure` with an actionable
  summary.

## Alternatives

- Durable queue (Redis/SQS) now: hosted infrastructure the spec defers. The
  `JobQueue` interface allows swapping it later.
- `action_required` conclusions: block merges and require a details URL, but the
  dashboard does not exist yet.
- Cloning with a token in the remote URL: leaks through process listings and Git
  configuration.

## Consequences

Everything is exercised offline: signatures, event normalization, quick
acknowledgement, deduplication, JWT signatures against the public key, scoped
token requests, check payloads, and an end-to-end push analysis fetching from a
local origin. Nothing has been run against live GitHub, a public HTTPS endpoint or
a real installation. The in-process queue loses work on restart, and redelivery
is the recovery path. Webhook-triggered proposal files are not written; reviewers
run `proposals generate` locally.
