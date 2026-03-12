import {
  type KeyboardEvent,
  memo,
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Sparkles, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  CANVAS_NODE_TYPES,
  type VideoGenNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import {
  canvasVideoAiGateway,
  graphImageResolver,
} from '@/features/canvas/application/canvasServices';
import { resolveErrorContent, showErrorDialog } from '@/features/canvas/application/errorDialog';
import {
  resolveImageDisplayUrl,
} from '@/features/canvas/application/imageData';
import {
  findReferenceTokens,
  insertReferenceToken,
  removeTextRange,
  resolveReferenceAwareDeleteRange,
} from '@/features/canvas/application/referenceTokenEditing';
import {
  DEFAULT_VIDEO_MODEL_ID,
  getVideoModel,
  listVideoModels,
} from '@/features/canvas/models';
import {
  NODE_CONTROL_CHIP_CLASS,
  NODE_CONTROL_ICON_CLASS,
  NODE_CONTROL_MODEL_CHIP_CLASS,
  NODE_CONTROL_PARAMS_CHIP_CLASS,
  NODE_CONTROL_PRIMARY_BUTTON_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import { VideoParamsControls } from '@/features/canvas/ui/VideoParamsControls';
import { KlingElementsEditor } from '@/features/canvas/ui/KlingElementsEditor';
import { UiButton } from '@/components/ui';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';

type VideoGenNodeProps = NodeProps & {
  id: string;
  data: VideoGenNodeData;
  selected?: boolean;
};

interface PickerAnchor {
  left: number;
  top: number;
}

const PICKER_FALLBACK_ANCHOR: PickerAnchor = { left: 8, top: 8 };
const PICKER_Y_OFFSET_PX = 8;
const VIDEO_GEN_NODE_MIN_WIDTH = 420;
const VIDEO_GEN_NODE_MIN_HEIGHT = 350;
const VIDEO_GEN_NODE_MAX_WIDTH = 1400;
const VIDEO_GEN_NODE_MAX_HEIGHT = 1000;
const VIDEO_GEN_NODE_DEFAULT_WIDTH = 520;
const VIDEO_GEN_NODE_DEFAULT_HEIGHT = 480;
const VIDEO_RESULT_NODE_WIDTH = 400;
const VIDEO_RESULT_NODE_HEIGHT = 320;
const POLL_INTERVAL_MS = 3000;

function getTextareaCaretOffset(
  textarea: HTMLTextAreaElement,
  caretIndex: number
): PickerAnchor {
  const mirror = document.createElement('div');
  const computed = window.getComputedStyle(textarea);
  const mirrorStyle = mirror.style;

  mirrorStyle.position = 'absolute';
  mirrorStyle.visibility = 'hidden';
  mirrorStyle.pointerEvents = 'none';
  mirrorStyle.whiteSpace = 'pre-wrap';
  mirrorStyle.wordWrap = 'break-word';
  mirrorStyle.width = `${textarea.clientWidth}px`;
  mirrorStyle.font = computed.font;
  mirrorStyle.padding = computed.padding;
  mirrorStyle.lineHeight = computed.lineHeight;
  mirrorStyle.textAlign = computed.textAlign;
  mirrorStyle.letterSpacing = computed.letterSpacing;

  const textBeforeCaret = textarea.value.substring(0, caretIndex);
  const span = document.createElement('span');
  span.textContent = textBeforeCaret || ' ';
  mirror.appendChild(span);

  const indicator = document.createElement('span');
  indicator.textContent = '|';
  mirror.appendChild(indicator);

  document.body.appendChild(mirror);
  const indicatorRect = indicator.getBoundingClientRect();
  const textareaRect = textarea.getBoundingClientRect();
  document.body.removeChild(mirror);

  const left = indicatorRect.left - textareaRect.left + textarea.scrollLeft;
  const top = indicatorRect.top - textareaRect.top + textarea.scrollTop + PICKER_Y_OFFSET_PX;

  return { left, top };
}

function VideoGenNodeComponent({
  id,
  data,
  selected,
  width,
  height,
}: VideoGenNodeProps): JSX.Element {
  const { t } = useTranslation();
  const [promptDraft, setPromptDraft] = useState(data.prompt);
  const [error, setError] = useState<string | null>(null);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [pickerAnchor, setPickerAnchor] = useState<PickerAnchor>(PICKER_FALLBACK_ANCHOR);
  const [pickerActiveIndex, setPickerActiveIndex] = useState(0);
  const [pollingProgress, setPollingProgress] = useState(0);

  const promptRef = useRef<HTMLTextAreaElement>(null);
  const promptHighlightRef = useRef<HTMLDivElement>(null);
  const pollIntervalRef = useRef<number | null>(null);

  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const addNode = useCanvasStore((state) => state.addNode);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const findNodePosition = useCanvasStore((state) => state.findNodePosition);
  const providerApiKey = useSettingsStore((state) => state.apiKeys['kling']);

  const videoModels = useMemo(() => listVideoModels(), []);
  const selectedModel = useMemo(
    () => getVideoModel(data.model || DEFAULT_VIDEO_MODEL_ID),
    [data.model]
  );

  const incomingImages = useMemo(
    () => graphImageResolver.collectInputImages(id, nodes, edges),
    [id, nodes, edges]
  );

  const incomingImageItems = useMemo(
    () =>
      incomingImages.map((imageUrl, index) => ({
        imageUrl,
        displayUrl: resolveImageDisplayUrl(imageUrl),
        label: `${t('canvas.reference')} ${index + 1}`,
      })),
    [incomingImages, t]
  );

  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(CANVAS_NODE_TYPES.videoGen, data),
    [data]
  );

  const resolvedWidth = Math.max(
    VIDEO_GEN_NODE_MIN_WIDTH,
    Math.round(width ?? VIDEO_GEN_NODE_DEFAULT_WIDTH)
  );
  const resolvedHeight = Math.max(
    VIDEO_GEN_NODE_MIN_HEIGHT,
    Math.round(height ?? VIDEO_GEN_NODE_DEFAULT_HEIGHT)
  );

  // Cleanup polling on unmount or when generation completes
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, []);

  // Polling effect
  useEffect(() => {
    if (!data.isGenerating || !data.jobId) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      setPollingProgress(0);
      return;
    }

    const pollStatus = async () => {
      try {
        const status = await canvasVideoAiGateway.pollJobStatus(
          data.jobId!,
          data.model
        );

        if (status.state === 'completed' && status.videoUrl) {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }

          const generationDurationMs = data.generationStartedAt
            ? Date.now() - data.generationStartedAt
            : 0;

          updateNodeData(id, {
            videoUrl: status.videoUrl,
            isGenerating: false,
            generationStartedAt: null,
            generationDurationMs,
            jobId: null,
            errorMessage: null,
          });
          setError(null);
          setPollingProgress(0);

          // Create VideoResultNode downstream
          const resultNodePosition = findNodePosition(
            id,
            VIDEO_RESULT_NODE_WIDTH,
            VIDEO_RESULT_NODE_HEIGHT
          );
          const resultNodeId = addNode(
            CANVAS_NODE_TYPES.videoResult,
            resultNodePosition,
            {
              videoUrl: status.videoUrl,
              prompt: data.prompt,
              duration: data.duration,
              aspectRatio: data.aspectRatio,
            }
          );
          addEdge(id, resultNodeId);
        } else if (status.state === 'failed') {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }

          const errorMsg = status.errorMessage || t('videoErrors.generation_failed');
          updateNodeData(id, {
            isGenerating: false,
            generationStartedAt: null,
            jobId: null,
            errorMessage: errorMsg,
          });
          setError(errorMsg);
          setPollingProgress(0);
        } else if (status.state === 'timeout') {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }

          const errorMsg = t('videoErrors.job_timeout');
          updateNodeData(id, {
            isGenerating: false,
            generationStartedAt: null,
            jobId: null,
            errorMessage: errorMsg,
          });
          setError(errorMsg);
          setPollingProgress(0);
        } else {
          // Update progress estimate
          if (data.generationStartedAt && selectedModel.expectedDurationMs) {
            const elapsed = Date.now() - data.generationStartedAt;
            const progress = Math.min((elapsed / selectedModel.expectedDurationMs) * 100, 95);
            setPollingProgress(progress);
          }
        }
      } catch (pollError) {
        console.error('[VideoGenNode] Polling error:', pollError);
        // Don't stop polling on network errors, just log
      }
    };

    // Initial poll
    void pollStatus();

    // Set up interval
    pollIntervalRef.current = setInterval(() => {
      void pollStatus();
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [
    data.isGenerating,
    data.jobId,
    data.model,
    data.generationStartedAt,
    data.prompt,
    data.duration,
    data.aspectRatio,
    selectedModel.expectedDurationMs,
    id,
    updateNodeData,
    addNode,
    addEdge,
    findNodePosition,
    t,
  ]);

  const commitPromptDraft = useCallback(
    (nextPrompt: string) => {
      updateNodeData(id, { prompt: nextPrompt });
    },
    [id, updateNodeData]
  );

  const renderPromptWithHighlights = useCallback(
    (text: string, referenceCount: number): JSX.Element[] => {
      if (referenceCount === 0) {
        return [<span key="plain">{text}</span>];
      }

      const tokens = findReferenceTokens(text);
      if (tokens.length === 0) {
        return [<span key="plain">{text}</span>];
      }

      const parts: JSX.Element[] = [];
      let lastIndex = 0;

      tokens.forEach((token, tokenIndex) => {
        if (token.start > lastIndex) {
          parts.push(<span key={`text-${tokenIndex}`}>{text.slice(lastIndex, token.start)}</span>);
        }

        const isValid = token.value <= referenceCount;
        parts.push(
          <span
            key={`token-${tokenIndex}`}
            className={`rounded px-0.5 ${
              isValid
                ? 'bg-blue-500/30 text-blue-300'
                : 'bg-red-500/30 text-red-300 line-through'
            }`}
          >
            {token.token}
          </span>
        );

        lastIndex = token.end;
      });

      if (lastIndex < text.length) {
        parts.push(<span key="text-end">{text.slice(lastIndex)}</span>);
      }

      return parts;
    },
    []
  );

  const handlePromptKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      const textarea = event.currentTarget;
      const caretPosition = textarea.selectionStart;

      if (event.key === '@' && incomingImages.length > 0) {
        event.preventDefault();
        const anchor = getTextareaCaretOffset(textarea, caretPosition);
        setPickerAnchor(anchor);
        setPickerActiveIndex(0);
        setShowImagePicker(true);
        return;
      }

      if (showImagePicker) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setShowImagePicker(false);
          return;
        }

        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setPickerActiveIndex((prev) => (prev + 1) % incomingImageItems.length);
          return;
        }

        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setPickerActiveIndex(
            (prev) => (prev - 1 + incomingImageItems.length) % incomingImageItems.length
          );
          return;
        }

        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault();
          insertImageReference(pickerActiveIndex);
          return;
        }
      }

      if (event.key === 'Backspace') {
        const deleteRange = resolveReferenceAwareDeleteRange(
          promptDraft,
          caretPosition,
          caretPosition,
          'backward'
        );
        if (deleteRange) {
          event.preventDefault();
          const result = removeTextRange(promptDraft, deleteRange);
          setPromptDraft(result.nextText);
          commitPromptDraft(result.nextText);
          setTimeout(() => {
            textarea.selectionStart = result.nextCursor;
            textarea.selectionEnd = result.nextCursor;
          }, 0);
        }
      }

      if (event.key === 'Delete') {
        const deleteRange = resolveReferenceAwareDeleteRange(
          promptDraft,
          caretPosition,
          caretPosition,
          'forward'
        );
        if (deleteRange) {
          event.preventDefault();
          const result = removeTextRange(promptDraft, deleteRange);
          setPromptDraft(result.nextText);
          commitPromptDraft(result.nextText);
          setTimeout(() => {
            textarea.selectionStart = result.nextCursor;
            textarea.selectionEnd = result.nextCursor;
          }, 0);
        }
      }
    },
    [
      promptDraft,
      showImagePicker,
      incomingImages.length,
      incomingImageItems.length,
      pickerActiveIndex,
      commitPromptDraft,
    ]
  );

  const insertImageReference = useCallback(
    (imageIndex: number) => {
      if (!promptRef.current) {
        return;
      }

      const caretPosition = promptRef.current.selectionStart;
      const marker = `@图${imageIndex + 1}`;
      const result = insertReferenceToken(promptDraft, caretPosition, marker);
      setPromptDraft(result.nextText);
      commitPromptDraft(result.nextText);
      setShowImagePicker(false);

      setTimeout(() => {
        if (promptRef.current) {
          promptRef.current.selectionStart = result.nextCursor;
          promptRef.current.selectionEnd = result.nextCursor;
          promptRef.current.focus();
        }
      }, 0);
    },
    [promptDraft, commitPromptDraft]
  );

  const handleGenerate = useCallback(async () => {
    const prompt = promptDraft.trim();
    if (!prompt) {
      setError(t('node.videoGen.noPrompt'));
      return;
    }

    if (!providerApiKey) {
      setError(t('node.videoGen.noApiKey'));
      void showErrorDialog(
        t('node.videoGen.noApiKeyDetails'),
        t('common.error')
      );
      return;
    }

    setError(null);
    const generationStartedAt = Date.now();

    updateNodeData(id, {
      isGenerating: true,
      generationStartedAt,
      generationDurationMs: 0,
      errorMessage: null,
    });

    try {
      await canvasVideoAiGateway.setApiKey(selectedModel.providerId, providerApiKey);

      const { jobId } = await canvasVideoAiGateway.generateVideo({
        prompt,
        model: data.model,
        duration: data.duration,
        aspectRatio: data.aspectRatio,
        enableAudio: data.enableAudio,
        seed: data.seed ?? undefined,
        startFrameUrl: data.startFrameUrl ?? undefined,
        endFrameUrl: data.endFrameUrl ?? undefined,
        extraParams: data.extraParams,
      });

      updateNodeData(id, {
        jobId,
      });
    } catch (generationError) {
      const resolvedError = resolveErrorContent(generationError, t('videoErrors.generation_failed'));
      setError(resolvedError.message);
      void showErrorDialog(resolvedError.message, t('common.error'), resolvedError.details);
      updateNodeData(id, {
        isGenerating: false,
        generationStartedAt: null,
        jobId: null,
        errorMessage: resolvedError.message,
      });
    }
  }, [
    promptDraft,
    providerApiKey,
    incomingImages,
    selectedModel,
    data.model,
    data.duration,
    data.aspectRatio,
    data.enableAudio,
    data.seed,
    data.extraParams,
    id,
    updateNodeData,
    t,
  ]);

  const handleRetry = useCallback(() => {
    setError(null);
    updateNodeData(id, {
      errorMessage: null,
      jobId: null,
    });
  }, [id, updateNodeData]);

  const syncPromptHighlightScroll = () => {
    if (!promptRef.current || !promptHighlightRef.current) {
      return;
    }

    promptHighlightRef.current.scrollTop = promptRef.current.scrollTop;
    promptHighlightRef.current.scrollLeft = promptRef.current.scrollLeft;
  };

  const durationOptions = useMemo(
    () => selectedModel.durations.map((d) => ({ value: d.value, label: d.label })),
    [selectedModel.durations]
  );

  const aspectRatioOptions = useMemo(
    () => selectedModel.aspectRatios.map((ar) => ({ value: ar.value, label: ar.label })),
    [selectedModel.aspectRatios]
  );

  const selectedDuration = useMemo(
    () => durationOptions.find((opt) => opt.value === data.duration) ?? durationOptions[0],
    [durationOptions, data.duration]
  );

  const selectedAspectRatio = useMemo(
    () => aspectRatioOptions.find((opt) => opt.value === data.aspectRatio) ?? aspectRatioOptions[0],
    [aspectRatioOptions, data.aspectRatio]
  );

  return (
    <div
      className={`
        flex flex-col rounded-xl border-2 bg-surface-dark shadow-xl transition-all p-3
        ${
          selected
            ? 'border-accent shadow-accent/30'
            : 'border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)]'
        }
      `}
      style={{ width: `${resolvedWidth}px`, height: `${resolvedHeight}px` }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<Sparkles className="h-4 w-4" />}
        titleText={resolvedTitle}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      {/* Prompt Input */}
      <div className="relative min-h-0 flex-1 rounded-lg border border-[rgba(255,255,255,0.1)] bg-bg-dark/45 p-2">
        <div className="relative h-full min-h-0">
          <div
            ref={promptHighlightRef}
            aria-hidden="true"
            className="ui-scrollbar pointer-events-none absolute inset-0 overflow-y-auto overflow-x-hidden text-sm leading-6 text-text-dark"
            style={{ scrollbarGutter: 'stable' }}
          >
            <div className="min-h-full whitespace-pre-wrap break-words px-1 py-0.5">
              {renderPromptWithHighlights(promptDraft, incomingImages.length)}
            </div>
          </div>

          <textarea
            ref={promptRef}
            value={promptDraft}
            onChange={(event) => {
              const nextValue = event.target.value;
              setPromptDraft(nextValue);
              commitPromptDraft(nextValue);
            }}
            onKeyDown={handlePromptKeyDown}
            onScroll={syncPromptHighlightScroll}
            onMouseDown={(event) => event.stopPropagation()}
            placeholder={t('node.videoGen.promptPlaceholder')}
            className="ui-scrollbar nodrag nowheel relative z-10 h-full w-full resize-none overflow-y-auto overflow-x-hidden border-none bg-transparent px-1 py-0.5 text-sm leading-6 text-transparent caret-text-dark outline-none placeholder:text-text-muted/80 focus:border-transparent whitespace-pre-wrap break-words"
            style={{ scrollbarGutter: 'stable' }}
          />
        </div>

        {showImagePicker && incomingImageItems.length > 0 && (
          <div
            className="nowheel absolute z-30 w-[120px] overflow-hidden rounded-xl border border-[rgba(255,255,255,0.16)] bg-surface-dark shadow-xl"
            style={{ left: pickerAnchor.left, top: pickerAnchor.top }}
            onMouseDown={(event) => event.stopPropagation()}
            onWheelCapture={(event) => event.stopPropagation()}
          >
            <div
              className="ui-scrollbar nowheel max-h-[180px] overflow-y-auto"
              onWheelCapture={(event) => event.stopPropagation()}
            >
              {incomingImageItems.map((item, index) => (
                <button
                  key={`${item.imageUrl}-${index}`}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    insertImageReference(index);
                  }}
                  onMouseEnter={() => setPickerActiveIndex(index)}
                  className={`flex w-full items-center gap-2 border border-transparent bg-bg-dark/70 px-2 py-2 text-left text-sm text-text-dark transition-colors hover:border-[rgba(255,255,255,0.18)] ${
                    pickerActiveIndex === index
                      ? 'border-[rgba(255,255,255,0.24)] bg-bg-dark'
                      : ''
                  }`}
                >
                  <img
                    src={item.displayUrl}
                    alt={item.label}
                    className="h-8 w-8 rounded object-cover"
                    draggable={false}
                  />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Frame Selection */}
      {incomingImages.length > 0 && !data.isGenerating && (
        <div className="mt-2 rounded-lg border border-[rgba(255,255,255,0.1)] bg-bg-dark/45 p-3">
          <div className="mb-2 text-xs font-medium text-text-muted">
            {t('node.videoGen.frameSelection')}
          </div>
          <div className="flex gap-3">
            {/* Start Frame */}
            <div className="flex-1">
              <div className="mb-1.5 text-xs text-text-muted">{t('node.videoGen.startFrame')}</div>
              <div className="grid grid-cols-2 gap-2">
                {incomingImageItems.map((item, index) => {
                  const isSelected = data.startFrameUrl === item.imageUrl;
                  return (
                    <button
                      key={`start-${index}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        updateNodeData(id, {
                          startFrameUrl: isSelected ? null : item.imageUrl,
                        });
                      }}
                      className={`relative aspect-video rounded-lg border-2 overflow-hidden transition-all ${
                        isSelected
                          ? 'border-accent ring-2 ring-accent/30'
                          : 'border-[rgba(255,255,255,0.15)] hover:border-[rgba(255,255,255,0.3)]'
                      }`}
                    >
                      <img
                        src={item.displayUrl}
                        alt={item.label}
                        className="h-full w-full object-cover"
                      />
                      {isSelected && (
                        <div className="absolute inset-0 bg-accent/20 flex items-center justify-center">
                          <div className="h-5 w-5 rounded-full bg-accent flex items-center justify-center">
                            <span className="text-white text-xs font-bold">✓</span>
                          </div>
                        </div>
                      )}
                      <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5 text-[10px] text-white">
                        {item.label}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* End Frame */}
            <div className="flex-1">
              <div className="mb-1.5 text-xs text-text-muted">
                {t('node.videoGen.endFrame')}
                <span className="ml-1 text-[10px] text-text-muted/60">
                  ({t('node.videoGen.optional')})
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {incomingImageItems.map((item, index) => {
                  const isSelected = data.endFrameUrl === item.imageUrl;
                  return (
                    <button
                      key={`end-${index}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        updateNodeData(id, {
                          endFrameUrl: isSelected ? null : item.imageUrl,
                        });
                      }}
                      className={`relative aspect-video rounded-lg border-2 overflow-hidden transition-all ${
                        isSelected
                          ? 'border-accent ring-2 ring-accent/30'
                          : 'border-[rgba(255,255,255,0.15)] hover:border-[rgba(255,255,255,0.3)]'
                      }`}
                    >
                      <img
                        src={item.displayUrl}
                        alt={item.label}
                        className="h-full w-full object-cover"
                      />
                      {isSelected && (
                        <div className="absolute inset-0 bg-accent/20 flex items-center justify-center">
                          <div className="h-5 w-5 rounded-full bg-accent flex items-center justify-center">
                            <span className="text-white text-xs font-bold">✓</span>
                          </div>
                        </div>
                      )}
                      <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5 text-[10px] text-white">
                        {item.label}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Video Preview */}
      {data.videoUrl && !data.isGenerating && (
        <div className="mt-2 rounded-lg border border-[rgba(255,255,255,0.1)] bg-bg-dark/45 p-2">
          <video
            src={data.videoUrl}
            controls
            className="h-auto w-full rounded"
            style={{ maxHeight: '240px' }}
          />
        </div>
      )}

      {/* Generation Progress */}
      {data.isGenerating && (
        <div className="mt-2 rounded-lg border border-[rgba(255,255,255,0.1)] bg-bg-dark/45 p-3">
          <div className="mb-2 flex items-center justify-between text-sm text-text-muted">
            <span>{t('node.videoGen.generating')}</span>
            <span>{Math.round(pollingProgress)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-bg-dark">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${pollingProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="mt-2 flex shrink-0 flex-col gap-3">
        <div className="flex items-center gap-1.5">
          <VideoParamsControls
            videoModels={videoModels}
            selectedModel={selectedModel}
            selectedDuration={selectedDuration}
            selectedAspectRatio={selectedAspectRatio}
            durationOptions={durationOptions}
            aspectRatioOptions={aspectRatioOptions}
            onModelChange={(modelId) => {
              updateNodeData(id, { model: modelId });
            }}
            onDurationChange={(duration) => {
              updateNodeData(id, { duration });
            }}
            onAspectRatioChange={(aspectRatio) => {
              updateNodeData(id, { aspectRatio });
            }}
            triggerSize="sm"
            chipClassName={NODE_CONTROL_CHIP_CLASS}
            modelChipClassName={NODE_CONTROL_MODEL_CHIP_CLASS}
            paramsChipClassName={NODE_CONTROL_PARAMS_CHIP_CLASS}
          />

          <div className="ml-auto" />

          {/* Generate/Retry Button */}
          {!data.isGenerating && (
            <UiButton
              onClick={(event) => {
                event.stopPropagation();
                if (error || data.errorMessage) {
                  handleRetry();
                } else {
                  void handleGenerate();
                }
              }}
              variant="primary"
              className={`shrink-0 ${NODE_CONTROL_PRIMARY_BUTTON_CLASS}`}
            >
              {error || data.errorMessage ? (
                <>
                  <RefreshCw className={NODE_CONTROL_ICON_CLASS} strokeWidth={2.8} />
                  {t('node.videoGen.retry')}
                </>
              ) : (
                <>
                  <Sparkles className={NODE_CONTROL_ICON_CLASS} strokeWidth={2.8} />
                  {t('node.videoGen.generate')}
                </>
              )}
            </UiButton>
          )}
        </div>

        {/* Audio Toggle and Seed (if supported) */}
        {(selectedModel.supportsAudio || selectedModel.supportsSeed) && (
          <div className="flex items-center gap-3 text-xs">
            {selectedModel.supportsAudio && (
              <label
                className="flex items-center gap-1.5 text-text-muted cursor-pointer hover:text-text-dark transition-colors"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={data.enableAudio}
                  onChange={(e) => {
                    e.stopPropagation();
                    updateNodeData(id, { enableAudio: e.target.checked });
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="rounded border-[rgba(255,255,255,0.2)] bg-bg-dark/45 text-accent focus:ring-accent focus:ring-offset-0"
                />
                <span>{t('node.videoGen.enableAudio')}</span>
              </label>
            )}

            {selectedModel.supportsSeed && (
              <div className="flex items-center gap-1.5">
                <label className="text-text-muted">{t('node.videoGen.seed')}:</label>
                <input
                  type="number"
                  value={data.seed ?? ''}
                  onChange={(e) => {
                    e.stopPropagation();
                    const value = e.target.value;
                    updateNodeData(id, { seed: value ? Number(value) : null });
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  placeholder="123"
                  className="nodrag w-20 rounded border border-[rgba(255,255,255,0.15)] bg-bg-dark/60 px-2 py-1 text-xs text-text-dark placeholder:text-text-muted/50 focus:border-accent focus:outline-none"
                />
              </div>
            )}
          </div>
        )}

        {/* Extra Parameters */}
        {selectedModel.extraParamsSchema && selectedModel.extraParamsSchema.length > 0 && (
          <div className="flex flex-col gap-2.5 text-xs">
            {selectedModel.extraParamsSchema.map((param) => {
              if (param.type === 'boolean') {
                return (
                  <label
                    key={param.key}
                    className="flex items-center gap-1.5 text-text-muted cursor-pointer hover:text-text-dark transition-colors"
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(data.extraParams?.[param.key] ?? param.defaultValue)}
                      onChange={(e) => {
                        e.stopPropagation();
                        updateNodeData(id, {
                          extraParams: {
                            ...(data.extraParams ?? {}),
                            [param.key]: e.target.checked,
                          },
                        });
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="rounded border-[rgba(255,255,255,0.2)] bg-bg-dark/45 text-accent focus:ring-accent focus:ring-offset-0"
                    />
                    <span>{param.label}</span>
                    {param.description && (
                      <span className="text-text-muted/60">({param.description})</span>
                    )}
                  </label>
                );
              }

              if (param.type === 'string') {
                return (
                  <div key={param.key} className="flex items-center gap-1.5">
                    <label className="text-text-muted">{param.label}:</label>
                    <input
                      type="text"
                      value={(data.extraParams?.[param.key] as string | undefined) ?? ''}
                      onChange={(e) => {
                        e.stopPropagation();
                        updateNodeData(id, {
                          extraParams: {
                            ...(data.extraParams ?? {}),
                            [param.key]: e.target.value,
                          },
                        });
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      placeholder={param.description || ''}
                      className="nodrag flex-1 rounded border border-[rgba(255,255,255,0.15)] bg-bg-dark/60 px-2 py-1 text-xs text-text-dark placeholder:text-text-muted/50 focus:border-accent focus:outline-none"
                    />
                  </div>
                );
              }

              if (param.type === 'array' && param.key === 'kling_elements') {
                return (
                  <div key={param.key}>
                    <KlingElementsEditor
                      elements={(data.extraParams?.[param.key] as any[]) ?? []}
                      incomingImages={incomingImageItems}
                      onChange={(elements) => {
                        updateNodeData(id, {
                          extraParams: {
                            ...(data.extraParams ?? {}),
                            [param.key]: elements,
                          },
                        });
                      }}
                    />
                  </div>
                );
              }

              return null;
            })}
          </div>
        )}
      </div>

      {error && (
        <div className="mt-1 shrink-0 text-xs text-red-400">{error}</div>
      )}

      <Handle
        type="target"
        id="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-surface-dark !bg-accent"
      />
      <Handle
        type="source"
        id="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-surface-dark !bg-accent"
      />

      <NodeResizeHandle
        minWidth={VIDEO_GEN_NODE_MIN_WIDTH}
        minHeight={VIDEO_GEN_NODE_MIN_HEIGHT}
        maxWidth={VIDEO_GEN_NODE_MAX_WIDTH}
        maxHeight={VIDEO_GEN_NODE_MAX_HEIGHT}
      />
    </div>
  );
}

export const VideoGenNode = memo(VideoGenNodeComponent);
