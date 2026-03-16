# Video Generation Feature - Design Document

**Date**: 2026-03-12
**Feature**: Video Generation with AI Providers
**Status**: Design Approved
**Approach**: Parallel Video System (Approach B)

---

## 1. Overview

### 1.1 Purpose

Add video generation capabilities to Storyboard Copilot, allowing users to generate videos from text prompts and reference images using AI providers. The system mirrors the existing image generation architecture with a parallel, independent video infrastructure.

### 1.2 Goals

- **Primary**: Enable text-to-video and image-to-video generation
- **Provider Support**: Start with Kling 3.0, designed for easy addition of more providers (Runway, Pika, etc.)
- **User Control**: Configurable video specs (duration, aspect ratio, audio, seed)
- **Storage Management**: Separate video storage paths with automatic cache cleanup
- **Error Handling**: Smart error classification with appropriate retry logic
- **Performance**: Non-blocking generation with background polling

---

## 2. Architecture Overview

### 2.1 High-Level Structure

The video generation system is completely parallel to the image generation system, with no shared command paths:

```
Frontend Layer:
├── src/features/canvas/models/video/           (Video model definitions)
│   ├── kling/kling30.ts                        (Kling 3.0 model)
│   └── [future providers]/
├── src/features/canvas/models/videoRegistry.ts (Auto-discovery registry)
├── src/features/canvas/models/videoErrors.ts   (Error type system)
├── src/features/canvas/nodes/VideoGenNode.tsx  (Canvas node component)
├── src/features/canvas/application/
│   └── videoErrorHandler.ts                    (Error classification logic)
└── src/features/canvas/infrastructure/
    └── tauriVideoGateway.ts                    (Bridge to Tauri)

Settings Layer:
├── src/stores/settingsStore.ts                 (Extended with video paths)
└── src/components/SettingsDialog.tsx           (Video storage section)

Command Layer:
└── src/commands/video.ts                       (Tauri command wrappers)
    ├── generateVideo()
    ├── pollVideoJobStatus()
    ├── downloadVideoToDirectory()
    ├── cacheVideoLocally()
    └── generateVideoThumbnail()

Backend Layer (Rust):
├── src-tauri/src/commands/video.rs             (Command handlers)
├── src-tauri/src/ai/video/                     (Video module)
│   ├── mod.rs                                  (VideoProvider trait)
│   ├── error.rs                                (Error types)
│   ├── cache_manager.rs                        (Cache lifecycle management)
│   └── providers/
│       └── kling/                              (Kling implementation)
│           ├── mod.rs
│           └── types.rs
└── src-tauri/src/lib.rs                        (Register commands)
```

### 2.2 Design Principles

1. **Separation**: Video system completely parallel to image system
2. **Reuse**: Shares provider metadata, API keys, settings infrastructure
3. **Isolation**: Video jobs don't block canvas interaction (background polling)
4. **Type Safety**: Distinct TypeScript/Rust types throughout
5. **Extensibility**: New providers follow same pattern as Kling reference

### 2.3 Shared vs. Separate Components

**Shared**:
- Provider definitions (`models/providers/*.ts`)
- API key storage (`settingsStore.apiKeys`)
- Settings dialog provider tab

**Separate**:
- Model definitions (video has duration/seed, not aspect ratios for images)
- Registry functions (`listVideoModels()` vs. `listImageModels()`)
- Tauri commands (`generate_video` vs. `generate_image`)
- Node components (`VideoGenNode` vs. `ImageEditNode`)
- Download paths (`videoDownloadPresetPaths` vs. `downloadPresetPaths`)
- Cache management (separate video cache system)

---

## 3. Data Models & Types

### 3.1 TypeScript Type Definitions

**File**: `src/features/canvas/models/types.ts`

```typescript
// Video-specific model definition
interface VideoModelDefinition {
  id: string;                          // e.g., "kling/kling-3.0"
  mediaType: 'video';
  displayName: string;                 // "Kling 3.0"
  providerId: string;                  // "kling"
  description: string;
  eta: string;                         // "2-5min"
  expectedDurationMs?: number;         // 180000 (3 minutes average)

  // Video-specific parameters
  durationRange: {
    min: number;                       // 3 seconds
    max: number;                       // 15 seconds
    step: number;                      // 1 second
    default: number;                   // 5 seconds
  };
  supportedAspectRatios: AspectRatioOption[];
  supportsAudio: boolean;              // true for Kling
  supportsSeed: boolean;               // true for reproducibility

  // Advanced features (provider-specific)
  extraParamsSchema?: ExtraParamDefinition[];
  defaultExtraParams?: Record<string, unknown>;

  // Request resolver
  resolveRequest: (context: VideoRequestContext) => {
    requestModel: string;
    modeLabel: string;                 // "Text-to-Video" / "Image-to-Video"
  };
}

interface VideoRequestContext {
  hasStartFrame: boolean;
  hasEndFrame: boolean;
  prompt: string;
}

interface DurationOption {
  value: string;
  label: string;
  seconds: number;
}
```

**Video Generation Payload**:

```typescript
interface GenerateVideoPayload {
  model: string;                       // "kling/kling-3.0"
  prompt: string;
  duration: number;                    // 3-15
  aspectRatio: string;                 // "16:9"
  startFrameUrl?: string;              // Optional start frame
  endFrameUrl?: string;                // Optional end frame
  enableAudio: boolean;
  seed?: number;                       // Optional seed
  extraParams?: Record<string, unknown>; // Provider-specific (multi_shots, kling_elements)
}

interface VideoGenerationResult {
  jobId: string;                       // For polling
  status: 'pending' | 'processing' | 'completed' | 'failed';
  videoUrl?: string;                   // When completed
  progress?: number;                   // 0-100
  errorType?: VideoErrorType;
  errorMessage?: string;
  estimatedCompletionMs?: number;
}
```

**Canvas Node Data**:

```typescript
interface VideoGenNodeData {
  id: string;
  type: 'videoGen';

  // Generic configuration (all providers)
  selectedModel: string;               // "kling/kling-3.0"
  prompt: string;
  duration: number;                    // 3-15
  aspectRatio: string;                 // "16:9"
  enableAudio: boolean;
  seed?: number;

  // Provider-specific parameters
  extraParams?: Record<string, unknown>; // Contains multi_shots, kling_elements, etc.

  // State
  jobId?: string;
  status: 'idle' | 'generating' | 'completed' | 'error';
  progress?: number;
  videoUrl?: string;                   // Cached local file:// URL
  remoteVideoUrl?: string;             // Original API URL (fallback if cache invalid)
  thumbnailUrl?: string;               // First frame preview

  // Error handling
  errorType?: VideoErrorType;
  errorMessage?: string;
  suggestedAction?: string;
  retryCount: number;
  lastAttemptTimestamp?: number;

  // Connected inputs
  startFrameNodeId?: string;
  endFrameNodeId?: string;
}
```

### 3.2 Rust Type Definitions

**File**: `src-tauri/src/ai/video/mod.rs`

```rust
pub struct VideoGenerateRequest {
    pub prompt: String,
    pub model: String,
    pub duration: u32,                  // 3-15 seconds
    pub aspect_ratio: String,
    pub start_frame_url: Option<String>,
    pub end_frame_url: Option<String>,
    pub enable_audio: bool,
    pub seed: Option<i64>,
    pub extra_params: Option<HashMap<String, serde_json::Value>>,
}

pub struct VideoJobStatus {
    pub job_id: String,
    pub status: VideoJobState,
    pub video_url: Option<String>,
    pub progress: Option<f32>,           // 0.0-100.0
    pub error_type: Option<String>,
    pub error_message: Option<String>,
}

pub enum VideoJobState {
    Pending,
    Processing,
    Completed,
    Failed,
}

#[async_trait::async_trait]
pub trait VideoProvider: Send + Sync {
    fn name(&self) -> &str;
    fn supports_model(&self, model: &str) -> bool;
    fn list_models(&self) -> Vec<String> {
        Vec::new()  // Default implementation
    }
    async fn set_api_key(&self, api_key: String) -> Result<(), VideoError>;
    async fn generate(&self, request: VideoGenerateRequest) -> Result<String, VideoError>;
    async fn get_status(&self, job_id: &str) -> Result<VideoJobStatus, VideoError>;
}
```

---

## 4. Component Architecture

### 4.1 VideoGenNode Component

**File**: `src/features/canvas/nodes/VideoGenNode.tsx`

**Layout Structure**:
```
┌─────────────────────────────────────┐
│ VideoGenNode                        │
├─────────────────────────────────────┤
│ ┌─ Input Section ─────────────────┐ │
│ │ • Model Selector (dropdown)     │ │
│ │ • Duration Slider (3-15s)       │ │
│ │ • Aspect Ratio Selector         │ │
│ │ • Audio Toggle (if supported)   │ │
│ │ • Seed Input (if supported)     │ │
│ │ • Prompt Textarea               │ │
│ │ • Extra Params (from schema)    │ │
│ │ • [Generate Video] Button       │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ┌─ Output Section ────────────────┐ │
│ │ • Status/Progress Bar           │ │
│ │ • Embedded HTML5 Video Player   │ │
│ │   - Play/Pause/Scrub controls   │ │
│ │   - Volume control              │ │
│ │   - Fullscreen option           │ │
│ │ • [Download] Dropdown Button    │ │
│ │   - Preset paths                │ │
│ │   - Choose location...          │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ◄── Start Frame    End Frame ──►    │
│  (input handles: left & right)      │
└─────────────────────────────────────┘
```

**Node Handles Configuration** (in `nodeRegistry.ts`):

```typescript
connectivity: {
  sourceHandle: false,                  // Video node doesn't output
  targetHandle: {
    'start-frame': {
      type: 'image',
      label: 'Start Frame',
      position: Position.Left,
    },
    'end-frame': {
      type: 'image',
      label: 'End Frame',
      position: Position.Right,
    }
  },
  connectMenu: {
    fromSource: false,
    fromTarget: false,                  // Created from node menu only
  }
}
```

**Key Behaviors**:
- Dynamic UI: Shows/hides controls based on `extraParamsSchema`
- Background Polling: Every 3 seconds during generation
- Auto-cache: Downloads video to local cache when completed
- Thumbnail: Generates first-frame preview
- Error Display: Color-coded, actionable error messages

### 4.2 Video Model Registry

**File**: `src/features/canvas/models/videoRegistry.ts`

Uses Vite's `import.meta.glob()` for auto-discovery:

```typescript
const videoModuleFiles = import.meta.glob<{ videoModel: VideoModelDefinition }>(
  './video/**/*.ts',
  { eager: true }
);

const videoModels: VideoModelDefinition[] = [];
for (const [path, module] of Object.entries(videoModuleFiles)) {
  if (module.videoModel) {
    videoModels.push(module.videoModel);
  }
}

export function listVideoModels(): VideoModelDefinition[] {
  return [...videoModels];
}

export function getVideoModel(modelId: string): VideoModelDefinition | undefined {
  return videoModels.find(m => m.id === modelId);
}

export const DEFAULT_VIDEO_MODEL_ID = 'kling/kling-3.0';
```

### 4.3 Kling 3.0 Model Definition

**File**: `src/features/canvas/models/video/kling/kling30.ts`

```typescript
export const videoModel: VideoModelDefinition = {
  id: 'kling/kling-3.0',
  mediaType: 'video',
  displayName: 'Kling 3.0',
  providerId: 'kling',
  description: 'Advanced video generation with audio support',
  eta: '2-5min',
  expectedDurationMs: 180000,

  durationRange: {
    min: 3,
    max: 15,
    step: 1,
    default: 5,
  },

  supportedAspectRatios: [
    { value: '16:9', label: '16:9 (Landscape)' },
    { value: '9:16', label: '9:16 (Portrait)' },
    { value: '1:1', label: '1:1 (Square)' },
  ],

  supportsAudio: true,
  supportsSeed: true,

  extraParamsSchema: [
    {
      key: 'mode',
      label: 'Generation Mode',
      type: 'enum',
      defaultValue: 'pro',
      options: [
        { value: 'pro', label: 'Pro (Higher Quality)' },
        { value: 'standard', label: 'Standard (Faster)' },
      ],
    },
    {
      key: 'multi_shots',
      label: 'Multi-Shot Mode',
      type: 'boolean',
      defaultValue: false,
      description: 'Enable to generate multiple shots in sequence',
    },
    {
      key: 'kling_elements',
      label: 'Kling Elements',
      type: 'custom',
      defaultValue: [],
      description: 'Define elements that can be referenced in prompts using @element_name',
    },
  ],

  defaultExtraParams: {
    mode: 'pro',
    multi_shots: false,
    kling_elements: [],
  },

  resolveRequest: ({ hasStartFrame, hasEndFrame }) => ({
    requestModel: 'kling-3.0/video',
    modeLabel: hasStartFrame || hasEndFrame ? 'Image-to-Video' : 'Text-to-Video',
  }),
};
```

**Design Note**: The `mode` parameter (pro/standard) is kept as an extraParam rather than creating separate models (`kling/kling-3.0-pro` and `kling/kling-3.0-standard`) to allow runtime switching without changing the selected model. This matches Kling's API design where mode is a request parameter, not a model variant.

---

## 5. Data Flow

### 5.1 Video Generation Flow

```
1. User configures VideoGenNode
   ↓
2. Click "Generate Video"
   ↓
3. Validate inputs (prompt, duration, etc.)
   ↓
4. Update node state: status = 'generating'
   ↓
5. tauriVideoGateway.generateVideo(payload)
   ↓
6. Tauri IPC: invoke('generate_video', request)
   ↓
7. Rust: video::generate_video_command()
   ↓
8. Resolve provider from model ID
   ↓
9. KlingProvider.generate(request)
   ↓
10. POST https://api.kie.ai/api/v1/jobs/createTask
    ↓
11. API returns: { job_id: "xxx" }
    ↓
12. Store job in JobManager (in-memory)
    ↓
13. Return job_id to frontend
    ↓
14. Start polling loop (every 3 seconds):
    - invoke('poll_video_job', job_id)
    - Update progress in node
    - Continue until completed/failed
    ↓
15. On completion:
    - Get remoteVideoUrl from API
    - Try cacheVideoLocally(remoteVideoUrl)
      → If cache succeeds:
        - videoUrl = local file:// URL
        - Generate thumbnail from cached video
      → If cache fails (disk full, permissions, etc.):
        - Log warning
        - videoUrl = remoteVideoUrl (stream from API)
        - Show "cache failed" warning badge
    - Update node: status = 'completed'
    ↓
16. Embedded player loads video (from videoUrl)
```

### 5.2 Polling Strategy

**Frontend** (VideoGenNode.tsx):
```typescript
useEffect(() => {
  if (data.status !== 'generating' || !data.jobId) return;

  const pollInterval = setInterval(async () => {
    try {
      const status = await pollVideoJobStatus(data.jobId!);

      if (status.status === 'completed') {
        const localUrl = await cacheVideoLocally(status.videoUrl!);
        const thumbnail = await generateVideoThumbnail(localUrl);

        updateNodeData(id, {
          status: 'completed',
          videoUrl: localUrl,
          thumbnailUrl: thumbnail,
          progress: 100,
        });
        clearInterval(pollInterval);

      } else if (status.status === 'failed') {
        handleVideoError(status.errorType, status.errorMessage);
        clearInterval(pollInterval);

      } else {
        updateNodeData(id, { progress: status.progress });
      }
    } catch (error) {
      handlePollingError(error);
    }
  }, 3000);

  // Cleanup on unmount, status change, or node ID change
  return () => {
    clearInterval(pollInterval);
    // Future: Cancel in-flight requests if needed
  };
}, [data.status, data.jobId, id]);
```

**Backend** (src-tauri/src/ai/video/job_manager.rs):
```rust
pub async fn poll_job(&self, job_id: &str) -> Result<VideoJobStatus> {
    let provider = self.get_provider_for_job(job_id)?;
    let status = provider.get_status(job_id).await?;

    // Cache state for debugging
    self.update_job_state(job_id, status.clone()).await;

    Ok(status)
}
```

---

## 6. Error Handling

### 6.1 Error Type System

**File**: `src/features/canvas/models/videoErrors.ts`

```typescript
export enum VideoErrorType {
  // Permanent - require user action
  INVALID_API_KEY = 'invalid_api_key',
  UNAUTHORIZED = 'unauthorized',
  QUOTA_EXCEEDED = 'quota_exceeded',
  INSUFFICIENT_CREDITS = 'insufficient_credits',
  INVALID_PARAMETERS = 'invalid_parameters',
  UNSUPPORTED_FORMAT = 'unsupported_format',
  INVALID_IMAGE_URL = 'invalid_image_url',
  IMAGE_TOO_LARGE = 'image_too_large',

  // Temporary - auto-retry
  NETWORK_TIMEOUT = 'network_timeout',
  CONNECTION_ERROR = 'connection_error',
  SERVER_ERROR = 'server_error',
  SERVICE_UNAVAILABLE = 'service_unavailable',

  // Rate limiting - wait and retry
  RATE_LIMIT = 'rate_limit',

  // Job-specific
  JOB_FAILED = 'job_failed',
  JOB_TIMEOUT = 'job_timeout',
  JOB_CANCELLED = 'job_cancelled',

  UNKNOWN_ERROR = 'unknown_error',
}

export interface VideoErrorMetadata {
  type: VideoErrorType;
  message: string;
  retryable: boolean;
  retryAfterSeconds?: number;
  suggestedAction?: string;
}
```

### 6.2 Error Classification Logic

**File**: `src/features/canvas/application/videoErrorHandler.ts`

```typescript
export class VideoErrorHandler {
  private maxRetries = 3;
  private retryDelays = [2000, 5000, 10000]; // Exponential backoff

  classifyError(
    error: any,
    context?: { providerId?: string; modelId?: string }
  ): VideoErrorMetadata {
    const errorCode = error?.errorCode || error?.code;
    const errorMessage = error?.message || 'Unknown error';

    let type: VideoErrorType;
    let retryable = false;
    let retryAfterSeconds: number | undefined;
    let suggestedAction: string | undefined;

    switch (errorCode) {
      case 'invalid_api_key':
        type = VideoErrorType.INVALID_API_KEY;
        suggestedAction = 'Update API key in Settings';
        break;

      case 'quota_exceeded':
        type = VideoErrorType.QUOTA_EXCEEDED;
        suggestedAction = 'Try different provider or wait for quota reset';
        break;

      case 'rate_limit':
        type = VideoErrorType.RATE_LIMIT;
        retryable = true;
        retryAfterSeconds = error?.retryAfter || 60;
        suggestedAction = `Wait ${retryAfterSeconds}s before retry`;
        break;

      case 'network_timeout':
        type = VideoErrorType.NETWORK_TIMEOUT;
        retryable = true;
        suggestedAction = 'Check internet connection';
        break;

      case 'server_error':
      case '500':
      case '502':
      case '503':
        type = VideoErrorType.SERVER_ERROR;
        retryable = true;
        suggestedAction = 'Provider temporary issue';
        break;

      default:
        type = VideoErrorType.UNKNOWN_ERROR;
        suggestedAction = 'Contact support if issue persists';
    }

    return { type, message: errorMessage, retryable, retryAfterSeconds, suggestedAction };
  }

  shouldRetry(errorMeta: VideoErrorMetadata, retryCount: number): boolean {
    return errorMeta.retryable && retryCount < this.maxRetries;
  }

  getRetryDelay(retryCount: number, errorMeta: VideoErrorMetadata): number {
    if (errorMeta.type === VideoErrorType.RATE_LIMIT && errorMeta.retryAfterSeconds) {
      return errorMeta.retryAfterSeconds * 1000;
    }
    return this.retryDelays[retryCount] || 10000;
  }
}
```

### 6.3 Retry Logic

**Automatic Retry Behavior**:
- Network/server errors: Max 3 retries with exponential backoff (2s, 5s, 10s)
- Rate limit: Single retry after specified wait period
- Permanent errors: No automatic retry, show action button

**UI Display**:
- Red badge: Permanent errors
- Yellow badge: Temporary errors (retrying)
- Progress text: "Retrying... (2/3)"
- Action buttons: Context-specific (Open Settings, Try Another Provider, Retry)

---

## 7. Video Storage & Cache Management

### 7.1 Storage Architecture

**Two-Tier System**:
1. **Cache** (temporary, app-managed): For in-app preview
2. **Downloads** (permanent, user-managed): For final storage

**Cache Directory**:
- Location: `<app_data_dir>/cache/videos/`
- Files: `<video_id_hash>.mp4`
- Metadata: `cache_metadata.json`

**Download Paths**:
- User-configured preset paths (max 8)
- Default download path (optional)
- Custom "Choose location" picker

### 7.2 Cache Manager

**File**: `src-tauri/src/ai/video/cache_manager.rs`

```rust
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::SystemTime;
use serde::{Serialize, Deserialize};
use tokio::sync::RwLock;

pub struct VideoCacheManager {
    cache_dir: PathBuf,
    metadata_file: PathBuf,
    max_cache_size_mb: u64,     // Default: 1GB
    max_age_days: u64,          // Default: 30 days
}

#[derive(Serialize, Deserialize, Clone)]
struct CachedVideoMetadata {
    video_id: String,           // Hash of job_id or original URL
    original_url: String,       // Remote API URL
    local_path: String,         // file:// URL
    file_size_bytes: u64,
    #[serde(with = "systemtime_serde")]
    cached_at: SystemTime,
    #[serde(with = "systemtime_serde")]
    last_accessed: SystemTime,
    node_ids: Vec<String>,      // Nodes referencing this video (updated on access)
    project_id: Option<String>, // Project that owns this video
}
```

**Cleanup Policies**:

| Trigger | Action |
|---------|--------|
| **Size limit exceeded** | Remove LRU videos until 80% of limit |
| **Video older than max age** | Remove automatically |
| **Node deleted** | Remove if no other nodes reference it |
| **App startup** | Run cleanup if auto-cleanup enabled |
| **Manual cleanup** | Run all policies |
| **Clear all** | Delete entire cache (with confirmation) |

**Key Methods**:
- `cache_video()`: Download and store with metadata
- `cleanup_if_needed()`: Check policies and clean
- `cleanup_by_lru()`: Remove least recently used
- `cleanup_by_age()`: Remove old videos
- `cleanup_orphaned()`: Remove unreferenced videos
- `get_cache_stats()`: Return size/count for UI
- `clear_all_cache()`: Nuclear option

### 7.3 Settings Store Extension

**File**: `src/stores/settingsStore.ts`

```typescript
interface SettingsState {
  // Existing
  apiKeys: Record<string, string>;
  downloadPresetPaths: string[];

  // New - Video specific
  videoDownloadPresetPaths: string[];        // Max 8
  defaultVideoDownloadPath?: string;
  autoRevealVideoInExplorer: boolean;        // Consistent with image reveal

  // Cache settings
  maxVideoCacheSizeMB: number;               // Default: 1024
  maxVideoCacheAgeDays: number;              // Default: 30
  videoCacheAutoCleanupOnStartup: boolean;   // Default: true

  // Actions
  setVideoDownloadPresetPaths: (paths: string[]) => void;
  addVideoDownloadPresetPath: (path: string) => void;
  removeVideoDownloadPresetPath: (path: string) => void;
  setDefaultVideoDownloadPath: (path?: string) => void;
  setMaxVideoCacheSize: (sizeMB: number) => void;
  setMaxVideoCacheAge: (days: number) => void;
}
```

---

## 8. Provider Implementation

### 8.1 Kling Provider (Rust)

**File**: `src-tauri/src/ai/video/providers/kling/mod.rs`

```rust
pub struct KlingVideoProvider {
    client: Client,
    api_key: Arc<RwLock<Option<String>>>,
    base_url: String,
    job_manager: Arc<RwLock<HashMap<String, KlingJobInfo>>>,
}

impl KlingVideoProvider {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            api_key: Arc::new(RwLock::new(None)),
            base_url: "https://api.kie.ai/api/v1".to_string(),
            job_manager: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    async fn submit_job(&self, request: VideoGenerateRequest) -> Result<String, VideoError> {
        let api_key = self.get_api_key()?;

        let mut body = json!({
            "model": request.model,
            "input": {
                "mode": request.extra_params
                    .as_ref()
                    .and_then(|p| p.get("mode"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("pro"),
                "prompt": request.prompt,
                "duration": request.duration.to_string(),
                "aspect_ratio": request.aspect_ratio,
                "sound": request.enable_audio,
            }
        });

        // Add image_urls if frames provided
        let mut image_urls = Vec::new();
        if let Some(start) = request.start_frame_url {
            image_urls.push(start);
        }
        if let Some(end) = request.end_frame_url {
            image_urls.push(end);
        }
        if !image_urls.is_empty() {
            body["input"]["image_urls"] = json!(image_urls);
        }

        // Add seed if provided
        if let Some(seed) = request.seed {
            body["input"]["seed"] = json!(seed);
        }

        // Add multi_shots and kling_elements from extraParams
        if let Some(extra) = request.extra_params {
            if let Some(multi_shots) = extra.get("multi_shots") {
                body["input"]["multi_shots"] = multi_shots.clone();
            }
            if let Some(elements) = extra.get("kling_elements") {
                if !elements.as_array().map_or(true, |a| a.is_empty()) {
                    body["input"]["kling_elements"] = elements.clone();
                }
            }
        }

        let response = self.client
            .post(&format!("{}/jobs/createTask", self.base_url))
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(self.parse_error_response(response).await);
        }

        let result: KlingCreateJobResponse = response.json().await?;

        // Store job info
        let job_info = KlingJobInfo {
            job_id: result.job_id.clone(),
            created_at: SystemTime::now(),
            model: request.model.clone(),
        };

        let mut jobs = self.job_manager.write().await;
        jobs.insert(result.job_id.clone(), job_info);

        Ok(result.job_id)
    }

    async fn poll_job_status(&self, job_id: &str) -> Result<VideoJobStatus, VideoError> {
        let api_key = self.get_api_key()?;

        let response = self.client
            .get(&format!("{}/jobs/status/{}", self.base_url, job_id))
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(self.parse_error_response(response).await);
        }

        let result: KlingJobStatusResponse = response.json().await?;

        Ok(VideoJobStatus {
            job_id: job_id.to_string(),
            status: self.map_kling_status(&result.status),
            video_url: result.output.and_then(|o| o.video_url),
            progress: result.progress,
            error_type: result.error_code.map(|c| self.map_error_code(&c)),
            error_message: result.error_message,
        })
    }
}

#[async_trait]
impl VideoProvider for KlingVideoProvider {
    fn name(&self) -> &str { "kling" }

    fn supports_model(&self, model: &str) -> bool {
        model.starts_with("kling/")
    }

    async fn set_api_key(&self, api_key: String) -> Result<(), VideoError> {
        let mut key = self.api_key.write().await;
        *key = Some(api_key);
        Ok(())
    }

    async fn generate(&self, request: VideoGenerateRequest) -> Result<String, VideoError> {
        self.submit_job(request).await
    }

    async fn get_status(&self, job_id: &str) -> Result<VideoJobStatus, VideoError> {
        self.poll_job_status(job_id).await
    }
}
```

### 8.2 Adding New Providers

To add a new provider (e.g., Runway):

1. **Frontend Model**:
   - Create `src/features/canvas/models/video/runway/gen3.ts`
   - Export `videoModel: VideoModelDefinition`

2. **Provider Metadata**:
   - Update `src/features/canvas/models/providers/runway.ts`
   - Export `provider: ModelProviderDefinition`

3. **Rust Implementation**:
   - Create `src-tauri/src/ai/video/providers/runway/mod.rs`
   - Implement `VideoProvider` trait
   - Add to `build_default_video_providers()` in `src-tauri/src/ai/video/providers/mod.rs`

4. **Settings**:
   - Add Runway URLs to `PROVIDER_REGISTER_URLS` and `PROVIDER_GET_KEY_URLS`

**No other changes needed** - auto-discovery handles the rest.

---

## 9. UI/UX Details

### 9.1 VideoGenNode States

| State | Visual | Behavior |
|-------|--------|----------|
| **Idle** | Empty output, "Generate Video" button enabled | Waiting for user action |
| **Generating** | Progress bar (0-100%), spinner, status text | Polling every 3s, can't generate again |
| **Completed** | Video player visible, thumbnail loaded | Can play, download, regenerate |
| **Error** | Red/yellow badge, error message, action buttons | Shows retry options or guidance |

### 9.2 Settings Dialog - Video Section

**New Tab**: "Storage"

**Sections**:
1. **Video Downloads**
   - Default download path selector
   - Preset paths list (max 8) with add/remove
   - Auto-reveal toggle

2. **Video Cache**
   - Cache stats (size, count, age limit)
   - Max cache size dropdown (512MB, 1GB, 2GB, 5GB)
   - Max cache age dropdown (7, 14, 30, 60, 90 days)
   - Cleanup button (runs policies)
   - Clear all button (destructive, with confirmation)
   - Auto-cleanup on startup toggle

### 9.3 Node Menu Integration

**File**: `src/features/canvas/domain/nodeRegistry.ts`

```typescript
{
  type: 'videoGen',
  label: 'Video Generation',
  icon: VideoIcon,
  category: 'generation',
  createDefaultData: () => ({
    selectedModel: DEFAULT_VIDEO_MODEL_ID,
    prompt: '',
    duration: 5,
    aspectRatio: '16:9',
    enableAudio: true,
    status: 'idle',
    retryCount: 0,
  }),
  capabilities: {
    canDelete: true,
    canDuplicate: true,
    canGroup: true,
  },
  connectivity: {
    sourceHandle: false,
    targetHandle: {
      'start-frame': { type: 'image', label: 'Start Frame', position: Position.Left },
      'end-frame': { type: 'image', label: 'End Frame', position: Position.Right },
    },
    connectMenu: {
      fromSource: false,
      fromTarget: false,
    },
  },
}
```

---

## 10. Internationalization (i18n)

### 10.1 Required Keys

**Files**: `src/i18n/locales/en.json` and `zh.json`

**Categories**:
- `video.*`: Node UI labels, buttons, status messages
- `videoErrors.*`: Error types and suggested actions
- `settings.videoStorage*`: Settings dialog labels
- `settings.videoCache*`: Cache management labels
- `node.menu.videoGen`: Node menu label

**Total Keys**: ~50 new keys across both languages

See full translation tables in Appendix A.

---

## 11. Testing Strategy

### 11.1 Unit Tests

**Frontend**:
- `videoRegistry.test.ts`: Registry functions
- `videoErrorHandler.test.ts`: Error classification logic
- `videoGenNode.test.ts`: Component state management

**Rust**:
- `cache_manager_tests.rs`: Cache policies
- `kling_provider_tests.rs`: Status mapping, error codes
- `video_commands_tests.rs`: Command handlers

### 11.2 Integration Tests

**Manual Scenarios**:
1. Text-to-video happy path
2. Image-to-video with start/end frames
3. Error handling (invalid key, rate limit, timeout)
4. Cache management (cleanup, clear all)
5. Project persistence (save, close, reopen)
6. Settings configuration (paths, cache limits)

### 11.3 Performance Tests

**Metrics**:
- Polling impact on CPU/memory
- UI responsiveness during generation
- Cache lookup speed
- Download speed for large videos

**Stress Tests**:
- 5+ videos generating simultaneously
- Cache with 1000+ videos
- Network interruption during download
- App restart with pending jobs

---

## 12. Implementation Phases

### Phase 1: Core Infrastructure (Foundation)
- [ ] Type definitions (TypeScript + Rust)
- [ ] Video registry system
- [ ] Basic VideoGenNode component (no UI polish)
- [ ] Tauri command scaffolding
- [ ] Kling provider implementation

### Phase 2: Video Generation Flow
- [ ] Job submission and polling
- [ ] Progress updates
- [ ] Video caching
- [ ] Thumbnail generation
- [ ] Basic error handling

### Phase 3: Settings & Storage
- [ ] Settings store extension
- [ ] Settings dialog UI
- [ ] Download functionality
- [ ] Preset paths management

### Phase 4: Cache Management
- [ ] Cache manager implementation
- [ ] Cleanup policies (LRU, age, orphaned)
- [ ] Settings UI for cache
- [ ] Auto-cleanup on startup

### Phase 5: Error Handling & Polish
- [ ] Error classification system
- [ ] Retry logic with backoff
- [ ] Error UI with actions
- [ ] i18n for all strings

### Phase 6: Advanced Features
- [ ] Kling elements UI
- [ ] Multi-shot toggle
- [ ] Extra params dynamic rendering
- [ ] Node handles for image connections

### Phase 7: Testing & Documentation
- [ ] Unit tests
- [ ] Integration tests
- [ ] Performance validation
- [ ] Update CLAUDE.md

---

## 13. Security Considerations

### 13.1 Input Validation

- Filename sanitization (prevent path traversal)
- Duration bounds checking (3-15 seconds)
- Seed value validation (positive integer)
- URL validation for image frames
- Prompt length limits

### 13.2 API Key Storage

- Stored in localStorage (same as image providers)
- Not logged in console or files
- Transmitted over HTTPS only
- User responsible for key security

### 13.3 File System Access

- Download paths must be validated directories
- No arbitrary file system access
- Cache directory isolated to app data
- Proper error handling for permission issues

---

## 14. Performance Considerations

### 14.1 Polling Optimization

- 3-second interval balances responsiveness and load
- Stops immediately on completion/failure
- No polling when node not visible (future enhancement)

### 14.2 Cache Efficiency

- LRU eviction prevents unbounded growth
- Metadata file for fast lookups
- Lazy thumbnail generation
- Periodic cleanup instead of per-operation

### 14.3 UI Responsiveness

- Video player lazy-loaded
- Thumbnail used during loading
- Background polling doesn't block UI
- Progress updates throttled to avoid re-render spam

---

## 15. Future Enhancements

### 15.1 Short-term (Next Release)

- Pause/resume generation
- Video preview during generation (if provider supports)
- Batch generation (queue multiple videos)
- Video format selection (MP4, WebM)

### 15.2 Medium-term (Future Releases)

- More providers (Runway, Pika, Luma)
- Video editing node (trim, crop, effects)
- Audio extraction/replacement
- Video-to-video transformation

### 15.3 Long-term (Exploratory)

- Local video generation (on-device models)
- Real-time preview streaming
- Video composition (multi-layer)
- Timeline-based editing

---

## Appendix A: Complete i18n Keys

### English (`en.json`)

```json
{
  "video": {
    "videoGeneration": "Video Generation",
    "selectModel": "Select Model",
    "duration": "Duration",
    "durationSeconds": "{{seconds}} seconds",
    "aspectRatio": "Aspect Ratio",
    "enableAudio": "Enable Audio",
    "seed": "Seed (optional)",
    "seedPlaceholder": "Enter seed number",
    "videoPrompt": "Video Prompt",
    "promptPlaceholder": "Describe the video you want to generate...",
    "multiShotMode": "Multi-Shot Mode",
    "multiShotModeDesc": "Generate multiple shots in sequence",
    "advancedOptions": "Advanced Options",
    "klingElements": "Kling Elements",
    "klingElementsDesc": "Define elements that can be referenced using @element_name",
    "elementName": "Element Name",
    "elementNamePlaceholder": "element_dog",
    "elementDescription": "Description (optional)",
    "elementImages": "Element Images (2-50)",
    "addElement": "Add Element",
    "removeElement": "Remove Element",
    "addElementImage": "Add Image",
    "generate": "Generate Video",
    "generating": "Generating...",
    "generatingProgress": "Generating... {{progress}}%",
    "download": "Download Video",
    "downloading": "Downloading...",
    "chooseLocation": "Choose Location...",
    "quickDownload": "Quick Download",
    "videoReady": "Video Ready",
    "playVideo": "Play Video",
    "videoError": "Video Generation Failed",
    "retry": "Retry",
    "retryAttempt": "Retry ({{current}}/{{max}})",
    "reset": "Reset",
    "startFrame": "Start Frame",
    "endFrame": "End Frame"
  },

  "videoErrors": {
    "invalid_api_key": "Invalid API Key",
    "invalid_api_key_action": "Please update your API key in Settings",
    "quota_exceeded": "Quota Exceeded",
    "quota_exceeded_action": "Try a different provider or wait for quota reset",
    "rate_limit": "Rate Limited",
    "rate_limit_action": "Waiting {{seconds}}s before retry...",
    "network_timeout": "Network Timeout",
    "network_timeout_action": "Check your internet connection",
    "server_error": "Server Error",
    "server_error_action": "Provider is experiencing issues. Retrying...",
    "invalid_parameters": "Invalid Parameters",
    "invalid_parameters_action": "Please check your video configuration",
    "job_timeout": "Job Timeout",
    "job_timeout_action": "Generation exceeded 5 minute limit",
    "unknown_error": "Unknown Error",
    "unknown_error_action": "Please try again or contact support"
  },

  "settings": {
    "videoStorage": "Video Storage",
    "videoStorageDesc": "Configure where generated videos are saved",
    "defaultVideoDownloadPath": "Default Download Path",
    "videoPresetPaths": "Preset Download Paths",
    "videoPresetPathsDesc": "Quick access paths for downloading videos (max 8)",
    "addPresetPath": "Add Preset Path",
    "autoRevealVideoInExplorer": "Auto-reveal in Explorer",
    "autoRevealVideoInExplorerDesc": "Automatically open file location after download",
    "videoCache": "Video Cache",
    "cacheSize": "Cache Size",
    "cachedVideos": "Cached Videos",
    "maxCacheSize": "Maximum Cache Size",
    "maxCacheAge": "Maximum Cache Age",
    "cleanupCache": "Cleanup Cache",
    "clearAllCache": "Clear All Cache",
    "clearCacheConfirmTitle": "Clear Video Cache?",
    "clearCacheConfirmMessage": "This will delete all cached videos. Generated videos will need to be re-downloaded. Continue?",
    "autoCleanupOnStartup": "Auto-cleanup on Startup",
    "autoCleanupOnStartupDesc": "Automatically remove old/unused videos when app starts"
  },

  "node": {
    "menu": {
      "videoGen": "Video Generation"
    }
  }
}
```

### Chinese (`zh.json`)

```json
{
  "video": {
    "videoGeneration": "视频生成",
    "selectModel": "选择模型",
    "duration": "时长",
    "durationSeconds": "{{seconds}} 秒",
    "aspectRatio": "宽高比",
    "enableAudio": "启用音频",
    "seed": "种子值（可选）",
    "seedPlaceholder": "输入种子值",
    "videoPrompt": "视频提示词",
    "promptPlaceholder": "描述您想要生成的视频...",
    "multiShotMode": "多镜头模式",
    "multiShotModeDesc": "生成多个连续镜头",
    "advancedOptions": "高级选项",
    "klingElements": "可灵元素",
    "klingElementsDesc": "定义可在提示词中使用 @元素名 引用的元素",
    "elementName": "元素名称",
    "elementNamePlaceholder": "element_dog",
    "elementDescription": "描述（可选）",
    "elementImages": "元素图片（2-50张）",
    "addElement": "添加元素",
    "removeElement": "移除元素",
    "addElementImage": "添加图片",
    "generate": "生成视频",
    "generating": "生成中...",
    "generatingProgress": "生成中... {{progress}}%",
    "download": "下载视频",
    "downloading": "下载中...",
    "chooseLocation": "选择位置...",
    "quickDownload": "快速下载",
    "videoReady": "视频已就绪",
    "playVideo": "播放视频",
    "videoError": "视频生成失败",
    "retry": "重试",
    "retryAttempt": "重试 ({{current}}/{{max}})",
    "reset": "重置",
    "startFrame": "起始帧",
    "endFrame": "结束帧"
  },

  "videoErrors": {
    "invalid_api_key": "API 密钥无效",
    "invalid_api_key_action": "请在设置中更新您的 API 密钥",
    "quota_exceeded": "配额已用尽",
    "quota_exceeded_action": "请尝试其他供应商或等待配额重置",
    "rate_limit": "请求过于频繁",
    "rate_limit_action": "等待 {{seconds}} 秒后重试...",
    "network_timeout": "网络超时",
    "network_timeout_action": "请检查您的网络连接",
    "server_error": "服务器错误",
    "server_error_action": "供应商遇到问题，正在重试...",
    "invalid_parameters": "参数无效",
    "invalid_parameters_action": "请检查您的视频配置",
    "job_timeout": "任务超时",
    "job_timeout_action": "生成超过 5 分钟限制",
    "unknown_error": "未知错误",
    "unknown_error_action": "请重试或联系技术支持"
  },

  "settings": {
    "videoStorage": "视频存储",
    "videoStorageDesc": "配置生成的视频保存位置",
    "defaultVideoDownloadPath": "默认下载路径",
    "videoPresetPaths": "预设下载路径",
    "videoPresetPathsDesc": "视频下载的快速访问路径（最多 8 个）",
    "addPresetPath": "添加预设路径",
    "autoRevealVideoInExplorer": "自动在文件管理器中显示",
    "autoRevealVideoInExplorerDesc": "下载完成后自动打开文件所在位置",
    "videoCache": "视频缓存",
    "cacheSize": "缓存大小",
    "cachedVideos": "已缓存视频",
    "maxCacheSize": "最大缓存大小",
    "maxCacheAge": "最大缓存时长",
    "cleanupCache": "清理缓存",
    "clearAllCache": "清空所有缓存",
    "clearCacheConfirmTitle": "清空视频缓存？",
    "clearCacheConfirmMessage": "这将删除所有已缓存的视频。生成的视频需要重新下载。是否继续？",
    "autoCleanupOnStartup": "启动时自动清理",
    "autoCleanupOnStartupDesc": "应用启动时自动删除旧的或未使用的视频"
  },

  "node": {
    "menu": {
      "videoGen": "视频生成"
    }
  }
}
```

---

## Appendix B: File Structure Summary

```
Frontend:
├── src/features/canvas/
│   ├── models/
│   │   ├── types.ts                          [EXTEND] Add VideoModelDefinition
│   │   ├── videoRegistry.ts                  [NEW] Video model registry
│   │   ├── videoErrors.ts                    [NEW] Error type system
│   │   ├── providers/
│   │   │   └── kling.ts                      [NEW] Kling provider metadata
│   │   └── video/
│   │       └── kling/
│   │           └── kling30.ts                [NEW] Kling 3.0 model
│   ├── nodes/
│   │   ├── VideoGenNode.tsx                  [NEW] Video generation node
│   │   └── index.ts                          [EXTEND] Register VideoGenNode
│   ├── domain/
│   │   └── nodeRegistry.ts                   [EXTEND] Add videoGen node type
│   ├── application/
│   │   └── videoErrorHandler.ts              [NEW] Error classification
│   └── infrastructure/
│       └── tauriVideoGateway.ts              [NEW] Video API gateway
├── src/commands/
│   └── video.ts                              [NEW] Video Tauri commands
├── src/stores/
│   └── settingsStore.ts                      [EXTEND] Add video settings
├── src/components/
│   └── SettingsDialog.tsx                    [EXTEND] Add video section
├── src/i18n/locales/
│   ├── en.json                               [EXTEND] Add video keys
│   └── zh.json                               [EXTEND] Add video keys
└── src/App.tsx                               [EXTEND] Add cache cleanup

Backend (Rust):
├── src-tauri/src/
│   ├── commands/
│   │   └── video.rs                          [NEW] Video commands
│   ├── ai/
│   │   └── video/
│   │       ├── mod.rs                        [NEW] VideoProvider trait
│   │       ├── error.rs                      [NEW] Error types
│   │       ├── cache_manager.rs              [NEW] Cache management
│   │       ├── job_manager.rs                [NEW] Job state tracking
│   │       └── providers/
│   │           ├── mod.rs                    [NEW] Provider registry
│   │           └── kling/
│   │               ├── mod.rs                [NEW] Kling implementation
│   │               └── types.rs              [NEW] Kling types
│   └── lib.rs                                [EXTEND] Register video commands

Documentation:
└── docs/superpowers/specs/
    └── 2026-03-12-video-generation-design.md [NEW] This document
```

---

## Appendix C: API Reference

### Kling 3.0 API

**Submit Job**:
```http
POST https://api.kie.ai/api/v1/jobs/createTask
Authorization: Bearer {api_key}
Content-Type: application/json

{
  "model": "kling-3.0/video",
  "input": {
    "mode": "pro",
    "image_urls": ["https://..."],
    "sound": true,
    "duration": "5",
    "aspect_ratio": "16:9",
    "multi_shots": false,
    "prompt": "A dog running in a park",
    "seed": 12345,
    "kling_elements": [
      {
        "name": "element_dog",
        "description": "dog",
        "element_input_urls": ["https://...", "https://..."]
      }
    ]
  }
}

Response:
{
  "job_id": "abc123xyz",
  "status": "pending"
}
```

**Poll Status**:
```http
GET https://api.kie.ai/api/v1/jobs/status/{job_id}
Authorization: Bearer {api_key}

Response:
{
  "job_id": "abc123xyz",
  "status": "completed",
  "progress": 100,
  "output": {
    "video_url": "https://..."
  }
}
```

---

## Sign-off

This design has been reviewed and approved. The implementation will follow the structure and specifications outlined in this document.

**Approved by**: [User]
**Date**: 2026-03-12
