# Storyboard Copilot: Desktop → Web Migration Plan

## Context

**Problem**: Storyboard Copilot is a Tauri 2 desktop app for AI-powered storyboard creation (image generation, editing, video generation on a node canvas). It needs to become a web SaaS product to reach broader audiences, support multi-user features, and enable monetization.

**Decisions**:
- **Framework**: Next.js 15 (App Router) — full-stack, SSR landing page, API routes
- **Backend**: Supabase (PostgreSQL + Auth + Storage + Realtime)
- **Payments**: Stripe (global) + Alipay/WeChat Pay (China) — stubs first
- **Deploy**: Vercel + Supabase Cloud
- **Strategy**: Web-only, replace Tauri desktop entirely

**Key Advantage**: The existing codebase uses **ports & adapters** pattern (`src/features/canvas/application/ports.ts`) with clean interfaces (`AiGateway`, `VideoAiGateway`, `ImageSplitGateway`, `ToolProcessor`). Tauri implementations in `infrastructure/` can be swapped for web API implementations with minimal changes to business logic.

---

## Phase 1: Project Scaffolding + Auth + Database

### 1.1 Create Next.js Project

```
storyboard-copilot-web/
├── app/                          # Next.js App Router
│   ├── (marketing)/              # Landing, pricing (SSG, public)
│   │   ├── page.tsx              # Landing page
│   │   └── pricing/page.tsx
│   ├── (auth)/                   # Auth pages (public)
│   │   ├── login/page.tsx
│   │   ├── signup/page.tsx
│   │   └── callback/page.tsx     # OAuth callback
│   ├── (app)/                    # Authenticated app shell
│   │   ├── layout.tsx            # Auth guard + sidebar
│   │   ├── dashboard/page.tsx    # Project list (← ProjectManager.tsx)
│   │   ├── canvas/[id]/page.tsx  # Canvas workspace (← Canvas.tsx)
│   │   ├── settings/page.tsx     # User settings + API keys
│   │   └── billing/page.tsx      # Subscription + credits
│   └── api/                      # API routes (replace Tauri commands)
│       ├── ai/                   # Image generation proxy
│       ├── video/                # Video generation proxy
│       ├── image/                # Image processing
│       └── webhooks/             # Stripe + payment webhooks
├── src/
│   ├── features/canvas/          # ← REUSE from current project
│   │   ├── domain/               # ← Copy as-is (canvasNodes.ts, nodeRegistry.ts, nodeDisplay.ts)
│   │   ├── application/          # ← Copy as-is (ports.ts, eventBus.ts, toolProcessor.ts, etc.)
│   │   ├── infrastructure/       # ← REPLACE: webAiGateway.ts, webVideoGateway.ts, webImageSplitGateway.ts
│   │   ├── models/               # ← Copy as-is (registry, providers, model definitions)
│   │   ├── nodes/                # ← Copy with minor edits (remove Tauri plugin imports)
│   │   ├── tools/                # ← Copy as-is
│   │   ├── ui/                   # ← Copy as-is
│   │   ├── edges/                # ← Copy as-is
│   │   ├── hooks/                # ← Copy as-is
│   │   └── pricing/              # ← Copy as-is
│   ├── features/project/         # ← Adapt for web (use Supabase instead of Tauri commands)
│   ├── features/settings/        # ← Adapt (API keys stored server-side per user)
│   ├── stores/                   # ← Adapt (canvasStore mostly as-is, projectStore rewrite for Supabase)
│   ├── components/ui/            # ← Copy primitives.tsx, motion.ts, useDialogTransition.ts
│   ├── i18n/                     # ← Copy as-is
│   ├── lib/                      # NEW: Supabase client, auth helpers, payment utils
│   └── server/                   # NEW: Server-side AI providers, image processing
│       ├── ai/                   # Port Rust AI providers to TypeScript
│       │   ├── providers/        # ppio.ts, grsai.ts, kie.ts, fal.ts
│       │   └── registry.ts
│       ├── video/                # Port Rust video providers to TypeScript
│       │   ├── providers/        # kling.ts, sora2.ts, veo.ts, kie-common.ts
│       │   └── registry.ts
│       └── image/                # sharp-based image processing
│           └── processor.ts      # split, crop, merge, metadata
├── supabase/
│   └── migrations/               # SQL migration files
└── package.json
```

**Key packages**:
- `next@15`, `react@19`, `typescript`, `tailwindcss@4`
- `@supabase/supabase-js`, `@supabase/ssr` — auth + DB + storage
- `@xyflow/react@12` — canvas (client component)
- `zustand@5` — state management
- `i18next`, `react-i18next` — i18n (copy existing config)
- `sharp` — server-side image processing (replaces Rust image crate)
- `stripe` — payment SDK
- `lucide-react` — icons
- `zod` — API validation

### 1.2 Supabase Database Schema

```sql
-- Users are managed by Supabase Auth (auth.users table)

-- User profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  plan TEXT NOT NULL DEFAULT 'free',  -- free | pro | enterprise
  credits INTEGER NOT NULL DEFAULT 100,  -- initial free credits
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Subscription plans definition
CREATE TABLE public.plans (
  id TEXT PRIMARY KEY,           -- free, pro, enterprise
  name TEXT NOT NULL,
  price_monthly_usd NUMERIC,
  price_monthly_cny NUMERIC,
  monthly_credits INTEGER NOT NULL,
  max_projects INTEGER,          -- NULL = unlimited
  max_storage_mb INTEGER NOT NULL,
  features JSONB NOT NULL DEFAULT '{}',
  stripe_price_id TEXT,          -- Stripe price ID
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- Credit transactions (audit trail)
CREATE TABLE public.credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,       -- positive = add, negative = consume
  reason TEXT NOT NULL,          -- 'monthly_grant', 'image_gen', 'video_gen', 'topup', 'refund'
  reference_id TEXT,             -- job ID, payment ID, etc.
  balance_after INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Projects (migrated from SQLite)
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  node_count INTEGER NOT NULL DEFAULT 0,
  nodes_json JSONB NOT NULL DEFAULT '[]',
  edges_json JSONB NOT NULL DEFAULT '[]',
  viewport_json JSONB NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}',
  history_json JSONB NOT NULL DEFAULT '{"past":[],"future":[]}',
  thumbnail_url TEXT,            -- project preview for dashboard
  is_public BOOLEAN NOT NULL DEFAULT false,  -- for future community sharing
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_projects_user_updated ON projects(user_id, updated_at DESC);

-- AI generation jobs (multi-user)
CREATE TABLE public.ai_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,         -- 'image' | 'video'
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | running | succeeded | failed
  external_job_id TEXT,
  request_params JSONB,
  result_url TEXT,
  error_message TEXT,
  credits_consumed INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_jobs_user_status ON ai_jobs(user_id, status);

-- Payment transactions
CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,         -- 'stripe' | 'alipay' | 'wechat'
  type TEXT NOT NULL,             -- 'subscription' | 'credit_topup'
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,         -- 'usd' | 'cny'
  status TEXT NOT NULL DEFAULT 'pending',
  external_id TEXT,               -- Stripe payment intent ID, etc.
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS policies
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users CRUD own projects" ON public.projects FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users read own jobs" ON public.ai_jobs FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users read own credits" ON public.credit_transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users read own payments" ON public.payments FOR SELECT USING (auth.uid() = user_id);

-- Trigger: auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

### 1.3 Authentication

- **Supabase Auth** with email/password + Google + GitHub OAuth
- **Middleware** (`middleware.ts`): Protect `/dashboard/*`, `/canvas/*`, `/settings/*`, `/billing/*` routes
- **Server-side**: Use `@supabase/ssr` `createServerClient` in API routes
- **Client-side**: Use `@supabase/ssr` `createBrowserClient` in components

### 1.4 Verification
- [ ] `npm run build` succeeds
- [ ] User can sign up, login, logout
- [ ] Profile auto-created on signup
- [ ] RLS blocks cross-user data access
- [ ] Protected routes redirect to login

---

## Phase 2: Project CRUD + Canvas Migration

### 2.1 Project Store Rewrite

Replace `src/stores/projectStore.ts` Tauri commands with Supabase client calls:

| Current (Tauri) | New (Supabase) |
|---|---|
| `invoke('list_project_summaries')` | `supabase.from('projects').select('id,name,node_count,updated_at,thumbnail_url').order('updated_at', {ascending:false})` |
| `invoke('get_project_record', {projectId})` | `supabase.from('projects').select('*').eq('id', projectId).single()` |
| `invoke('upsert_project_record', {record})` | `supabase.from('projects').upsert(record)` |
| `invoke('update_project_viewport_record', ...)` | `supabase.from('projects').update({viewport_json}).eq('id', projectId)` |
| `invoke('rename_project_record', ...)` | `supabase.from('projects').update({name}).eq('id', projectId)` |
| `invoke('delete_project_record', {projectId})` | `supabase.from('projects').delete().eq('id', projectId)` |

**Image handling change**: Replace `imagePool + __img_ref__` dedup with Supabase Storage URLs:
- Images uploaded to `supabase.storage.from('project-images').upload(path, file)`
- Nodes store public URLs instead of base64/file paths
- No more `convertFileSrc()` needed — images served via Supabase Storage CDN

**Persistence strategy**: Keep debounced save pattern but call Supabase instead of Tauri. For viewport, use same independent debounced update.

### 2.2 Canvas Migration

`Canvas.tsx` and all `nodes/*.tsx` are React components that run client-side. Steps:

1. **Copy** entire `src/features/canvas/` directory
2. **Remove** Tauri-specific imports from node components:
   - `StoryboardNode.tsx`: Replace `@tauri-apps/plugin-dialog` open() → browser `<input type="file">`; replace `revealItemInDir()` → download link
   - `VideoGenNode.tsx` / `VideoResultNode.tsx`: Replace `@tauri-apps/api/path` → URL-based paths
   - `TextAnnotationNode.tsx`: Replace `openUrl()` → `window.open()`
3. **Replace** infrastructure implementations:
   - `tauriAiGateway.ts` → `webAiGateway.ts` (calls `/api/ai/*` routes)
   - `tauriVideoGateway.ts` → `webVideoGateway.ts` (calls `/api/video/*` routes)
   - `tauriImageSplitGateway.ts` → `webImageSplitGateway.ts` (calls `/api/image/split`)
4. **Replace** `imageData.ts`:
   - `prepareNodeImage()`: Upload to Supabase Storage, get public URL + generate preview client-side
   - `resolveImageDisplayUrl()`: Return URL directly (no `convertFileSrc`)
   - `persistImageLocally()`: Upload to Supabase Storage
5. **Mark Canvas page** as `'use client'` — the entire canvas workspace is a client component

### 2.3 Eliminate Desktop-Only Commands

| Command | Action |
|---|---|
| `frontend_ready` | Eliminate (no window lifecycle) |
| `get_runtime_system_info` | Replace with `navigator.userAgent` |
| `check_latest_release_tag` | Eliminate (web auto-updates) |
| `copy_image_source_to_clipboard` | Browser `navigator.clipboard.write()` |
| `reveal_in_file_explorer` | Eliminate (use download instead) |
| `save_image_source_to_*` (4 cmds) | Browser download via `<a download>` |
| `load_image` (from file path) | Browser `<input type="file">` |

### 2.4 Verification
- [ ] Dashboard shows project list for logged-in user
- [ ] Create, rename, delete project works
- [ ] Canvas loads with all 9 node types rendering
- [ ] Node drag, connect, undo/redo functional
- [ ] Image upload via browser file picker works
- [ ] Images stored in Supabase Storage and display correctly
- [ ] Project auto-saves to Supabase (debounced)

---

## Phase 3: AI Generation (Server-Proxied)

### 3.1 Server-Side AI Provider Architecture

Port the Rust provider traits to TypeScript in `src/server/ai/`:

```typescript
// src/server/ai/types.ts
interface AIProvider {
  name: string;
  supportsModel(model: string): boolean;
  listModels(): string[];
  generate(apiKey: string, request: GenerateRequest): Promise<string>;
  submitJob(apiKey: string, request: GenerateRequest): Promise<string>;
  pollJob(apiKey: string, jobId: string): Promise<JobStatus>;
}

interface VideoProvider {
  name: string;
  supportsModel(model: string): boolean;
  generate(apiKey: string, request: VideoGenerateRequest): Promise<string>;
  getStatus(apiKey: string, jobId: string): Promise<VideoJobStatus>;
}
```

Port these Rust providers to TypeScript (HTTP logic is straightforward):
- **Image**: PPIO, GRSAI, KIE, FAL — each provider is ~100-200 lines of HTTP calls
- **Video**: Kling, Sora2, Veo + shared KIE common (upload, polling)

### 3.2 API Routes

```
app/api/ai/
├── generate-image/route.ts     POST — sync image generation
├── submit-job/route.ts         POST — async job submission
├── poll-job/[jobId]/route.ts   GET  — poll job status
└── models/route.ts             GET  — list available models

app/api/video/
├── generate/route.ts           POST — submit video generation
├── poll/[jobId]/route.ts       GET  — poll video job
└── cache/route.ts              POST — cache video to storage
```

Each route:
1. Validates auth (Supabase session)
2. Checks user credits (deduct before generation)
3. Retrieves API key from user's encrypted settings or platform keys
4. Calls server-side provider
5. Records job in `ai_jobs` table
6. Returns result

### 3.3 API Key Security

**Critical change**: API keys must NEVER be sent to the browser.

Two models:
1. **Platform keys** (default): The platform provides API keys, users pay via credits. Keys stored as environment variables on Vercel.
2. **BYOK (Bring Your Own Key)**: Pro users can optionally provide their own keys. Stored encrypted in Supabase (new `user_api_keys` table with pgcrypto encryption).

### 3.4 Credit Deduction Flow

```
User clicks Generate → webAiGateway.generateImage()
  → POST /api/ai/generate-image
    → Check credits (SELECT credits FROM profiles WHERE id = user_id)
    → Deduct credits (INSERT credit_transaction, UPDATE profiles SET credits = credits - cost)
    → Call provider
    → On success: return image URL
    → On failure: refund credits
```

### 3.5 Image Processing API Routes

```
app/api/image/
├── split/route.ts              POST — split image into grid (sharp)
├── crop/route.ts               POST — crop image (sharp)
├── merge/route.ts              POST — merge storyboard (sharp)
├── upload/route.ts             POST — upload image to Supabase Storage
└── metadata/route.ts           POST — read/write PNG metadata (sharp)
```

Use `sharp` npm package for server-side image processing (equivalent to Rust `image` crate).

**Hybrid strategy**: Simple operations (crop, basic resize) can also use browser Canvas API as fallback. Complex operations (grid split with precise pixel handling, metadata embedding) go through server.

### 3.6 Web Infrastructure Implementations

```typescript
// src/features/canvas/infrastructure/webAiGateway.ts
export class WebAiGateway implements AiGateway {
  async setApiKey(provider: string, apiKey: string): Promise<void> {
    // Store in user settings via API, or skip if using platform keys
    await fetch('/api/settings/api-keys', { method: 'PUT', body: JSON.stringify({ provider, apiKey }) });
  }
  async generateImage(payload: GenerateImagePayload): Promise<string> {
    const res = await fetch('/api/ai/generate-image', { method: 'POST', body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(await res.text());
    return res.json().then(d => d.imageUrl);
  }
  async submitGenerateImageJob(payload: GenerateImagePayload): Promise<string> {
    const res = await fetch('/api/ai/submit-job', { method: 'POST', body: JSON.stringify(payload) });
    return res.json().then(d => d.jobId);
  }
  async getGenerateImageJob(jobId: string) {
    const res = await fetch(`/api/ai/poll-job/${jobId}`);
    return res.json();
  }
}
```

Same pattern for `WebVideoGateway` and `WebImageSplitGateway`.

### 3.7 Verification
- [ ] Image generation works through web API proxy
- [ ] Async job submission + polling works
- [ ] Video generation submits and polls correctly
- [ ] Credits deducted on generation, refunded on failure
- [ ] API keys never exposed to browser (check Network tab)
- [ ] Image split/crop/merge work via sharp API routes
- [ ] All provider types tested (at least one image + one video)

---

## Phase 4: Payment + Subscription System

### 4.1 Plan Definitions

| Plan | Monthly (USD) | Monthly (CNY) | Credits/mo | Max Projects | Storage |
|------|--------------|---------------|------------|--------------|---------|
| Free | $0 | ¥0 | 100 | 5 | 500 MB |
| Pro | $19 | ¥128 | 2,000 | Unlimited | 10 GB |
| Enterprise | $49 | ¥328 | 10,000 | Unlimited | 50 GB |

Credit costs (approximate):
- Image generation: 1-5 credits (varies by model/resolution)
- Video generation: 10-50 credits (varies by duration/model)

### 4.2 Stripe Integration

```
app/api/webhooks/stripe/route.ts     — Stripe webhook handler
app/api/payments/
├── create-checkout/route.ts         — Create Stripe Checkout Session
├── create-portal/route.ts           — Stripe Customer Portal (manage subscription)
├── topup/route.ts                   — Credit top-up payment
└── status/route.ts                  — Check payment status
```

Packages: `stripe` (server SDK)

Webhook events to handle:
- `checkout.session.completed` → activate subscription, grant credits
- `invoice.paid` → monthly credit refresh
- `customer.subscription.updated` → plan change
- `customer.subscription.deleted` → downgrade to free

### 4.3 Chinese Payment (Stubs)

```typescript
// src/server/payments/alipay.ts — STUB
export async function createAlipayOrder(params: PaymentParams): Promise<{ payUrl: string }> {
  // TODO: Integrate with Alipay SDK when ready
  throw new Error('Alipay integration not yet implemented');
}

// src/server/payments/wechat.ts — STUB
export async function createWechatOrder(params: PaymentParams): Promise<{ qrCodeUrl: string }> {
  // TODO: Integrate with WeChat Pay SDK when ready
  throw new Error('WeChat Pay integration not yet implemented');
}
```

### 4.4 Billing Page (`/billing`)

- Current plan display
- Credit balance + usage history
- Upgrade/downgrade buttons (→ Stripe Checkout)
- Credit top-up option
- Payment history

### 4.5 Verification
- [ ] Stripe Checkout creates subscription correctly (test mode)
- [ ] Webhook updates user plan and grants credits
- [ ] Credit top-up works
- [ ] Billing page shows correct plan, credits, history
- [ ] Free tier limits enforced (project count, storage)
- [ ] Chinese payment stubs return clear "not yet available" message

---

## Phase 5: Landing Page + Settings + Polish

### 5.1 Landing Page (`/`)

Modern SaaS landing page (SSG for SEO):
- **Hero**: Tagline + product screenshot/video + CTA buttons
- **Features**: Grid showcasing AI image gen, video gen, storyboard tools, node canvas
- **How it works**: 3-step visual guide
- **Pricing**: Plan comparison table
- **Testimonials**: Social proof section (placeholder)
- **Footer**: Links, social, legal

Reference: tapnow.ai layout style + liblib.tv feature showcase style.

### 5.2 Settings Page (`/settings`)

Migrate from `SettingsDialog.tsx` modal to full page:
- **Profile**: Display name, avatar, email
- **API Keys**: BYOK configuration (Pro+ only)
- **Preferences**: Theme (dark/light), language (zh/en), canvas edge routing, UI customization
- **Account**: Delete account, export data

### 5.3 Responsive Design

- Landing/pricing: Fully responsive
- Dashboard: Responsive grid
- Canvas: Desktop-optimized (min 1024px width), show "use desktop browser" on mobile
- Settings/billing: Responsive

### 5.4 Remove Desktop Artifacts

- Delete `src-tauri/` directory entirely
- Delete `src/components/TitleBar.tsx` (custom window titlebar)
- Delete `src/components/UpdateAvailableDialog.tsx` (desktop update)
- Remove all `@tauri-apps/*` dependencies from `package.json`
- Remove Tauri-related Vite config

### 5.5 Verification
- [ ] Landing page renders correctly, Lighthouse score > 90
- [ ] SEO meta tags present (title, description, OG tags)
- [ ] Settings page saves preferences correctly
- [ ] Theme switching works
- [ ] Language switching works
- [ ] No Tauri references remain in codebase
- [ ] Full build succeeds with zero TS errors

---

## Phase 6: Community + Future Features (Placeholder)

### 6.1 Community Schema (Already in DB)

The `projects.is_public` flag enables future sharing. Additional tables for later:

```sql
-- Future: Community sharing
CREATE TABLE public.shared_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  tags TEXT[],
  likes_count INTEGER DEFAULT 0,
  views_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Future: Comments
CREATE TABLE public.comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shared_project_id UUID REFERENCES shared_projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 6.2 Future Features
- Project forking/templating
- Real-time collaboration (Supabase Realtime)
- Public gallery with search
- User following/notifications

---

## Tauri Command → Web API Migration Map (Complete)

| # | Tauri Command | Web Replacement | Location |
|---|---|---|---|
| 1 | `frontend_ready` | Eliminate | — |
| 2 | `set_api_key` | `POST /api/settings/api-keys` | API route |
| 3 | `generate_image` | `POST /api/ai/generate-image` | API route |
| 4 | `submit_generate_image_job` | `POST /api/ai/submit-job` | API route |
| 5 | `get_generate_image_job` | `GET /api/ai/poll-job/[id]` | API route |
| 6 | `list_models` | `GET /api/ai/models` | API route |
| 7 | `split_image` | `POST /api/image/split` | API route (sharp) |
| 8 | `split_image_source` | `POST /api/image/split` | API route (sharp) |
| 9 | `prepare_node_image_source` | Client upload to Supabase Storage | Client-side |
| 10 | `prepare_node_image_binary` | Client upload to Supabase Storage | Client-side |
| 11 | `crop_image_source` | Browser Canvas API + optional `POST /api/image/crop` | Hybrid |
| 12 | `merge_storyboard_images` | `POST /api/image/merge` | API route (sharp) |
| 13 | `read_storyboard_image_metadata` | `POST /api/image/metadata` | API route (sharp/png) |
| 14 | `embed_storyboard_image_metadata` | `POST /api/image/metadata` | API route (sharp/png) |
| 15 | `load_image` | Browser `<input type="file">` | Client-side |
| 16 | `persist_image_source` | Upload to Supabase Storage | Client-side |
| 17 | `persist_image_binary` | Upload to Supabase Storage | Client-side |
| 18 | `save_image_source_to_downloads` | Browser `<a download>` | Client-side |
| 19 | `save_image_source_to_path` | Browser download | Client-side |
| 20 | `save_image_source_to_directory` | Browser download | Client-side |
| 21 | `save_image_source_to_app_debug_dir` | Eliminate (use server logs) | — |
| 22 | `copy_image_source_to_clipboard` | `navigator.clipboard.write()` | Client-side |
| 23 | `set_video_api_key` | `POST /api/settings/api-keys` | API route |
| 24 | `generate_video` | `POST /api/video/generate` | API route |
| 25 | `poll_video_job_status` | `GET /api/video/poll/[id]` | API route |
| 26 | `cache_video` | Store in Supabase Storage | API route |
| 27 | `get_cached_video_path` | Supabase Storage URL | Client-side |
| 28 | `get_video_cache_stats` | `GET /api/video/cache-stats` | API route |
| 29 | `clear_video_cache` | `DELETE /api/video/cache` | API route |
| 30 | `list_video_models` | `GET /api/video/models` | API route |
| 31 | `copy_file_to_path` | Browser download | Client-side |
| 32 | `reveal_in_file_explorer` | Eliminate | — |
| 33 | `cleanup_old_videos` | Server cron / Supabase Edge Function | Server-side |
| 34 | `list_project_summaries` | Supabase query | Client-side |
| 35 | `get_project_record` | Supabase query | Client-side |
| 36 | `upsert_project_record` | Supabase upsert | Client-side |
| 37 | `update_project_viewport_record` | Supabase update | Client-side |
| 38 | `rename_project_record` | Supabase update | Client-side |
| 39 | `delete_project_record` | Supabase delete | Client-side |
| 40 | `get_runtime_system_info` | `navigator.userAgent` | Client-side |
| 41 | `check_latest_release_tag` | Eliminate | — |

**Summary**: 17 → API routes, 12 → Client-side, 5 → Eliminate, 3 → Hybrid, 1 → Server cron

---

## Key Reusable Code (Copy As-Is)

These files/directories require zero or minimal changes:

| Path | Lines | Notes |
|---|---|---|
| `src/features/canvas/domain/` | ~800 | All types, registry, display — pure TypeScript |
| `src/features/canvas/application/ports.ts` | 135 | Interface definitions — the migration seam |
| `src/features/canvas/application/eventBus.ts` | ~50 | Pure pub/sub |
| `src/features/canvas/application/toolProcessor.ts` | ~300 | Browser Canvas fallbacks already exist |
| `src/features/canvas/models/` | ~1500 | All model definitions, registries |
| `src/features/canvas/tools/` | ~500 | Tool types, built-in tools, annotation |
| `src/features/canvas/nodes/` | ~3000 | Minor edits to remove Tauri imports |
| `src/features/canvas/ui/` | ~2000 | All UI components |
| `src/features/canvas/edges/` | ~200 | Edge components |
| `src/components/ui/primitives.tsx` | 511 | Custom UI library |
| `src/stores/canvasStore.ts` | ~1000 | Core canvas state (no Tauri deps) |
| `src/i18n/` | ~1500 | All i18n config + locale files |

**Estimated reuse**: ~70% of frontend code copies directly.

---

## Files to Create New

| File | Purpose |
|---|---|
| `src/lib/supabase/client.ts` | Browser Supabase client |
| `src/lib/supabase/server.ts` | Server Supabase client |
| `src/lib/supabase/middleware.ts` | Auth middleware helper |
| `middleware.ts` | Next.js route protection |
| `src/features/canvas/infrastructure/webAiGateway.ts` | Replace tauriAiGateway |
| `src/features/canvas/infrastructure/webVideoGateway.ts` | Replace tauriVideoGateway |
| `src/features/canvas/infrastructure/webImageSplitGateway.ts` | Replace tauriImageSplitGateway |
| `src/features/canvas/application/imageData.web.ts` | Replace Tauri image handling |
| `src/stores/projectStore.web.ts` | Rewrite for Supabase |
| `src/stores/authStore.ts` | NEW: Auth state |
| `src/server/ai/providers/*.ts` | Port Rust AI providers |
| `src/server/video/providers/*.ts` | Port Rust video providers |
| `src/server/image/processor.ts` | sharp-based image processing |
| `src/server/payments/stripe.ts` | Stripe integration |
| `src/server/payments/alipay.ts` | Alipay stub |
| `src/server/payments/wechat.ts` | WeChat Pay stub |
| `app/api/**/*.ts` | ~15 API route files |
| `app/(marketing)/page.tsx` | Landing page |
| `app/(app)/billing/page.tsx` | Billing page |
| `supabase/migrations/*.sql` | Database migrations |

---

## Verification Plan (End-to-End)

After all phases:

1. **Auth flow**: Sign up → verify email → login → see dashboard → logout → can't access canvas
2. **Project flow**: Create project → canvas loads → add nodes → connect → undo/redo → rename → delete
3. **Image gen**: Upload image → create ImageEdit node → connect → enter prompt → generate → result appears
4. **Video gen**: Create VideoGen node → configure → generate → poll status → VideoResult node created
5. **Tools**: Open crop/annotate/split tools on upload node → process → new node created
6. **Persistence**: Make changes → refresh page → all changes preserved
7. **Credits**: Generate with free tier → credits decrease → hit limit → generation blocked
8. **Payment**: Upgrade to Pro via Stripe (test mode) → credits refreshed → limits lifted
9. **Settings**: Change theme/language → persists across sessions
10. **Landing**: Visit root → see marketing page → pricing → sign up CTA works
11. **Security**: Try accessing other user's project via URL → 404/403
12. **Performance**: Canvas with 20+ nodes remains smooth (no regression from desktop)
