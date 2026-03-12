import type { VideoModelDefinition } from './types';

const videoModelModules = import.meta.glob<{ videoModel: VideoModelDefinition }>(
  './video/**/*.ts',
  { eager: true }
);

const videoModels: VideoModelDefinition[] = Object.values(videoModelModules)
  .map((module) => module.videoModel)
  .filter((model): model is VideoModelDefinition => Boolean(model))
  .sort((a, b) => a.id.localeCompare(b.id));

const videoModelMap = new Map<string, VideoModelDefinition>(
  videoModels.map((model) => [model.id, model])
);

export const DEFAULT_VIDEO_MODEL_ID = 'kling/kling-3.0';

const videoModelAliasMap = new Map<string, string>([
  ['kling-3.0', DEFAULT_VIDEO_MODEL_ID],
]);

export function listVideoModels(): VideoModelDefinition[] {
  return videoModels;
}

export function getVideoModel(modelId: string): VideoModelDefinition {
  const resolvedModelId = videoModelAliasMap.get(modelId) ?? modelId;
  return videoModelMap.get(resolvedModelId) ?? videoModelMap.get(DEFAULT_VIDEO_MODEL_ID)!;
}
