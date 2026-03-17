import type { VideoModelDefinition } from '../../types';

export const videoModel: VideoModelDefinition = {
  id: 'veo/veo3',
  mediaType: 'video',
  displayName: 'Veo 3.1 Quality',
  providerId: 'veo',
  description: 'Google Veo 3.1 高质量视频生成',
  eta: '~60s',
  expectedDurationMs: 60000,
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
