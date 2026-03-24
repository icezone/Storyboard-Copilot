# Storyboard Copilot: Desktop to Web Migration Plan (v2)

> Engineer-facing migration plan for an immediate desktop replacement strategy. This document assumes the web product becomes the primary product during implementation rather than running a long desktop/web coexistence period.

## 1. Goal

Migrate Storyboard Copilot from a Tauri desktop prototype to a web-based product that can be shared, discovered, monetized, and operated as a SaaS offering for the creative video community.

This v2 plan assumes:

- the web app becomes the main product during implementation
- desktop is not treated as a long-term parallel surface
- engineering prioritizes feature continuity on web over preserving desktop-specific behavior
- any remaining desktop usage is transitional and short-lived

## 2. Product Intent

Storyboard Copilot is not just an internal editor. It is the main product of a startup focused on AI-assisted creative video generation. The migration is therefore both:

- a platform migration
- a product distribution and growth strategy

Success is not simply "the app works in browser". Success means:

- creators can reliably create on the web
- AI image and video workflows remain strong
- projects can be shared publicly
- the system is operable under real user load
- billing and moderation can support a public launch

## 3. Strategy: Immediate Desktop Replacement

### 3.1 Strategy decision

Adopt a web-first replacement strategy:

- all new product investment targets the web app
- desktop-specific feature work stops except for essential migration/export support if needed
- the release train is centered around the web app reaching parity on critical workflows
- once the replacement threshold is reached, desktop is retired quickly rather than maintained in parallel

### 3.2 Why this strategy may be valid

This strategy is reasonable if leadership wants:

- one product surface instead of split focus
- faster market entry and community growth
- faster iteration on sharing, billing, and public discovery
- reduced long-term engineering duplication

### 3.3 What this changes

Compared with a coexistence approach, immediate replacement means:

- migration readiness must happen earlier
- reliability bar is higher before launch
- project import/export must be addressed before or at launch
- rollback and incident plans must be stronger
- unsupported desktop-only workflows need explicit product decisions, not "later"

## 4. Constraints From the Current Codebase

Current strengths:

- `src/features/canvas/application/ports.ts` already defines useful boundaries such as `AiGateway`, `VideoAiGateway`, `ImageSplitGateway`, and `ToolProcessor`
- canvas interaction logic is primarily frontend-driven
- node definitions are centralized in `src/features/canvas/domain/nodeRegistry.ts`
- AI model definitions are already modularized
- command wrappers are isolated under `src/commands/`

Current desktop assumptions to remove:

- Tauri invoke-based persistence and media workflows
- local file path handling in `src/features/canvas/application/imageData.ts`
- native dialogs and open/reveal integrations
- local-only persistence in `src/stores/projectStore.ts`
- Tauri-specific update/version shell behavior

## 5. Architectural Principles

- reuse existing canvas domain logic where possible
- keep interaction-heavy editor logic client-side
- move secrets, billing, credits, and provider control to trusted server paths
- treat assets as first-class records, not only embedded URLs
- design explicitly for browser/network failure
- default to private assets and explicit publish flows
- separate request-response APIs from long-running job processing
- make the web app launchable without depending on desktop after release

## 6. Recommended Target Architecture

## 6.1 Frontend

- Next.js App Router
- React 19
- TypeScript
- Zustand
- `@xyflow/react`
- TailwindCSS

Core idea:

- keep the canvas runtime in the browser
- move persistence, AI execution, asset storage, billing, and admin operations to web services

## 6.2 Backend

- Supabase Auth for identity
- Supabase Postgres for application data
- Supabase Storage for media
- Supabase Realtime for notifications
- Vercel for web app and synchronous APIs
- dedicated worker runtime for async jobs

## 6.3 Why a worker is mandatory

Do not rely on Vercel route handlers alone for:

- long-running video generation
- provider polling
- retryable image processing
- cost-aware job control
- cleanup and moderation pipelines

Required async model:

1. Client submits request.
2. API validates auth, quota, limits, and payload.
3. API writes durable job state.
4. Worker executes provider flow.
5. Worker updates job state and outputs.
6. Client receives updates via Realtime.

Realtime is the notification layer, not the job engine.

## 7. Recommended Data Model

The original one-row `projects` design is too weak for a public web product. Use a more explicit model.

### 7.1 `profiles`

Purpose:

- user profile and safe preferences

Client-editable fields:

- `display_name`
- `avatar_url`
- `theme`
- `locale`

Server-owned fields:

- `plan`
- `is_admin`
- balance / credits cache
- moderation state

### 7.2 `projects`

Purpose:

- project identity and metadata

Suggested fields:

- `id`
- `user_id`
- `name`
- `visibility`
- `thumbnail_asset_id`
- `latest_draft_id`
- `latest_published_snapshot_id`
- `node_count_cache`
- `flagged`
- `flag_reason`
- `created_at`
- `updated_at`

### 7.3 `project_drafts`

Purpose:

- current editable canvas state

Suggested fields:

- `id`
- `project_id`
- `revision`
- `nodes_json`
- `edges_json`
- `viewport_json`
- `history_json`
- `image_pool_json`
- `saved_by_session_id`
- `created_at`
- `updated_at`

Guidance:

- keep image-pool compaction from `src/stores/projectStore.ts`
- trim persisted history aggressively
- use numeric revisioning for conflict detection

### 7.4 `project_snapshots`

Purpose:

- publishable or recoverable checkpoints

Suggested fields:

- `id`
- `project_id`
- `source_draft_id`
- `snapshot_type`
- `nodes_json`
- `edges_json`
- `viewport_json`
- `image_pool_json`
- `created_by`
- `created_at`

### 7.5 `project_assets`

Purpose:

- track source and generated media

Suggested fields:

- `id`
- `owner_user_id`
- `project_id`
- `kind`
- `storage_bucket`
- `storage_path`
- `mime_type`
- `size_bytes`
- `width`
- `height`
- `duration_ms`
- `checksum`
- `visibility`
- `moderation_state`
- `source_asset_id`
- `created_at`
- `deleted_at`
- `expires_at`

### 7.6 `ai_jobs`

Purpose:

- durable execution state for image/video/tool jobs

Suggested fields:

- `id`
- `user_id`
- `project_id`
- `node_id`
- `job_type`
- `provider`
- `model`
- `status`
- `progress`
- `request_json`
- `result_json`
- `error_code`
- `error_message`
- `external_job_id`
- `attempt_count`
- `credit_hold_amount`
- `started_at`
- `completed_at`
- `created_at`
- `updated_at`

### 7.7 `credit_ledger`

Purpose:

- immutable accounting and audits

Suggested fields:

- `id`
- `user_id`
- `event_type`
- `amount`
- `balance_after`
- `reference_type`
- `reference_id`
- `notes`
- `created_at`

### 7.8 Supporting tables

- `subscriptions`
- `payments`
- `feedback`
- `moderation_cases`
- `admin_audit_log`

## 8. Security Model

### 8.1 General rule

Use both:

- Row Level Security for data isolation
- server-side authorization for privileged actions

### 8.2 Never client-write these directly

- plan changes
- credits
- admin flags
- moderation outcomes
- payment state
- decrypted provider keys

### 8.3 Asset privacy

Default:

- private storage buckets
- signed URLs for private project access

Public only when explicitly published:

- public gallery pages
- published project thumbnails
- public preview surfaces

## 9. Reliability Requirements

Because desktop replacement is immediate, the web editor must be safe enough to become the default workspace quickly.

Required resilience features:

- autosave
- local draft cache in IndexedDB
- unsynced-state indicator
- retry queue for save/upload flows
- duplicate-tab conflict detection
- restore flow after refresh/crash
- reconnect handling after sleep/offline

Required save-state UX:

- saving
- saved
- unsynced
- offline
- conflict detected
- retry required

## 10. Asset and Media Strategy

### 10.1 Uploads

All uploads should move through a controlled asset pipeline:

1. user selects file
2. browser uploads to controlled storage path
3. server validates and records asset metadata
4. app creates or updates nodes using asset references

### 10.2 Derived assets

Generated previews, splits, crops, merged outputs, and video results should be recorded as assets, not just pushed back into node JSON as anonymous URLs.

### 10.3 Cleanup policy

Implement lifecycle policy from the start:

- soft-delete support
- expiry for free-tier heavy assets if product policy requires it
- cleanup jobs for abandoned temporary assets

## 11. AI and Video Execution Model

### 11.1 Image generation

Image generation may be synchronous for some providers but should still be designed as job-capable so the system can:

- standardize tracking
- support retries
- provide consistent analytics
- enforce credits cleanly

### 11.2 Video generation

Video generation must be async.

Required behavior:

- durable job creation
- provider submission tracking
- background polling or webhook processing
- progress updates where available
- output asset registration
- failure states that are explicit to the user

### 11.3 Tool processing

Tool operations currently routed through local commands should become either:

- synchronous APIs for small safe jobs
- queued jobs for heavy operations

Examples:

- crop: can remain synchronous if bounded
- split/merge: may need async or guarded sync path depending on file size

## 12. Publishing and Community

Immediate desktop replacement only makes business sense if web unlocks the intended community value quickly.

Minimum publish/community scope for initial public launch:

- publish project
- unpublish project
- public read-only project page
- report abuse
- moderation review queue
- fork public project

Not required for first launch:

- comments
- likes
- following
- notifications
- real-time collaboration

## 13. Desktop Retirement Requirements

Because the strategy is immediate replacement, desktop retirement criteria must be explicit.

Before desktop shutdown or strong deprecation messaging:

- critical creation workflows must work on web
- project import path must exist
- AI image and video paths must be reliable enough for production
- support must have troubleshooting tools
- billing and moderation must be operational if public launch includes them

## 14. Desktop Migration Path

Even with immediate replacement, users still need a migration bridge.

Required capabilities:

- export desktop project to portable JSON package
- import package into web project draft
- upload and remap image/video assets
- show migration warnings for unsupported data
- record migration source/version

Recommended order:

1. define package format
2. implement export compatibility
3. implement web import flow
4. test with representative real projects

## 15. Repository and File Plan

Target web structure:

```text
app/
  (marketing)/
  (auth)/
  (app)/
  (admin)/
  api/
src/
  components/
  commands/
  features/
    canvas/
      application/
      domain/
      infrastructure/
      nodes/
      ui/
  lib/
    supabase/
    analytics/
    observability/
    auth/
  server/
    ai/
    video/
    image/
    billing/
    moderation/
    projects/
    jobs/
workers/
  src/
supabase/
  migrations/
```

### 15.1 Existing files to preserve conceptually

- `src/features/canvas/application/ports.ts`
- `src/features/canvas/domain/canvasNodes.ts`
- `src/features/canvas/domain/nodeRegistry.ts`
- `src/features/canvas/models/**`
- most canvas node components and UI

### 15.2 Existing files to replace or adapt

- `src/stores/projectStore.ts`
- `src/commands/projectState.ts`
- `src/commands/image.ts`
- `src/commands/ai.ts`
- `src/commands/video.ts`
- `src/features/canvas/application/imageData.ts`

### 15.3 New files to introduce

- `src/stores/projectStore.web.ts`
- `src/features/canvas/application/imageData.web.ts`
- `src/features/canvas/infrastructure/webAiGateway.ts`
- `src/features/canvas/infrastructure/webVideoGateway.ts`
- `src/features/canvas/infrastructure/webImageSplitGateway.ts`
- `src/lib/supabase/client.ts`
- `src/lib/supabase/server.ts`
- `src/server/projects/**`
- `src/server/jobs/**`
- `src/server/ai/**`
- `src/server/video/**`
- `src/server/image/**`
- `src/server/billing/**`
- `workers/src/**`

## 16. API Plan

### 16.1 Project APIs

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:id`
- `PATCH /api/projects/:id`
- `DELETE /api/projects/:id`
- `GET /api/projects/:id/draft`
- `PUT /api/projects/:id/draft`
- `POST /api/projects/:id/snapshots`
- `POST /api/projects/:id/publish`
- `POST /api/projects/:id/unpublish`
- `POST /api/projects/:id/fork`

### 16.2 Asset APIs

- `POST /api/assets/upload`
- `POST /api/assets/complete`
- `GET /api/assets/:id`
- `DELETE /api/assets/:id`

### 16.3 AI and media APIs

- `POST /api/ai/image/generate`
- `POST /api/ai/video/generate`
- `POST /api/image/split`
- `POST /api/image/crop`
- `POST /api/image/merge`
- `GET /api/jobs/:id`

### 16.4 Billing APIs

- `POST /api/billing/checkout`
- `POST /api/billing/portal`
- `POST /api/webhooks/stripe`

### 16.5 Admin APIs

- `GET /api/admin/users`
- `GET /api/admin/jobs`
- `GET /api/admin/moderation`
- `POST /api/admin/moderation/:id/resolve`
- `POST /api/admin/credits/grant`

## 17. Delivery Phases

## Phase 0: Replacement readiness and architecture lock

Goal:

- lock down the replacement strategy before implementation fans out

Deliverables:

- worker platform decision
- final project/draft/asset schema decision
- auth and privilege model
- asset privacy strategy
- desktop export/import package format
- cost guardrails

Exit criteria:

- one end-to-end image generation spike works
- one end-to-end video job lifecycle works
- signed private asset delivery works
- one representative desktop project imports successfully

## Phase 1: Foundation

Scope:

- Next.js app shell
- Supabase auth
- route protection
- base schema
- Sentry
- PostHog
- staging setup
- feedback entry point
- legal placeholders

Exit criteria:

- auth works
- protected routes work
- core telemetry works
- privileged fields are server-only

## Phase 2: Editor replacement MVP

Scope:

- project CRUD
- canvas boot and persistence
- autosave
- local recovery
- image upload
- private asset display
- conflict handling

Exit criteria:

- web editor can replace desktop for the main internal workflow
- duplicate-tab risk is handled
- refresh and reopen preserve work
- image-backed nodes work correctly in web

## Phase 3: AI and media replacement MVP

Scope:

- image generation
- video generation
- image tool APIs
- job workers
- realtime job updates
- credit accounting

Exit criteria:

- main AI workflows work on web
- failed jobs are observable and recover correctly
- video jobs survive refresh/reconnect

## Phase 4: Public launch hardening

Scope:

- publish / unpublish
- moderation baseline
- billing
- admin diagnostics
- import UX
- support and incident tooling

Exit criteria:

- web is launchable as the main product
- desktop users have a migration path
- support can operate production issues

## Phase 5: Desktop shutdown / deprecation execution

Scope:

- migration communications
- desktop shutdown path
- docs and user messaging
- remaining compatibility handling

Exit criteria:

- launch metrics are healthy
- migration success rate is acceptable
- leadership approves desktop retirement

## 18. Workstreams

### Workstream A: Auth and app shell

Files:

- `app/(auth)/**`
- `app/(app)/**`
- `middleware.ts`
- `src/lib/supabase/**`

### Workstream B: Project persistence and recovery

Files:

- `src/stores/projectStore.web.ts`
- `src/server/projects/**`
- `supabase/migrations/**`

### Workstream C: Canvas and node migration

Files:

- `src/features/canvas/Canvas.tsx`
- `src/features/canvas/nodes/**`
- `src/features/canvas/ui/**`
- `src/features/canvas/infrastructure/**`

### Workstream D: AI, image, and video execution

Files:

- `src/server/ai/**`
- `src/server/video/**`
- `src/server/image/**`
- `src/server/jobs/**`
- `workers/src/**`

### Workstream E: Billing, moderation, and admin

Files:

- `src/server/billing/**`
- `app/api/webhooks/**`
- `app/(admin)/**`
- `src/features/admin/**`

## 19. Risks

### Highest risks

- web editor data loss during early replacement
- underestimating desktop import complexity
- private asset leakage
- weak async job orchestration for video
- poor launch quality if replacement pressure is too aggressive

### Mitigations

- force reliability work earlier than polish
- require import path before strong desktop deprecation
- keep assets private by default
- use durable job workers
- set hard launch gates for editor stability

## 20. Verification Plan

### Functional verification

1. user signs up and logs in
2. creates project
3. loads canvas
4. adds and connects nodes
5. uploads image
6. refreshes page and sees draft restored
7. opens same project in two tabs and sees safe conflict handling
8. generates image successfully
9. generates video successfully with async progress
10. publishes project
11. views public project
12. reports public project for moderation

### Technical verification

- RLS isolation tests
- privileged flow authorization tests
- signed URL tests
- worker retry tests
- idempotency tests
- webhook replay tests
- import compatibility tests
- graph performance tests

### Operational verification

- simulate provider outage
- simulate storage delivery issue
- simulate Stripe webhook failure
- validate alerts and runbooks

## 21. Launch Gates

### Gate A: Replacement-ready internal beta

- no critical editor data-loss bugs
- image generation stable
- video generation stable enough for internal workflows
- import flow works on real projects

### Gate B: Public launch

- billing stable
- moderation baseline active
- admin and support paths operational
- web can serve as the main product

### Gate C: Desktop retirement

- migration path proven
- support burden acceptable
- reliability metrics acceptable

## 22. Timeline Guidance

Immediate replacement is faster in surface count, but riskier in launch pressure. A realistic planning guide for a small startup team:

- Phase 0: 2 to 3 weeks
- Phase 1: 2 to 3 weeks
- Phase 2: 4 to 6 weeks
- Phase 3: 4 to 6 weeks
- Phase 4: 3 to 4 weeks
- Phase 5: 1 to 2 weeks for shutdown execution if metrics are healthy

Target:

- replacement-ready internal beta in roughly 2.5 to 3 months
- public launch as main product in roughly 4 to 5 months

## 23. Immediate Next Steps

1. Approve immediate replacement as an executive decision.
2. Lock the worker/job architecture before broader implementation.
3. Lock the draft/snapshot/asset schema.
4. Define desktop export/import format immediately.
5. Convert this plan into a task-by-task implementation backlog.
