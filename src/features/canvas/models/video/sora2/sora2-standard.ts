import type { VideoModelDefinition } from '../../types';

export const videoModel: VideoModelDefinition = {
  id: 'sora2/sora-2-image-to-video',
  mediaType: 'video',
  displayName: 'Sora 2 Standard',
  providerId: 'sora2',
  description: 'OpenAI Sora 2 标准模型，用于图生视频',
  eta: '~45s',
  expectedDurationMs: 45000,
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
