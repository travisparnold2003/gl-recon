# Technical Decisions

Rationale behind each technology choice, what alternatives were considered, and what is simplified relative to a production system.

---

## Next.js 14 (App Router)

**Chosen because:** Next.js handles both the React frontend and the backend API routes in a single project. The App Router model co-locates server-side data fetching with the components that need it, which keeps the boundary between UI and API explicit. It also produces a single Docker image that serves both the frontend and the REST endpoints, which simplifies the deployment model significantly.

**Alternatives considered:**
- *Separate React SPA + Express/FastAPI backend:* cleaner separation of concerns but doubles the deployment surface and requires CORS configuration. Adds complexity without benefit at this scale.
- *Remix:* similar unified model but smaller ecosystem and less alignment with the production stack this project was designed to mirror.
- *tRPC:* would give end-to-end type safety on the API layer without a separate schema, but adds a dependency and diverges from the standard REST model that ERP connectors expect.

**Simplification vs production:** a production system would likely split the API into a dedicated service (for independent scaling of the reconciliation engine) and use Next.js only for the frontend. At demo scale, a monolith is the right tradeoff.

---

## TypeScript

**Chosen because:** financial data processing has a high cost of type errors. Using TypeScript across both the frontend (React components) and backend (domain engine, API routes, services) means that the shape of a `GLTransaction` or `DashboardPayload` is checked at compile time, not discovered at runtime. The Prisma ORM also generates types directly from the database schema, which closes the loop between the DB model and the application code.

**Alternatives considered:**
- *Plain JavaScript:* no compile-time safety. Any shape mismatch between the DB row and the API response only appears at runtime under specific data conditions.
- *Python (FastAPI):* strong typing via Pydantic but a different runtime, which would mean two separate deployment containers and no shared types across the stack.

---

## PostgreSQL + Prisma

**Chosen because:** reconciliation is a relational problem. GL transactions reference accounts; bank transactions reference GL transactions by ID; journals reference exceptions; audit events reference mutations. A relational database models these constraints directly and enforces them at the storage layer. Prisma provides a typed query builder that generates TypeScript types from `schema.prisma`, eliminating a whole class of query/model mismatch errors.

**Why `Decimal` for money:** floating-point arithmetic is wrong for financial amounts. `0.1 + 0.2 !== 0.3` in IEEE 754. Prisma's `@db.Decimal(14, 2)` maps to PostgreSQL's `NUMERIC` type, which stores exact decimal values. All money is stored as exact decimals and converted to numbers only for display.

**Alternatives considered:**
- *SQLite:* simpler setup, no server required, but no `NUMERIC` type support and not appropriate for any multi-user or production scenario.
- *MongoDB:* flexible schema is an anti-pattern for financial data where the schema is the contract. Also lacks transactional guarantees that are critical for double-entry bookkeeping.
- *Drizzle ORM:* lighter than Prisma, but Prisma's schema-first approach and migration tooling is more mature for financial schemas with strict type requirements.

---

## Redis

**Chosen because:** the dashboard query reads all GL rows, bank rows, journals, and match insights in a single round-trip to build the response. With sample data this is fast, but as transaction volume grows this becomes expensive. Redis provides a short-lived (5-second TTL) read-through cache that absorbs repeated dashboard polls without hitting Postgres. Cache entries are invalidated on every write operation (reconcile, approve, reject, journal post) so the UI always sees fresh state after an action.

**Simplification vs production:** in production Redis would also serve as a distributed lock to prevent two concurrent reconciliation runs from producing inconsistent state. It would also back a job queue for async processing of large datasets. In this demo it is cache-only, with the lock problem avoided by the single-server deployment model.

**Alternatives considered:**
- *In-process memory cache (Map/LRU):* works in a single-process environment but doesn't survive server restarts and breaks under horizontal scaling. Redis provides an external cache that any process can read from.
- *No cache at all:* acceptable at demo scale. Added Redis because it is part of the intended production stack and worth demonstrating with real behaviour rather than as a health-check placeholder.

---

## Protocol Buffers (protobufjs)

**Chosen because:** ERP integration frequently uses binary serialisation formats rather than JSON, partly for efficiency and partly because the schema acts as a versioned contract between services. The `proto/reconciliation.proto` file defines the `DashboardResponse`, `GLTransaction`, and `BankTransaction` message types. The `/api/contracts/dashboard-proto` endpoint returns the dashboard payload serialised as a Protobuf binary, demonstrating that the same data can be served in a typed binary format alongside the JSON API.

**Note on `Money`:** the proto uses `int64 minor_units` rather than a float for amounts. This is the correct approach — floats cannot represent currency values exactly.

**Simplification vs production:** in production, Protobuf contracts would be the primary API format and versioned in a schema registry. Here it is a secondary endpoint alongside the main JSON API.

**Alternatives considered:**
- *JSON Schema:* human-readable but no binary encoding and no typed client generation.
- *gRPC:* the natural production choice with Protobuf, but requires an HTTP/2 transport which adds infrastructure complexity. REST with Protobuf serialisation is a common intermediate step.

---

## OpenRouter (LLM integration)

**Chosen because:** OpenRouter is a free API gateway that routes to multiple LLM providers. The AI-assisted matching pass (Pass 3) sends exception pairs to an LLM and asks it to propose a match with confidence and reasoning. This demonstrates the pattern without requiring a paid API contract or a specific provider.

**What the LLM does:** for GL exceptions that survive Passes 1 and 2, the engine scores remaining bank candidates using a weighted function (amount 55%, date 25%, description token overlap 20%). The top candidates above a 0.42 score threshold are sent to the LLM as structured JSON. The LLM returns a proposed `bank_id`, confidence score (0–100), and a short reasoning string. Proposals below 55% confidence are discarded. Maximum 6 LLM calls per engine run to bound latency and cost.

**Simplification vs production:** in production the LLM layer would have retry logic, provider fallback, cost tracking, and confidence calibration against historical match outcomes. The model choice (Llama 3.1 70B free tier) is intentionally lightweight for a demo.

---

## Terraform + GCP

**Chosen because:** infrastructure-as-code is standard practice for anything expected to be reproducible across environments. The `infra/terraform/` directory defines a Cloud Run service (application), a Cloud SQL PostgreSQL instance (database), and a Redis Memorystore instance (cache), matching the local Docker Compose topology. This demonstrates that the local and production environments use the same architecture — only the hosting changes.

**Simplification vs production:** the Terraform files are a scaffold, not an applied deployment. A production configuration would add Secret Manager for credentials, Cloud Armor for edge protection, Cloud Run IAM for service-to-service auth, VPC peering, and a CI/CD pipeline that runs `terraform apply` on merge to main.

**Alternatives considered:**
- *Pulumi:* code-first IaC in TypeScript, which would fit the project's language. But Terraform has a larger ecosystem of providers and is the standard in most infrastructure teams.
- *Kubernetes (GKE):* more flexibility but significantly more operational overhead. Cloud Run is the right abstraction for a containerised web application without needing persistent compute.

---

## GitHub Actions (CI)

**Chosen because:** every professional project should have a quality gate that runs on every commit. The CI pipeline runs `npm ci`, `npm run lint`, `npm run test`, and `npm run build` — catching type errors, lint violations, and broken builds before they reach the main branch.

**What is not in CI yet (and why):**
- *Integration tests against a real Postgres instance:* the existing tests are unit-level. Integration tests require an ephemeral Postgres container in CI (using `services:` in the workflow) and are the next logical step.
- *`terraform plan` in CI:* would validate the IaC on every change to `infra/`, but requires GCP credentials which are not configured in the demo repository.
