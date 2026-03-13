import { invoke, isTauri } from '@tauri-apps/api/core';

export interface GenerateVideoRequest {
  prompt: string;
  model: string;
  duration?: number;
  aspect_ratio?: string;
  enable_audio?: boolean;
  seed?: number;
  start_frame_url?: string;
  end_frame_url?: string;
  extra_params?: Record<string, unknown>;
}

export interface VideoJobStatusResponse {
  job_id: string;
  state: 'pending' | 'processing' | 'completed' | 'failed' | 'timeout';
  progress?: number;
  video_url?: string;
  error_message?: string;
  created_at?: number;
  updated_at?: number;
}

export interface VideoCacheStats {
  total_videos: number;
  total_size_bytes: number;
  oldest_video_age_seconds?: number;
}

function truncateText(value: string, max = 200): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}...(${value.length} chars)`;
}

function sanitizeVideoRequestForLog(request: GenerateVideoRequest): Record<string, unknown> {
  return {
    prompt: truncateText(request.prompt, 240),
    model: request.model,
    duration: request.duration,
    aspect_ratio: request.aspect_ratio,
    enable_audio: request.enable_audio,
    seed: request.seed,
    has_start_frame: Boolean(request.start_frame_url),
    has_end_frame: Boolean(request.end_frame_url),
    extra_params: request.extra_params ?? {},
  };
}

interface ErrorWithDetails extends Error {
  details?: string;
}

function normalizeInvokeError(error: unknown): { message: string; details?: string } {
  if (error instanceof Error) {
    const detailsText =
      'details' in error
        ? typeof (error as { details?: unknown }).details === 'string'
          ? (error as { details?: string }).details
          : undefined
        : undefined;
    return { message: error.message || 'Video generation failed', details: detailsText };
  }

  if (typeof error === 'string') {
    return { message: error || 'Video generation failed', details: error || undefined };
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const message =
      (typeof record.message === 'string' && record.message) ||
      (typeof record.error === 'string' && record.error) ||
      (typeof record.msg === 'string' && record.msg) ||
      'Video generation failed';
    let details: string | undefined;
    try {
      details = truncateText(JSON.stringify(record, null, 2), 2000);
    } catch {
      details = truncateText(String(record), 2000);
    }
    return { message, details };
  }

  return { message: 'Video generation failed' };
}

function createErrorWithDetails(message: string, details?: string): ErrorWithDetails {
  const error: ErrorWithDetails = new Error(message);
  if (details) {
    error.details = details;
  }
  return error;
}

export async function setVideoApiKey(provider: string, apiKey: string): Promise<void> {
  console.info('[Video] set_video_api_key', {
    provider,
    apiKeyMasked: apiKey ? `${apiKey.slice(0, 4)}***${apiKey.slice(-2)}` : '',
    tauri: isTauri(),
  });
  if (!isTauri()) {
    throw new Error('当前不是 Tauri 容器环境，请使用 `npm run tauri dev` 启动');
  }
  return await invoke('set_video_api_key', { provider, apiKey });
}

export async function generateVideo(request: GenerateVideoRequest): Promise<string> {
  const startedAt = performance.now();
  console.info('[Video] generate_video request', {
    ...sanitizeVideoRequestForLog(request),
    tauri: isTauri(),
  });

  if (!isTauri()) {
    throw new Error('当前不是 Tauri 容器环境，请使用 `npm run tauri dev` 启动');
  }

  try {
    const rawResult = await invoke<unknown>('generate_video', { request });
    if (typeof rawResult !== 'string') {
      throw createErrorWithDetails(
        'Video generation returned non-string job ID',
        truncateText(
          (() => {
            try {
              return JSON.stringify(rawResult, null, 2);
            } catch {
              return String(rawResult);
            }
          })(),
          2000
        )
      );
    }
    const jobId = rawResult.trim();
    if (!jobId) {
      throw createErrorWithDetails('Video generation returned empty job ID');
    }
    const elapsedMs = Math.round(performance.now() - startedAt);
    console.info('[Video] generate_video success', {
      elapsedMs,
      jobId,
    });
    return jobId;
  } catch (error) {
    const elapsedMs = Math.round(performance.now() - startedAt);
    const normalizedError = normalizeInvokeError(error);
    console.error('[Video] generate_video failed', {
      elapsedMs,
      request: sanitizeVideoRequestForLog(request),
      error,
      normalizedError,
    });
    const commandError: ErrorWithDetails = new Error(normalizedError.message);
    commandError.details = normalizedError.details;
    throw commandError;
  }
}

export async function pollVideoJobStatus(
  jobId: string,
  model: string
): Promise<VideoJobStatusResponse> {
  if (!isTauri()) {
    throw new Error('当前不是 Tauri 容器环境，请使用 `npm run tauri dev` 启动');
  }

  try {
    const result = await invoke<VideoJobStatusResponse>('poll_video_job_status', {
      jobId,
      model,
    });
    return result;
  } catch (error) {
    const normalizedError = normalizeInvokeError(error);
    console.error('[Video] poll_video_job_status failed', {
      jobId,
      model,
      error,
      normalizedError,
    });
    const commandError: ErrorWithDetails = new Error(normalizedError.message);
    commandError.details = normalizedError.details;
    throw commandError;
  }
}

export async function cacheVideoLocally(videoUrl: string, videoId: string): Promise<string> {
  console.info('[Video] cache_video', {
    videoId,
    videoUrl: truncateText(videoUrl, 100),
    tauri: isTauri(),
  });

  if (!isTauri()) {
    throw new Error('当前不是 Tauri 容器环境，请使用 `npm run tauri dev` 启动');
  }

  try {
    const cachedPath = await invoke<string>('cache_video', { videoUrl, videoId });
    console.info('[Video] cache_video success', {
      videoId,
      cachedPath,
    });
    return cachedPath;
  } catch (error) {
    const normalizedError = normalizeInvokeError(error);
    console.error('[Video] cache_video failed', {
      videoId,
      error,
      normalizedError,
    });
    const commandError: ErrorWithDetails = new Error(normalizedError.message);
    commandError.details = normalizedError.details;
    throw commandError;
  }
}

export async function downloadVideoToDirectory(
  videoUrl: string,
  targetPath: string,
  revealInExplorer: boolean = false
): Promise<void> {
  console.info('[Video] download_video', {
    videoUrl: truncateText(videoUrl, 100),
    targetPath,
    revealInExplorer,
    tauri: isTauri(),
  });

  if (!isTauri()) {
    throw new Error('当前不是 Tauri 容器环境，请使用 `npm run tauri dev` 启动');
  }

  try {
    // First cache the video
    const tempVideoId = `download_${Date.now()}`;
    const cachedPath = await cacheVideoLocally(videoUrl, tempVideoId);

    console.info('[Video] Video cached, copying to target', {
      cachedPath,
      targetPath,
    });

    // Copy the cached file to the target path
    await invoke('copy_file_to_path', {
      sourcePath: cachedPath,
      targetPath: targetPath,
    });

    console.info('[Video] Video copied successfully', {
      targetPath,
    });

    // Reveal in file explorer if requested
    if (revealInExplorer) {
      await invoke('reveal_in_file_explorer', {
        path: targetPath,
      });
      console.info('[Video] Revealed in file explorer');
    }
  } catch (error) {
    const normalizedError = normalizeInvokeError(error);
    console.error('[Video] download_video failed', {
      error,
      normalizedError,
    });
    throw createErrorWithDetails(normalizedError.message, normalizedError.details);
  }
}

export async function getVideoCacheStats(): Promise<VideoCacheStats> {
  if (!isTauri()) {
    throw new Error('当前不是 Tauri 容器环境，请使用 `npm run tauri dev` 启动');
  }

  try {
    const stats = await invoke<VideoCacheStats>('get_video_cache_stats');
    return stats;
  } catch (error) {
    const normalizedError = normalizeInvokeError(error);
    console.error('[Video] get_video_cache_stats failed', {
      error,
      normalizedError,
    });
    throw createErrorWithDetails(normalizedError.message, normalizedError.details);
  }
}

export async function clearVideoCache(): Promise<number> {
  console.info('[Video] clear_video_cache', {
    tauri: isTauri(),
  });

  if (!isTauri()) {
    throw new Error('当前不是 Tauri 容器环境，请使用 `npm run tauri dev` 启动');
  }

  try {
    const removedCount = await invoke<number>('clear_video_cache');
    console.info('[Video] clear_video_cache success', {
      removedCount,
    });
    return removedCount;
  } catch (error) {
    const normalizedError = normalizeInvokeError(error);
    console.error('[Video] clear_video_cache failed', {
      error,
      normalizedError,
    });
    throw createErrorWithDetails(normalizedError.message, normalizedError.details);
  }
}

export async function listVideoModels(): Promise<string[]> {
  if (!isTauri()) {
    throw new Error('当前不是 Tauri 容器环境，请使用 `npm run tauri dev` 启动');
  }

  return await invoke('list_video_models');
}
