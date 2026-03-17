import type { VideoModelDefinition } from '../../types';

export const videoModel: VideoModelDefinition = {
  id: 'veo/veo3_fast',
  mediaType: 'video',
  displayName: 'Veo 3.1 Fast',
  providerId: 'veo',
  description: 'Google Veo 3.1 快速视频生成',
  eta: '~30s',
  expectedDurationMs: 30000,  // Faster than quality mode
  defaultDuration: 0,  // No duration control - system determined
  defaultAspectRatio: '16:9',
  durations: [],  // No duration control - system determined
  aspectRatios: [
    { value: '16:9', label: '16:9' },
    { value: '9:16', label: '9:16' },
    { value: 'Auto', label: 'Auto' },
  ],
  supportsAudio: false,
  supportsSeed: true,
  supportsImageToVideo: true,
  extraParamsSchema: [],
  defaultExtraParams: {},
};
