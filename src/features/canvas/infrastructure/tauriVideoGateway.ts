import type { VideoAiGateway, GenerateVideoPayload, VideoJobStatus } from '../application/ports';
import * as videoCommands from '../../../commands/video';

export const tauriVideoGateway: VideoAiGateway = {
  async setApiKey(provider: string, apiKey: string): Promise<void> {
    await videoCommands.setVideoApiKey(provider, apiKey);
  },

  async generateVideo(payload: GenerateVideoPayload): Promise<{ jobId: string }> {
    const request: videoCommands.GenerateVideoRequest = {
      prompt: payload.prompt,
      model: payload.model,
      duration: payload.duration,
      aspect_ratio: payload.aspectRatio,
      enable_audio: payload.enableAudio,
      seed: payload.seed,
      start_frame_url: payload.startFrameUrl,
      end_frame_url: payload.endFrameUrl,
      extra_params: payload.extraParams,
    };

    const jobId = await videoCommands.generateVideo(request);
    return { jobId };
  },

  async pollJobStatus(jobId: string, model: string): Promise<VideoJobStatus> {
    const response = await videoCommands.pollVideoJobStatus(jobId, model);

    return {
      jobId: response.job_id,
      state: response.state,
      progress: response.progress,
      videoUrl: response.video_url,
      errorMessage: response.error_message,
      createdAt: response.created_at,
      updatedAt: response.updated_at,
    };
  },

  async cacheVideo(videoUrl: string, videoId: string): Promise<string> {
    return await videoCommands.cacheVideoLocally(videoUrl, videoId);
  },

  async downloadVideo(
    videoUrl: string,
    targetPath: string,
    revealInExplorer: boolean
  ): Promise<void> {
    await videoCommands.downloadVideoToDirectory(videoUrl, targetPath, revealInExplorer);
  },
};
