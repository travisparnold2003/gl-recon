# Architecture

## Overview

```
Browser
  └── Next.js frontend (React, App Router)
        └── API routes (Next.js route handlers)
              ├── reconciliationService.ts  — orchestration, state transitions, journaling
              ├── workspaceService.ts       — settings, data sources, CSV ingestion, AI explanations
              └── domain/reconcileEngine.ts — pure matching algorithm (no I/O)
                    └── Prisma → PostgreSQL
                    └── ioredis → Redis (dashboard cache)
                    └── OpenRouter → LLM (Pass 3, optional)
```

---

## Layer responsibilities

### Frontend (`src/components/`)

React components that render the workspace UI. No business logic — they call API routes and display results.

- `ReconciliationDashboard.tsx` — state and data fetching orchestrator; owns all workspace state and passes data down to view components
- `views/DashboardView.tsx` — period progress, stat cards, source preview, health panel
- `views/ReconciliationView.tsx` — proposed pairs, GL exceptions, bank exceptions, matched pairs
- `views/JournalsView.tsx` — posted journal entries
- `views/AuditView.tsx` — audit event log
- `hooks/useToast.ts` — toast notification state
- `SettingsModal.tsx` — connector configuration

### API routes (`app/api/`)

Next.js route handlers that validate requests, call service functions, and return JSON responses. No business logic in the route handlers themselves.

Each route folder contains a single `route.ts` file with named HTTP method exports (`GET`, `POST`, `PUT`).

### Services (`src/server/services/`)

**`reconciliationService.ts`** — owns all state transitions: reconcile, approve, reject, journal posting, dashboard assembly. Handles Redis cache invalidation on every write.

**`workspaceService.ts`** — owns data source management, settings, CSV ingestion, Google Sheets sync, and the AI explanation workflow.

### Domain engine (`src/server/domain/reconcileEngine.ts`)

Pure function: takes a Prisma client and options, reads all pending transactions, runs three passes, writes results back. No HTTP or React dependencies. Deliberately isolated so it can be tested without a running server.

**Pass 1:** builds an in-memory index of bank transactions by absolute amount, then iterates GL rows looking for exact amount + date matches.

**Pass 2:** same amount index, date gap ≤ 3 days, confidence decays with gap size.

**Pass 3 (optional):** for remaining exceptions, scores all EXCEPTION bank candidates against each EXCEPTION GL row using a weighted formula. Top candidates above threshold are sent to the LLM.

### Persistence (`prisma/schema.prisma`)

| Model | Purpose |
|---|---|
| `GLTransaction` | General ledger line items from the ERP |
| `BankTransaction` | Bank statement lines |
| `JournalEntry` | Double-entry journals posted for exceptions |
| `MatchInsight` | Per-pair confidence and reasoning from each engine run |
| `AuditEvent` | Immutable log of all system actions |
| `ExceptionExplanation` | AI-generated or manual notes on exception items |
| `AppSetting` | Persisted connector settings (OpenRouter key, Sheets config) |
| `DataSource` | Registry of connected data sources and their sync state |

### Cache (`src/server/lib/redis.ts`)

Redis is used for one purpose: caching the `/api/dashboard` response for 5 seconds. This absorbs repeated polling without hitting Postgres on every refresh. The cache key `gl-recon:dashboard:v1` is invalidated immediately after any write (reconcile, approve, reject, journal post).

---

## Data flow: reconciliation run

```
User clicks "Run Engine"
  → POST /api/reconcile
  → reconciliationService.reconcileNow()
      → getSettingsPayload() (reads OpenRouter key from DB)
      → runReconciliationEngine(prisma, { apiKey, model })
          → Reset all MatchInsight rows
          → Set all GL + bank rows to PENDING
          → Pass 1: exact amount + date matches
          → Pass 2: near-match (same amount, ≤3 day gap)
          → Pass 3: LLM proposals for hard exceptions (if key configured)
          → Prisma $transaction: write all status updates + insights atomically
      → logEvent("reconcile", ...)
      → invalidateDashboardCache()
  → return { matched, proposed, llmProposed }
```

---

## Data flow: approve a proposed pair

```
User clicks "Approve"
  → POST /api/approve/:glId/:bankId
  → reconciliationService.approvePair(glId, bankId)
      → fetch both rows, validate both are PROPOSED
      → validate cross-references match (optimistic concurrency check)
      → Prisma $transaction:
          → updateMany GL where id=glId AND status=PROPOSED → MATCHED (count check)
          → updateMany bank where id=bankId AND status=PROPOSED → MATCHED (count check)
          → if either count ≠ 1, throw PAIR_STATE_CHANGED (409 to caller)
      → logEvent("approve", ...)
      → invalidateDashboardCache()
```

The double `updateMany` with status guard is a lightweight optimistic concurrency check: if another request approved the same pair between the read and the write, the count check fails and the API returns 409 rather than silently double-approving.

---

## Contract artifacts

`proto/reconciliation.proto` defines the typed service contract for the reconciliation domain. The `/api/contracts/dashboard-proto` endpoint serialises the dashboard payload as a Protobuf binary using this schema. This demonstrates that the REST JSON API and a binary contract can coexist — the same backing data, two wire formats.
