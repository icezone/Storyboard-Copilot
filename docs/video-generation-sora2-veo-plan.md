# Updated Implementation Plan: Add Sora2 and Veo 3.1 Video Providers

## Changes from Original Plan

1. **Sora2 Simplification**: Use standard `duration` field (10s, 15s) instead of custom `n_frames` in extra_params. Backend maps seconds to frames (1:1 ratio).
2. **Parallel Execution**: Phase 2 (Sora2) and Phase 3 (Veo) will be implemented by 2 independent subagents.

## Architecture Overview

All three providers (Kling, Sora2, Veo) share the same KIE API infrastructure:
- Same API key (stored under "kie" provider)
- Same image upload endpoint
- Same polling mechanism (with potential endpoint variation for Veo)

## Phase 1: Shared KIE Infrastructure (Main Agent)

**Duration: 2-3 hours**

### 1.1 Create `kie_common` Module

**File: `src-tauri/src/ai/video/providers/kie_common/mod.rs`**

```rust
// Shared KIE API client for Kling, Sora2, Veo providers
use reqwest::Client;
use std::sync::Arc;
use tokio::sync::RwLock;

pub const KIE_BASE_URL: &str = "https://api.kie.ai";
pub const FILE_BASE_URL: &str = "https://kieai.redpandaai.co";
pub const FILE_UPLOAD_PATH: &str = "/api/file-stream-upload";
pub const UPLOAD_PATH: &str = "images/storyboard-copilot";
pub const CREATE_TASK_PATH: &str = "/api/v1/jobs/createTask";
pub const QUERY_TASK_PATH: &str = "/api/v1/jobs/recordInfo";

pub struct KieApiClient {
    client: Client,
    api_key: Arc<RwLock<Option<String>>>,
}

impl KieApiClient {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            api_key: Arc::new(RwLock::new(None)),
        }
    }

    pub fn client(&self) -> &Client {
        &self.client
    }

    pub async fn get_api_key(&self) -> Option<String> {
        self.api_key.read().await.clone()
    }

    pub async fn set_api_key(&self, key: String) {
        let mut api_key = self.api_key.write().await;
        *api_key = Some(key);
    }
}
```

### 1.2 Extract Image Upload Logic

**File: `src-tauri/src/ai/video/providers/kie_common/upload.rs`**

Extract from `KlingProvider::upload_image_file()`:
- `source_to_bytes()` - Handle file://, http://, data: URLs, base64
- `is_http_url()` - Check if URL is already HTTP
- `extract_uploaded_file_url()` - Parse upload response
- `decode_file_url_path()` - Windows path normalization
- `upload_image_file()` - Main upload function

Key signature:
```rust
pub async fn upload_image_file(
    client: &KieApiClient,
    source: &str,
    file_name: &str,
) -> Result<String, VideoError>
```

### 1.3 Extract Polling Logic

**File: `src-tauri/src/ai/video/providers/kie_common/polling.rs`**

```rust
pub async fn poll_kie_job_status(
    client: &KieApiClient,
    job_id: &str,
) -> Result<VideoJobStatus, VideoError>

fn map_kie_status_to_state(status: &str) -> VideoJobState {
    match status.to_lowercase().as_str() {
        "waiting" | "queuing" => VideoJobState::Pending,
        "generating" => VideoJobState::Processing,
        "success" => VideoJobState::Completed,
        "fail" => VideoJobState::Failed,
        _ => VideoJobState::Processing,
    }
}
```

### 1.4 Refactor Kling Provider

**File: `src-tauri/src/ai/video/providers/kling/mod.rs`**

Changes:
- Replace `Client + api_key` with `KieApiClient`
- Use `kie_common::upload::upload_image_file()`
- Use `kie_common::polling::poll_kie_job_status()`
- Keep Kling-specific request building logic

**Verification**: Run existing Kling tests to ensure no regressions.

---

## Phase 2: Sora2 Provider (Subagent 1)

**Duration: 2-3 hours**

### Task for Subagent

Implement Sora2 video provider using the shared KIE infrastructure created in Phase 1.

### 2.1 Backend Implementation

**File: `src-tauri/src/ai/video/providers/sora2/mod.rs`**

**Key Differences from Kling:**
- Models: `sora-2-image-to-video`, `sora-2-pro-image-to-video`
- Duration mapping: `duration` (seconds) → `n_frames` in API request
  - 10s → 10 frames
  - 15s → 15 frames
- Aspect ratio mapping:
  - `"9:16"` → `"portrait"`
  - `"16:9"` | `"1:1"` → `"landscape"`
- Request structure:
  ```rust
  struct Sora2CreateTaskInput {
      prompt: String,
      image_urls: Option<Vec<String>>,
      aspect_ratio: Option<String>,  // "portrait" or "landscape"
      n_frames: Option<u32>,          // 10 or 15
  }
  ```

**Implementation requirements:**
1. Use `KieApiClient` from `kie_common`
2. Use `kie_common::upload::upload_image_file()` for image uploads
3. Use `kie_common::polling::poll_kie_job_status()` for status checks
4. Endpoint: `/api/v1/jobs/createTask` (same as Kling)
5. Model normalization: Strip `sora2/` prefix if present
6. Map `duration` (seconds) to `n_frames` (1:1 ratio): 10s → 10, 15s → 15
7. Map aspect ratios: `9:16` → `portrait`, others → `landscape`

### 2.2 Frontend Models

**File: `src/features/canvas/models/providers/sora2.ts`**
```typescript
export const provider: ModelProviderDefinition = {
  id: 'sora2',
  name: 'Sora2',
  label: 'Sora 2 (OpenAI)',
};
```

**File: `src/features/canvas/models/video/sora2/sora2-standard.ts`**
```typescript
export const videoModel: VideoModelDefinition = {
  id: 'sora2/sora-2-image-to-video',
  mediaType: 'video',
  displayName: 'Sora 2 Standard',
  providerId: 'kie',  // Uses shared KIE API key
  description: 'OpenAI Sora 2 Standard model for image-to-video generation',
  eta: '~45s',
  expectedDurationMs: 45000,
  durations: [
    { value: 10, label: '10 seconds' },
    { value: 15, label: '15 seconds' },
  ],
  aspectRatios: [
    { value: '16:9', label: 'Landscape (16:9)' },
    { value: '9:16', label: 'Portrait (9:16)' },
  ],
  supportsAudio: false,
  supportsSeed: false,
  supportsImageToVideo: true,
  extraParamsSchema: [],
  defaultExtraParams: {},
};
```

**File: `src/features/canvas/models/video/sora2/sora2-pro.ts`**
- Same structure, but `id: 'sora2/sora-2-pro-image-to-video'`
- Higher `expectedDurationMs: 60000` (~60s)

### 2.3 Register Provider

**File: `src-tauri/src/ai/video/providers/mod.rs`**
```rust
pub mod sora2;
pub use sora2::Sora2Provider;

pub fn build_default_video_providers() -> Vec<Arc<dyn VideoProvider>> {
    vec![
        Arc::new(KlingProvider::new()),
        Arc::new(Sora2Provider::new()),
    ]
}
```

### 2.4 Verification

**Tests:**
1. Aspect ratio mapping: `16:9` → `landscape`, `9:16` → `portrait`
2. Duration to frames: 10 → 10, 15 → 15
3. Model normalization: `sora2/sora-2-image-to-video` → `sora-2-image-to-video`
4. Image upload for 1-2 frames

**Manual testing:**
1. Set KIE API key
2. Create VideoGenNode with Sora2 Standard
3. Upload 1 frame, set 10s duration, portrait
4. Generate → Should submit and return task_id

---

## Phase 3: Veo 3.1 Provider (Subagent 2)

**Duration: 2-3 hours**

### Task for Subagent

Implement Veo 3.1 video provider using the shared KIE infrastructure created in Phase 1.

### 3.1 Backend Implementation

**File: `src-tauri/src/ai/video/providers/veo/mod.rs`**

**Key Differences from Kling:**
- Models: `veo3`, `veo3_fast`
- Submission endpoint: `/api/v1/veo/generate` (DIFFERENT from Kling/Sora2)
- Polling endpoint: `/api/v1/jobs/recordInfo` (same)
- Fixed `generationType: "FIRST_AND_LAST_FRAMES_2_VIDEO"`
- Seed validation: Must be 10000-99999 (clamp with warning)
- Aspect ratio: Pass through `"16:9"`, `"9:16"`, or `"Auto"` directly
- Request structure:
  ```rust
  struct VeoGenerateRequest {
      model: String,
      prompt: String,
      #[serde(rename = "imageUrls")]
      image_urls: Option<Vec<String>>,
      #[serde(rename = "generationType")]
      generation_type: String,  // Fixed: "FIRST_AND_LAST_FRAMES_2_VIDEO"
      #[serde(rename = "aspectRatio")]
      aspect_ratio: Option<String>,
      seeds: Option<i64>,
  }
  ```

**Implementation requirements:**
1. Use `KieApiClient` from `kie_common`
2. Use `kie_common::upload::upload_image_file()` for image uploads
3. Use `kie_common::polling::poll_kie_job_status()` for status checks (verify endpoint)
4. Submission endpoint: `/api/v1/veo/generate` (different!)
5. Model normalization: Strip `veo/` prefix if present
6. Seed validation: Clamp to 10000-99999, log warning if clamped
7. Fixed `generationType: "FIRST_AND_LAST_FRAMES_2_VIDEO"`

**Seed validation function:**
```rust
fn validate_seed(seed: Option<i64>) -> Option<i64> {
    seed.map(|s| {
        if s < 10000 || s > 99999 {
            tracing::warn!(
                "Veo seed {} outside valid range [10000-99999], clamping",
                s
            );
            s.clamp(10000, 99999)
        } else {
            s
        }
    })
}
```

### 3.2 Frontend Models

**File: `src/features/canvas/models/providers/veo.ts`**
```typescript
export const provider: ModelProviderDefinition = {
  id: 'veo',
  name: 'Veo',
  label: 'Google Veo 3.1',
};
```

**File: `src/features/canvas/models/video/veo/veo3-quality.ts`**
```typescript
export const videoModel: VideoModelDefinition = {
  id: 'veo/veo3',
  mediaType: 'video',
  displayName: 'Veo 3.1 Quality',
  providerId: 'kie',
  description: 'Google Veo 3.1 high-quality video generation',
  eta: '~60s',
  expectedDurationMs: 60000,
  durations: [],  // No duration control - system determined
  aspectRatios: [
    { value: '16:9', label: '16:9' },
    { value: '9:16', label: '9:16' },
    { value: 'auto', label: 'Auto' },
  ],
  supportsAudio: false,
  supportsSeed: true,
  supportsImageToVideo: true,
  extraParamsSchema: [
    {
      key: 'seed_note',
      label: 'Seed Range',
      type: 'string',
      description: 'Seeds must be 10000-99999. Values outside will be clamped.',
    },
  ],
  defaultExtraParams: {},
};
```

**File: `src/features/canvas/models/video/veo/veo3-fast.ts`**
- Same structure, but `id: 'veo/veo3_fast'`
- Faster `expectedDurationMs: 30000` (~30s)

### 3.3 Register Provider

**File: `src-tauri/src/ai/video/providers/mod.rs`**
```rust
pub mod veo;
pub use veo::VeoProvider;

pub fn build_default_video_providers() -> Vec<Arc<dyn VideoProvider>> {
    vec![
        Arc::new(KlingProvider::new()),
        Arc::new(Sora2Provider::new()),
        Arc::new(VeoProvider::new()),
    ]
}
```

### 3.4 Verification

**Tests:**
1. Seed clamping: 999 → 10000, 150000 → 99999, 50000 → 50000
2. Model normalization: `veo/veo3` → `veo3`
3. Fixed `generationType` in request
4. Image upload for 1-2 frames

**Manual testing:**
1. Set KIE API key (shared with Kling/Sora2)
2. Create VideoGenNode with Veo Quality
3. Upload 2 frames, seed=45000, aspect ratio Auto
4. Generate → Should submit and return task_id
5. Poll status → Should complete successfully

---

## Phase 4: Final Integration & Documentation

**Duration: 1 hour**

### 4.1 Verification Commands

```bash
# TypeScript type checking
npx tsc --noEmit

# Rust fast check
cd src-tauri && cargo check
```

### 4.2 End-to-End Testing

Test all 5 models (Kling 3.0 + Sora2 Standard/Pro + Veo Quality/Fast):
1. Shared API key configuration works
2. Image upload works for all providers
3. Video generation submits successfully
4. Status polling returns video URLs
5. Error handling (invalid key, network timeout)

### 4.3 Documentation

Update `CLAUDE.md` section 8.1.2:
```markdown
**Sora2 (KIE API):**
- Models: sora-2-image-to-video, sora-2-pro-image-to-video
- Duration: 10s or 15s (maps to n_frames in API)
- Aspect ratios: portrait (9:16) or landscape (16:9, 1:1)
- Endpoint: /api/v1/jobs/createTask
- Shares KIE API key with Kling

**Veo 3.1 (KIE API):**
- Models: veo3, veo3_fast
- Fixed generationType: FIRST_AND_LAST_FRAMES_2_VIDEO
- Seed range: 10000-99999 (auto-clamped)
- Endpoint: /api/v1/veo/generate
- Shares KIE API key with Kling
```

---

## Parallel Execution Strategy

### Main Agent (Phase 1):
1. Create `kie_common/` module structure
2. Extract upload logic
3. Extract polling logic
4. Refactor Kling provider
5. Verify no regressions

### Subagent 1 (Phase 2 - Sora2):
**After Phase 1 completes**, launch with:
```
Implement Sora2 video provider for Storyboard-Copilot.

CONTEXT:
- Shared KIE infrastructure in src-tauri/src/ai/video/providers/kie_common/
- Use KieApiClient for HTTP client and API key management
- Use kie_common::upload::upload_image_file() for image uploads
- Use kie_common::polling::poll_kie_job_status() for status polling

REQUIREMENTS:
1. Create src-tauri/src/ai/video/providers/sora2/mod.rs
   - Models: sora-2-image-to-video, sora-2-pro-image-to-video
   - Endpoint: /api/v1/jobs/createTask
   - Map duration (seconds) to n_frames (1:1 ratio): 10→10, 15→15
   - Map aspect ratios: 9:16→"portrait", others→"landscape"
   - Upload 1-2 frames using shared upload logic

2. Create TypeScript models:
   - src/features/canvas/models/providers/sora2.ts
   - src/features/canvas/models/video/sora2/sora2-standard.ts
   - src/features/canvas/models/video/sora2/sora2-pro.ts
   - providerId: 'kie' (shared key)
   - durations: [10, 15] seconds only
   - aspectRatios: ['16:9', '9:16']

3. Register in src-tauri/src/ai/video/providers/mod.rs

4. Verify: cargo check, npx tsc --noEmit
```

### Subagent 2 (Phase 3 - Veo):
**After Phase 1 completes**, launch with:
```
Implement Veo 3.1 video provider for Storyboard-Copilot.

CONTEXT:
- Shared KIE infrastructure in src-tauri/src/ai/video/providers/kie_common/
- Use KieApiClient for HTTP client and API key management
- Use kie_common::upload::upload_image_file() for image uploads
- Use kie_common::polling::poll_kie_job_status() for status polling

REQUIREMENTS:
1. Create src-tauri/src/ai/video/providers/veo/mod.rs
   - Models: veo3, veo3_fast
   - Submission endpoint: /api/v1/veo/generate (DIFFERENT!)
   - Polling endpoint: /api/v1/jobs/recordInfo (same as Kling)
   - Fixed generationType: "FIRST_AND_LAST_FRAMES_2_VIDEO"
   - Seed validation: clamp to 10000-99999, log warning if clamped
   - Aspect ratios: pass through "16:9", "9:16", or "Auto" directly
   - Upload 1-2 frames using shared upload logic

2. Create TypeScript models:
   - src/features/canvas/models/providers/veo.ts
   - src/features/canvas/models/video/veo/veo3-quality.ts
   - src/features/canvas/models/video/veo/veo3-fast.ts
   - providerId: 'kie' (shared key)
   - durations: [] (no duration control)
   - aspectRatios: ['16:9', '9:16', 'auto']
   - supportsSeed: true

3. Register in src-tauri/src/ai/video/providers/mod.rs

4. Verify: cargo check, npx tsc --noEmit
```

---

## Success Criteria

- [ ] Shared `kie_common` module created and working
- [ ] Kling provider refactored with no regressions
- [ ] Sora2 models appear in UI model selector
- [ ] Sora2 duration (10s/15s) maps to n_frames correctly
- [ ] Sora2 aspect ratios map to portrait/landscape
- [ ] Veo models appear in UI model selector
- [ ] Veo seeds clamp to 10000-99999 range
- [ ] Veo "Auto" aspect ratio passes through
- [ ] Single KIE API key works for all 3 providers
- [ ] Image uploads work for all providers
- [ ] Status polling returns video URLs
- [ ] TypeScript type checking passes
- [ ] Rust cargo check passes

---

## Risk Mitigation

**Assumptions to verify:**
1. Veo polling endpoint is same as Kling (`/api/v1/jobs/recordInfo`)
   - Fallback: Implement custom polling in VeoProvider if different

2. Veo accepts same uploaded image URLs
   - Fallback: Add Veo-specific upload handling if needed

3. Sora2 duration-to-frames is 1:1 ratio (10s → 10 frames)
   - Verify with API docs during implementation
   - Fallback: Adjust mapping if different ratio needed

**Testing strategy:**
- Phase 1: Verify Kling still works after refactor
- Phase 2 & 3: Test each provider independently
- Phase 4: Test all 5 models together with shared API key
