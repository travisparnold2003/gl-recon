# Roadmap

What would be needed to take this from a working demo to a production-grade reconciliation service.

---

## Reliability

- Integration tests against an ephemeral PostgreSQL container in CI (using GitHub Actions `services:`).
- Idempotency keys on all mutation endpoints to prevent duplicate processing on retry.
- Distributed lock in Redis before the engine starts, so concurrent requests don't produce inconsistent match state.
- Structured audit payload schema validation (currently `detailsJson` is unvalidated freeform JSON).

---

## Finance workflow depth

- One-to-many matching: one GL line matched against multiple bank lines that sum to the same amount (common in split settlements, partial payments, and consolidated bank transfers).
- Rule configuration UI: persist user-defined matching rules (e.g. "ignore date gaps for transactions with reference prefix PAYROLL") with an associated confidence override.
- Period management: reconcile against a date boundary rather than resetting all state on every engine run.
- Exception work queues: assignable exception items with status, SLA countdown, and escalation state — replacing the current flat exception list.

---

## Security and governance

- Organisation-level authentication and RBAC: roles for read-only analyst, reconciliation approver, and admin.
- Fine-grained endpoint permissions: the approve/reject/journal-post actions require a specific role, not just any valid token.
- Immutable audit export: the current audit log can be deleted (it's a normal table). Production systems write audit events to an append-only log or export them to an external system on write.

---

## AI quality

- Confidence calibration: track LLM proposal outcomes (accepted vs rejected) and retrain or tune the score threshold based on historical accuracy.
- Human feedback loop: rejected AI proposals feed back into the matching model as negative examples.
- Explainability scoring: structured rubric for exception narratives (completeness, factual accuracy, suggested action clarity) rather than freeform text.

---

## Platform scale

- Async engine execution via a job queue (BullMQ + Redis): large datasets require the reconciliation engine to run in the background with progress events pushed to the UI, rather than blocking the HTTP request.
- Sharded tenant architecture for multi-company use.
- Multi-region failover on GCP with read replicas on Cloud SQL and a global Redis cluster.
