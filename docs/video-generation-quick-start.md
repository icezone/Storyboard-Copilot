# Video Generation Feature - Quick Start Guide

**Status:** ✅ **COMPLETE** - Production Ready (as of 2026-03-13)

---

## Feature Overview

The video generation feature is fully implemented and tested. Users can generate videos from text prompts and reference images using AI providers (currently Kling 3.0).

**See:** `video-generation-implementation-complete.md` for full implementation details.

---

## Quick Usage

### 1. Configure API Key
1. Open Settings → AI Providers → Kling
2. Enter your Kling API key (get from https://klingai.com)
3. Save settings

### 2. Create Video Generation Node
1. Upload or generate an image (optional, for image-to-video)
2. Drag from image node's output handle
3. Select "AI Video" from the menu
4. Or create standalone VideoGenNode from canvas menu

### 3. Generate Video
1. Enter your prompt (use @图1 to reference images)
2. Select parameters:
   - Duration: 3s, 5s, 10s, or 15s
   - Aspect Ratio: 16:9, 9:16, or 1:1
3. Additional options (Other Params panel):
   - Mode: Standard or Professional
   - Multi Shots: Enable multiple camera angles
   - Enable Audio: Generate with audio
   - Seed: For reproducible results
   - **Kling Elements:** Define named elements from connected images (e.g., @element_dog)
4. Optionally select start/end frames
5. Click "Generate"
6. Wait for progress bar to complete
7. Video preview appears automatically

### 4. Download Video
1. Click preset path button (if configured)
2. Or click "Download" button
3. Video saves and file explorer opens

---

## Test Backend (5 minutes)

### 1. Start Tauri Dev
```bash
npm run tauri dev
```

### 2. Test Commands in Browser Console

Open DevTools console and test:

```javascript
// Test 1: List video models
await window.__TAURI__.core.invoke('list_video_models')
// Expected: ["kling/kling-3.0"]

// Test 2: Set API key
await window.__TAURI__.core.invoke('set_video_api_key', {
  provider: 'kling',
  apiKey: 'your-kling-api-key-here'
})
// Expected: null (success)

// Test 3: Generate video
const jobId = await window.__TAURI__.core.invoke('generate_video', {
  request: {
    prompt: "A serene mountain landscape at sunset",
    model: "kling/kling-3.0",
    duration: 5,
    aspectRatio: "16:9"
  }
})
console.log('Job ID:', jobId)

// Test 4: Poll status (run every 3 seconds)
const status = await window.__TAURI__.core.invoke('poll_video_job_status', {
  jobId: jobId,
  model: "kling/kling-3.0"
})
console.log('Status:', status)
// state: "pending" → "processing" → "completed"
// video_url available when completed

// Test 5: Cache video
const cachedPath = await window.__TAURI__.core.invoke('cache_video', {
  videoUrl: status.video_url,
  videoId: jobId
})
console.log('Cached at:', cachedPath)

// Test 6: Get cache stats
const stats = await window.__TAURI__.core.invoke('get_video_cache_stats')
console.log('Cache stats:', stats)
```

---

## Implementation Status

✅ **All phases complete!** The video generation feature is fully functional.

### Completed Components

**Backend (Rust/Tauri):**
- ✅ VideoProvider trait and registry
- ✅ Kling 3.0 provider implementation
- ✅ All Tauri commands (generate, poll, cache, download)
- ✅ Video cache management (LRU, 5GB limit)
- ✅ File operations (copy, reveal in explorer)

**Frontend (React/TypeScript):**
- ✅ Type definitions (VideoModelDefinition, VideoGenNodeData)
- ✅ Video model registry with auto-discovery
- ✅ VideoGenNode component (1100+ lines)
- ✅ Prompt input with image reference support
- ✅ Frame selection UI (start + end frames)
- ✅ Video parameters controls
- ✅ Progress tracking with polling
- ✅ Video preview and download
- ✅ Collapsible sections
- ✅ Error handling
- ✅ i18n (English/Chinese)

### Architecture Highlights

- Simplified single-node design (VideoResultNode removed)
- Collapsible sections auto-collapse during generation
- No scrollbar design (fixed section heights)
- Large default size (1040×1100px)
- Preset download paths support
- Real-time progress updates (3s polling)

---

## Verification Commands

### Backend
```bash
cd src-tauri
cargo check          # Type check
cargo build          # Full build
cargo test           # Run tests (if added)
```

### Frontend
```bash
npx tsc --noEmit     # Type check
npm run dev          # Development server
npm run build        # Production build
```

### Full Stack
```bash
npm run tauri dev    # Start with Rust backend
npm run tauri build  # Production build
```

---

## Troubleshooting

### API Key Issues

**Problem:** 401 Unauthorized error
**Solution:**
- Verify API key is correct in Settings
- Ensure API endpoint is `https://api.kie.ai` (official API)
- Check API key has sufficient credits

### Generation Fails

**Problem:** 402 Credits insufficient
**Solution:**
- Add credits to your Kling account
- Check account status at https://klingai.com

**Problem:** Video generation times out
**Solution:**
- Check network connection
- Try shorter duration (3s or 5s)
- Switch from pro to std mode

### Download Issues

**Problem:** Download button doesn't appear
**Solution:**
- Wait for video generation to complete (progress bar at 100%)
- Check that `data.videoUrl` exists in node state

**Problem:** Download fails
**Solution:**
- Verify target path exists and is writable
- Check disk space
- Try browser download (no preset path) instead

### UI Issues

**Problem:** UI elements overflow node boundary
**Solution:**
- This is fixed in current version
- Resize node to larger size if needed (1040×1100 default)

**Problem:** Sections won't expand/collapse
**Solution:**
- Click section header (not body)
- Check console for JavaScript errors

---

## Key Files Reference

### Backend Entry Points
- `src-tauri/src/ai/video/mod.rs` - VideoProvider trait
- `src-tauri/src/ai/video/providers/kling/mod.rs` - Kling implementation
- `src-tauri/src/commands/video.rs` - Tauri commands
- `src-tauri/src/lib.rs` - Command registration

### Frontend Entry Points
- `src/features/canvas/nodes/VideoGenNode.tsx` - Main UI component
- `src/features/canvas/models/videoRegistry.ts` - Model discovery
- `src/commands/video.ts` - Tauri command wrappers
- `src/stores/settingsStore.ts` - Video settings

### Configuration
- `src-tauri/Cargo.toml` - Rust dependencies
- `package.json` - Frontend dependencies
- `src/i18n/locales/*.json` - Translations

---

## Future Enhancements

### Potential Additions

**More Providers:**
- Runway Gen-3
- Pika Labs
- Luma Dream Machine
- Stability AI Video

**Advanced Features:**
- Video editing/trimming
- Batch generation (multiple videos)
- Video-to-video (style transfer)
- Custom aspect ratios
- Longer durations (30s, 60s)
- Export format options (WebM, GIF)

**UI Improvements:**
- Video timeline scrubber
- Frame extraction
- Thumbnail preview
- Generation history
- Comparison view

### Architecture Support

The current implementation is designed to easily support:
- Additional providers (VideoProvider trait)
- Custom models (auto-discovery registry)
- New parameters (extraParamsSchema)
- Different node types (architecture is decoupled)

---

## Reference

**Full Documentation:**
- `video-generation-implementation-complete.md` - Complete implementation details
- `video-generation-design.md` - Original design document
- `CLAUDE.md` - Project conventions (Section 8.1.1)

**Key Files:**
- `src/features/canvas/nodes/VideoGenNode.tsx` - Main UI component
- `src-tauri/src/ai/video/providers/kling/mod.rs` - Kling provider
- `src/commands/video.ts` - Tauri command wrappers
- `src/features/canvas/models/videoRegistry.ts` - Model registry

**External Links:**
- Kling AI: https://klingai.com
- Kling API Docs: https://docs.kie.ai

---

**Status:** ✅ Implementation complete. Ready for production use!
