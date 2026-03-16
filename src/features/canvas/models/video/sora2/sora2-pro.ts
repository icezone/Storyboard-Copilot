import type { VideoModelDefinition } from '../../types';

export const videoModel: VideoModelDefinition = {
  id: 'sora2/sora-2-pro-image-to-video',
  mediaType: 'video',
  displayName: 'Sora 2 Pro',
  providerId: 'sora2',
  description: 'OpenAI Sora 2 专业模型，高质量图生视频',
  eta: '~60s',
  expectedDurationMs: 60000,
  defaultDuration: 10,
  defaultAspectRatio: '16:9',
  durations: [
    { value: 10, label: '10 s' },
    { value: 15, label: '15 s' },
  ],
  aspectRatios: [
    { value: '16:9', label: '16:9' },
    { value: '9:16', label: '9:16' },
  ],
  supportsAudio: false,
  supportsSeed: false,
  supportsImageToVideo: true,
  extraParamsSchema: [],
  defaultExtraParams: {},
};
