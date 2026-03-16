import type { VideoModelDefinition } from '../../types';

export const KLING_30_MODEL_ID = 'kling/kling-3.0';

export const videoModel: VideoModelDefinition = {
  id: KLING_30_MODEL_ID,
  mediaType: 'video',
  displayName: 'Kling 3.0',
  providerId: 'kling',
  description: 'Kling 3.0 professional video generation model with high-quality output',
  eta: '~30s',
  expectedDurationMs: 30000,
  defaultDuration: 5,
  defaultAspectRatio: '16:9',
  durations: [
    { value: 3, label: '3s' },
    { value: 5, label: '5s' },
    { value: 10, label: '10s' },
    { value: 15, label: '15s' },
  ],
  aspectRatios: [
    { value: '16:9', label: '16:9' },
    { value: '9:16', label: '9:16' },
    { value: '1:1', label: '1:1' },
  ],
  supportsAudio: true,
  supportsSeed: true,
  supportsImageToVideo: true,
  extraParamsSchema: [
    {
      key: 'mode',
      label: 'Mode',
      type: 'enum',
      description: 'Generation mode: standard or professional',
      defaultValue: 'std',
      options: [
        { value: 'std', label: 'Standard' },
        { value: 'pro', label: 'Professional' },
      ],
    },
    {
      key: 'multi_shots',
      label: 'Multi Shots',
      type: 'boolean',
      description: 'Enable multiple camera angles',
      defaultValue: false,
    },
    {
      key: 'kling_elements',
      label: 'Kling Elements',
      type: 'array',
      description: 'Define elements that can be referenced in prompts using @element_name',
    },
  ],
  defaultExtraParams: {
    mode: 'std',
    multi_shots: false,
    kling_elements: [],
  },
};
