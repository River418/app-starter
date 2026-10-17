# Application structure

```text
app.config.ts                    public application choices
src/client/                      React shell, router, SDK, Query, UI
src/features/records/client/      records UI
src/features/records/shared/      DTOs and validation
src/features/records/server/      owner-scoped CRUD
src/server/                      Hono, Auth, administration, D1, private R2
src/server/entrypoints/web.ts     Worker + bounded scheduled cleanup
src/server/entrypoints/agent.ts   entry reserved for Phase 4
migrations/                      forward-only D1 migrations
supabase/                        isolated local Auth and email templates
probes/                          archived Phase 1 experiments
```

Vite emits browser static assets and a separate Worker. The import graph chooses the runtime. Build guards check client/shared sources, feature boundaries, re-exports and dynamic imports; tests inspect real output. Browser/shared code cannot import server implementations, bindings, probes or deployment config. Shared DTOs run on either side.

React Router Data mode owns loaders/protected layouts. TanStack Query owns server data; Supabase owns cookies/session events. Form state stays local; search/page/selection live in URL. Theme and language are preferences. No extra global state framework is required.

Hono authorizes Supabase identity against active D1 membership. Browser role checks only affect navigation. Drizzle handles ordinary record queries; explicit conditional SQL/atomic batches coordinate bootstrap, audits and file journals.

R2 stays private. Owner-authorized downloads use attachment disposition and nosniff. Upload bodies have a server byte cap and 30-second input deadline, then a bounded buffer is put into R2. A pending D1 journal exists first. Binding failure/deleted records trigger cleanup. Record deletion retains object mapping for retries. A ten-minute Cron processes at most 20 candidates; failed attempts rotate. Crashed unfinished uploads keep small tombstones so late puts remain discoverable. Do not prune unfinished tombstones without reconciling their object keys.

Web imports no AI SDK, Agent UI or Workflow export/binding. Agent execution is Phase 4. Until it wires the real run/outbox/reservation drain query, Agent-to-Web deployment fails closed, including from a clean checkout (checks current remote preset).

Stripe billing, model streaming, persistent runs, confirmation tools and settlement remain subsequent phases. Archived probes are evidence of specific experiments, not product features.
