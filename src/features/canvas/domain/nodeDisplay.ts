import {
  CANVAS_NODE_TYPES,
  type CanvasNodeData,
  type CanvasNodeType,
  type ExportImageNodeResultKind,
} from './canvasNodes';

export type TranslateFn = (key: string) => string;

/** Hardcoded fallback names (Chinese) — used in non-React contexts (store, registry). */
export const DEFAULT_NODE_DISPLAY_NAME: Record<CanvasNodeType, string> = {
  [CANVAS_NODE_TYPES.upload]: '上传图片',
  [CANVAS_NODE_TYPES.imageEdit]: 'AI 图片',
  [CANVAS_NODE_TYPES.exportImage]: '结果图片',
  [CANVAS_NODE_TYPES.textAnnotation]: '文本注释',
  [CANVAS_NODE_TYPES.group]: '分组',
  [CANVAS_NODE_TYPES.storyboardSplit]: '切割结果',
  [CANVAS_NODE_TYPES.storyboardGen]: '分镜生成',
  [CANVAS_NODE_TYPES.videoGen]: 'AI 视频',
  [CANVAS_NODE_TYPES.videoResult]: '视频结果',
};

/** i18n key map for node display names. */
const NODE_DISPLAY_NAME_I18N_KEY: Record<CanvasNodeType, string> = {
  [CANVAS_NODE_TYPES.upload]: 'nodeDisplayName.upload',
  [CANVAS_NODE_TYPES.imageEdit]: 'nodeDisplayName.imageEdit',
  [CANVAS_NODE_TYPES.exportImage]: 'nodeDisplayName.exportImage',
  [CANVAS_NODE_TYPES.textAnnotation]: 'nodeDisplayName.textAnnotation',
  [CANVAS_NODE_TYPES.group]: 'nodeDisplayName.group',
  [CANVAS_NODE_TYPES.storyboardSplit]: 'nodeDisplayName.storyboardSplit',
  [CANVAS_NODE_TYPES.storyboardGen]: 'nodeDisplayName.storyboardGen',
  [CANVAS_NODE_TYPES.videoGen]: 'nodeDisplayName.videoGen',
  [CANVAS_NODE_TYPES.videoResult]: 'nodeDisplayName.videoResult',
};

export const EXPORT_RESULT_DISPLAY_NAME: Record<ExportImageNodeResultKind, string> = {
  generic: '结果图片',
  storyboardGenOutput: '分镜输出',
  storyboardSplitExport: '切割导出',
  storyboardFrameEdit: '分镜帧',
};

const EXPORT_RESULT_I18N_KEY: Record<ExportImageNodeResultKind, string> = {
  generic: 'nodeDisplayName.exportImage',
  storyboardGenOutput: 'nodeDisplayName.storyboardGenOutput',
  storyboardSplitExport: 'nodeDisplayName.storyboardSplitExport',
  storyboardFrameEdit: 'nodeDisplayName.storyboardFrameEdit',
};

/** Set of all hardcoded Chinese default names — used to detect "is this still a default?" */
const ALL_HARDCODED_DEFAULTS = new Set([
  ...Object.values(DEFAULT_NODE_DISPLAY_NAME),
  ...Object.values(EXPORT_RESULT_DISPLAY_NAME),
]);

function resolveExportResultDefault(data: Partial<CanvasNodeData>, t?: TranslateFn): string {
  const resultKind = (data as { resultKind?: ExportImageNodeResultKind }).resultKind ?? 'generic';
  if (t) return t(EXPORT_RESULT_I18N_KEY[resultKind]);
  return EXPORT_RESULT_DISPLAY_NAME[resultKind];
}

export function getDefaultNodeDisplayName(type: CanvasNodeType, data: Partial<CanvasNodeData>, t?: TranslateFn): string {
  if (type === CANVAS_NODE_TYPES.exportImage) {
    return resolveExportResultDefault(data, t);
  }
  if (t) return t(NODE_DISPLAY_NAME_I18N_KEY[type]);
  return DEFAULT_NODE_DISPLAY_NAME[type];
}

export function resolveNodeDisplayName(type: CanvasNodeType, data: Partial<CanvasNodeData>, t?: TranslateFn): string {
  const customTitle = typeof data.displayName === 'string' ? data.displayName.trim() : '';
  if (customTitle && !ALL_HARDCODED_DEFAULTS.has(customTitle)) {
    return customTitle;
  }

  if (type === CANVAS_NODE_TYPES.group) {
    const legacyLabel = typeof (data as { label?: string }).label === 'string'
      ? (data as { label?: string }).label?.trim()
      : '';
    if (legacyLabel && !ALL_HARDCODED_DEFAULTS.has(legacyLabel)) {
      return legacyLabel;
    }
  }

  return getDefaultNodeDisplayName(type, data, t);
}

export function isNodeUsingDefaultDisplayName(type: CanvasNodeType, data: Partial<CanvasNodeData>): boolean {
  const customTitle = typeof data.displayName === 'string' ? data.displayName.trim() : '';
  if (!customTitle || ALL_HARDCODED_DEFAULTS.has(customTitle)) {
    return true;
  }
  return customTitle === getDefaultNodeDisplayName(type, data);
}
