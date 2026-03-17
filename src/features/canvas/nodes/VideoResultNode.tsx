import { memo, useState, useMemo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Download, Video, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { CANVAS_NODE_TYPES, type VideoResultNodeData } from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { showErrorDialog } from '@/features/canvas/application/errorDialog';
import { UiButton } from '@/components/ui';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { DEFAULT_VIDEO_MODEL_ID } from '@/features/canvas/models';

type VideoResultNodeProps = NodeProps & {
  id: string;
  data: VideoResultNodeData;
  selected?: boolean;
};

const VIDEO_RESULT_NODE_WIDTH = 400;
const VIDEO_RESULT_NODE_HEIGHT = 320;
const VIDEO_GEN_NODE_WIDTH = 520;
const VIDEO_GEN_NODE_HEIGHT = 480;

function VideoResultNodeComponent({
  id,
  data,
  selected,
}: VideoResultNodeProps): JSX.Element {
  const { t } = useTranslation();
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const edges = useCanvasStore((state) => state.edges);
  const addNode = useCanvasStore((state) => state.addNode);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const findNodePosition = useCanvasStore((state) => state.findNodePosition);
  const videoDownloadPresetPaths = useSettingsStore((state) => state.videoDownloadPresetPaths);
  const [downloading, setDownloading] = useState(false);

  const resolvedTitle = resolveNodeDisplayName(CANVAS_NODE_TYPES.videoResult, data, t);

  // Find source nodes (image inputs)
  const sourceNodeIds = useMemo(() => {
    // Find the VideoGenNode that created this result
    const incomingEdges = edges.filter((edge) => edge.target === id);
    if (incomingEdges.length === 0) return [];

    const videoGenNodeId = incomingEdges[0].source;

    // Find the edges going into the VideoGenNode
    const videoGenIncomingEdges = edges.filter((edge) => edge.target === videoGenNodeId);
    return videoGenIncomingEdges.map((edge) => edge.source);
  }, [id, edges]);

  const handleDownload = async (targetPath?: string) => {
    if (!data.videoUrl || downloading) return;

    setDownloading(true);
    try {
      const url = data.videoUrl;
      const filename = `video_${Date.now()}.mp4`;

      if (targetPath) {
        // Download to specific path via Tauri
        const { downloadVideoToDirectory } = await import('@/commands/video');
        const { join } = await import('@tauri-apps/api/path');
        const fullPath = await join(targetPath, filename);
        await downloadVideoToDirectory(url, fullPath, true);
        console.log('[VideoResultNode] Downloaded to:', fullPath);
      } else {
        // Browser download using fetch + blob (works with CORS)
        console.log('[VideoResultNode] Starting browser download:', url);
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch video: ${response.statusText}`);
        }

        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Clean up blob URL after a delay
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

        console.log('[VideoResultNode] Browser download initiated');
      }
    } catch (error) {
      console.error('[VideoResultNode] Failed to download video:', error);
      void showErrorDialog(
        error instanceof Error ? error.message : 'Failed to download video',
        t('common.error')
      );
    } finally {
      setDownloading(false);
    }
  };

  const handleRegenerate = () => {
    if (!data.prompt) {
      void showErrorDialog(
        'Cannot regenerate: prompt not available',
        t('common.error')
      );
      return;
    }

    // Create a new VideoGenNode with the same parameters
    const newPosition = findNodePosition(
      id,
      VIDEO_GEN_NODE_WIDTH,
      VIDEO_GEN_NODE_HEIGHT
    );

    const newNodeId = addNode(
      CANVAS_NODE_TYPES.videoGen,
      newPosition,
      {
        prompt: data.prompt,
        model: data.model || DEFAULT_VIDEO_MODEL_ID,
        duration: data.duration || 5,
        aspectRatio: data.aspectRatio || '16:9',
        enableAudio: data.enableAudio ?? true,
        seed: data.seed ?? null,
        extraParams: data.extraParams || {},
        videoUrl: null,
        thumbnailUrl: null,
        referenceImageUrl: null,
        startFrameUrl: data.startFrameUrl ?? null,
        endFrameUrl: data.endFrameUrl ?? null,
        isGenerating: false,
        generationStartedAt: null,
        generationDurationMs: 0,
        jobId: null,
        errorMessage: null,
      }
    );

    // Connect the same source nodes to the new VideoGenNode
    sourceNodeIds.forEach((sourceId) => {
      addEdge(sourceId, newNodeId);
    });

    console.log('[VideoResultNode] Created new VideoGenNode:', newNodeId);
  };

  return (
    <div
      className={`
        flex flex-col rounded-xl border-2 bg-surface-dark shadow-xl transition-all p-3
        ${
          selected
            ? 'border-accent shadow-accent/30'
            : 'border-[rgba(15,23,42,0.45)] hover:border-[rgba(15,23,42,0.58)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)]'
        }
      `}
      style={{ width: `${VIDEO_RESULT_NODE_WIDTH}px`, height: `${VIDEO_RESULT_NODE_HEIGHT}px` }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<Video className="h-4 w-4" />}
        titleText={resolvedTitle}
        editable={false}
      />

      {/* Video Preview */}
      <div className="relative min-h-0 flex-1 rounded-lg border border-[rgba(15,23,42,0.15)] dark:border-[rgba(255,255,255,0.1)] bg-bg-dark/45 overflow-hidden">
        <video
          src={data.videoUrl}
          controls
          className="h-full w-full object-contain"
        />
      </div>

      {/* Download and Regenerate Controls */}
      <div className="mt-2 flex shrink-0 items-center gap-2">
        {videoDownloadPresetPaths.length > 0 ? (
          <div className="flex items-center gap-1.5 flex-wrap">
            {videoDownloadPresetPaths.slice(0, 3).map((path, index) => (
              <UiButton
                key={index}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleDownload(path);
                }}
                variant="muted"
                size="sm"
                className="text-xs"
                disabled={downloading}
              >
                <Download className="h-3 w-3" />
                {downloading ? 'Downloading...' : path.split(/[/\\]/).pop() || `Path ${index + 1}`}
              </UiButton>
            ))}
            {videoDownloadPresetPaths.length > 3 && (
              <span className="text-xs text-text-muted">
                +{videoDownloadPresetPaths.length - 3} more
              </span>
            )}
          </div>
        ) : (
          <UiButton
            onClick={(e) => {
              e.stopPropagation();
              void handleDownload();
            }}
            variant="primary"
            size="sm"
            disabled={downloading}
          >
            <Download className="h-4 w-4" />
            {downloading ? 'Downloading...' : t('node.videoGen.download')}
          </UiButton>
        )}

        {/* Regenerate Button - aligned to right */}
        {data.prompt && (
          <UiButton
            onClick={(e) => {
              e.stopPropagation();
              handleRegenerate();
            }}
            variant="muted"
            size="sm"
            className="ml-auto text-xs"
          >
            <RefreshCw className="h-3 w-3" />
            {t('node.videoGen.regenerate')}
          </UiButton>
        )}
      </div>

      <Handle
        type="target"
        id="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-surface-dark !bg-accent"
      />
    </div>
  );
}

export const VideoResultNode = memo(VideoResultNodeComponent);
