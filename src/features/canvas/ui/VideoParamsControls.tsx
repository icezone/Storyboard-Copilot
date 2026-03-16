import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SlidersHorizontal, Video } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { getModelProvider, type VideoModelDefinition } from '@/features/canvas/models';
import { UiChipButton, UiModal, UiPanel, UiButton, UiSelect, UiCheckbox } from '@/components/ui';
import { KlingElementsEditor } from '@/features/canvas/ui/KlingElementsEditor';
import { useSettingsStore } from '@/stores/settingsStore';
import { openSettingsDialog } from '@/features/settings/settingsEvents';

interface DurationOption {
  value: number;
  label: string;
}

interface AspectRatioOption {
  value: string;
  label: string;
}

interface IncomingImageItem {
  imageUrl: string;
  displayUrl: string;
  label: string;
}

interface VideoParamsControlsProps {
  videoModels: VideoModelDefinition[];
  selectedModel: VideoModelDefinition;
  selectedDuration: DurationOption | undefined;
  selectedAspectRatio: AspectRatioOption;
  durationOptions: DurationOption[];
  aspectRatioOptions: AspectRatioOption[];
  onModelChange: (modelId: string) => void;
  onDurationChange: (duration: number) => void;
  onAspectRatioChange: (aspectRatio: string) => void;
  extraParams?: Record<string, unknown>;
  onExtraParamChange?: (key: string, value: boolean | number | string | unknown) => void;
  incomingImages?: IncomingImageItem[];
  enableAudio?: boolean;
  onEnableAudioChange?: (enabled: boolean) => void;
  seed?: number | null;
  onSeedChange?: (seed: number | null) => void;
  klingElements?: unknown[];
  onKlingElementsChange?: (elements: unknown[]) => void;
  showProviderName?: boolean;
  triggerSize?: 'md' | 'sm';
  chipClassName?: string;
  modelChipClassName?: string;
  paramsChipClassName?: string;
  modelPanelAlign?: 'center' | 'start';
  paramsPanelAlign?: 'center' | 'start';
  modelPanelClassName?: string;
  paramsPanelClassName?: string;
}

interface PanelAnchor {
  left: number;
  top: number;
}

function VideoIcon({ className = '' }: { className?: string }) {
  return <Video className={className} />;
}

function getRatioPreviewStyle(ratio: string): { width: number; height: number } {
  const [rawW, rawH] = ratio.split(':').map((value) => Number(value));
  const width = Number.isFinite(rawW) && rawW > 0 ? rawW : 1;
  const height = Number.isFinite(rawH) && rawH > 0 ? rawH : 1;

  const box = 20;
  if (width >= height) {
    return {
      width: box,
      height: Math.max(8, Math.round((box * height) / width)),
    };
  }

  return {
    width: Math.max(8, Math.round((box * width) / height)),
    height: box,
  };
}

export const VideoParamsControls = memo(({
  videoModels,
  selectedModel,
  selectedDuration,
  selectedAspectRatio,
  durationOptions,
  aspectRatioOptions,
  onModelChange,
  onDurationChange,
  onAspectRatioChange,
  extraParams,
  onExtraParamChange,
  incomingImages = [],
  enableAudio = true,
  onEnableAudioChange,
  seed = null,
  onSeedChange,
  klingElements = [],
  onKlingElementsChange,
  showProviderName = true,
  triggerSize = 'md',
  chipClassName = '',
  modelChipClassName = 'w-auto justify-start',
  paramsChipClassName = 'w-auto justify-start',
  modelPanelAlign = 'center',
  paramsPanelAlign = 'center',
  modelPanelClassName = 'w-[360px] p-2',
  paramsPanelClassName = 'w-[420px] p-3',
}: VideoParamsControlsProps) => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const modelTriggerRef = useRef<HTMLDivElement>(null);
  const paramsTriggerRef = useRef<HTMLDivElement>(null);
  const otherParamsTriggerRef = useRef<HTMLDivElement>(null);
  const modelPanelRef = useRef<HTMLDivElement>(null);
  const paramsPanelRef = useRef<HTMLDivElement>(null);
  const otherParamsPanelRef = useRef<HTMLDivElement>(null);
  const [openPanel, setOpenPanel] = useState<'model' | 'params' | 'otherParams' | null>(null);
  const [renderPanel, setRenderPanel] = useState<'model' | 'params' | 'otherParams' | null>(null);
  const [isPanelVisible, setIsPanelVisible] = useState(false);
  const [modelPanelAnchor, setModelPanelAnchor] = useState<PanelAnchor | null>(null);
  const [paramsPanelAnchor, setParamsPanelAnchor] = useState<PanelAnchor | null>(null);
  const [otherParamsPanelAnchor, setOtherParamsPanelAnchor] = useState<PanelAnchor | null>(null);
  const [modelAnchorBaseWidth, setModelAnchorBaseWidth] = useState<number | null>(null);
  const [paramsAnchorBaseWidth, setParamsAnchorBaseWidth] = useState<number | null>(null);
  const [otherParamsAnchorBaseWidth, setOtherParamsAnchorBaseWidth] = useState<number | null>(null);
  const [panelProviderId, setPanelProviderId] = useState(selectedModel.providerId);
  const [missingKeyProviderName, setMissingKeyProviderName] = useState<string | null>(null);
  const apiKeys = useSettingsStore((state) => state.apiKeys);

  const extraParamSchema = selectedModel.extraParamsSchema ?? [];
  const extraParamSchemaWithoutElements = extraParamSchema.filter(def => def.key !== 'kling_elements');
  const hasKlingElements = incomingImages.length > 0 && extraParamSchema.some(def => def.key === 'kling_elements');
  const hasOtherParamsPanel = extraParamSchemaWithoutElements.length > 0 || selectedModel.supportsAudio || selectedModel.supportsSeed || hasKlingElements;

  // Translate extra param labels and descriptions
  const translateParam = (key: string, type: 'label' | 'description' | 'option', value?: string): string => {
    // For mode parameter
    if (key === 'mode') {
      if (type === 'label') return t('modelParams.mode');
      if (type === 'description') return t('modelParams.modeDescription');
      if (type === 'option' && value === 'std') return t('modelParams.modeStandard');
      if (type === 'option' && value === 'pro') return t('modelParams.modeProfessional');
    }
    // For multi_shots parameter
    if (key === 'multi_shots') {
      if (type === 'label') return t('modelParams.multiShots');
      if (type === 'description') return t('modelParams.multiShotsDescription');
    }
    // Fallback to original value (for any unknown parameters)
    return value ?? '';
  };

  const selectedProvider = useMemo(
    () => getModelProvider(selectedModel.providerId),
    [selectedModel.providerId]
  );
  const selectedModelName = useMemo(
    () => selectedModel.displayName.replace(/\s*\([^)]*\)\s*$/u, '').trim() || selectedModel.displayName,
    [selectedModel.displayName]
  );
  const selectedProviderName = selectedProvider.label || selectedProvider.name;
  const providerOptions = useMemo(() => {
    const uniqueProviderIds = Array.from(new Set(videoModels.map((model) => model.providerId)));
    return uniqueProviderIds.map((providerId) => getModelProvider(providerId));
  }, [videoModels]);
  const providerModels = useMemo(
    () => videoModels.filter((model) => model.providerId === panelProviderId),
    [videoModels, panelProviderId]
  );
  const modelGroups = useMemo(() => {
    const grouped = new Map<string, VideoModelDefinition[]>();
    providerModels.forEach((model) => {
      const normalizedName = model.displayName.replace(/\s*\([^)]*\)\s*$/u, '').trim();
      const key = normalizedName.length > 0 ? normalizedName : model.displayName;
      const current = grouped.get(key) ?? [];
      current.push(model);
      grouped.set(key, current);
    });
    return Array.from(grouped.entries())
      .map(([name, models]) => ({ name, models }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [providerModels]);
  const isCompactTrigger = triggerSize === 'sm';
  const modelIconClassName = isCompactTrigger ? 'h-3 w-3 shrink-0' : 'h-4 w-4 shrink-0';
  const paramsIconClassName = isCompactTrigger ? 'h-2.5 w-2.5 shrink-0' : 'h-4 w-4 shrink-0';
  const modelTextClassName = isCompactTrigger
    ? 'min-w-0 truncate text-[10px] font-medium leading-none'
    : 'min-w-0 truncate font-medium';
  const providerTextClassName = isCompactTrigger
    ? 'shrink-0 text-[10px] leading-none text-text-muted/80'
    : 'shrink-0 text-text-muted/80';
  const paramsPrimaryTextClassName = isCompactTrigger
    ? 'truncate text-[10px] leading-none'
    : 'truncate';
  const paramsSecondaryTextClassName = isCompactTrigger
    ? 'text-[10px] leading-none text-text-muted/80'
    : 'text-text-muted/80';

  useEffect(() => {
    const animationDurationMs = 200;
    let enterRaf1: number | null = null;
    let enterRaf2: number | null = null;
    let switchTimer: ReturnType<typeof setTimeout> | null = null;

    const startEnterAnimation = () => {
      enterRaf1 = requestAnimationFrame(() => {
        enterRaf2 = requestAnimationFrame(() => {
          setIsPanelVisible(true);
        });
      });
    };

    if (!openPanel) {
      setIsPanelVisible(false);
      switchTimer = setTimeout(() => setRenderPanel(null), animationDurationMs);
      return () => {
        if (switchTimer) {
          clearTimeout(switchTimer);
        }
        if (enterRaf1) {
          cancelAnimationFrame(enterRaf1);
        }
        if (enterRaf2) {
          cancelAnimationFrame(enterRaf2);
        }
      };
    }

    if (renderPanel && renderPanel !== openPanel) {
      setIsPanelVisible(false);
      switchTimer = setTimeout(() => {
        setRenderPanel(openPanel);
        startEnterAnimation();
      }, animationDurationMs);
      return () => {
        if (switchTimer) {
          clearTimeout(switchTimer);
        }
        if (enterRaf1) {
          cancelAnimationFrame(enterRaf1);
        }
        if (enterRaf2) {
          cancelAnimationFrame(enterRaf2);
        }
      };
    }

    if (!renderPanel) {
      setRenderPanel(openPanel);
    }
    startEnterAnimation();

    return () => {
      if (switchTimer) {
        clearTimeout(switchTimer);
      }
      if (enterRaf1) {
        cancelAnimationFrame(enterRaf1);
      }
      if (enterRaf2) {
        cancelAnimationFrame(enterRaf2);
      }
    };
  }, [openPanel, renderPanel]);

  useEffect(() => {
    const handleOutside = (event: MouseEvent) => {
      const target = event.target as globalThis.Node;
      if (containerRef.current?.contains(target)) {
        return;
      }
      if (modelPanelRef.current?.contains(target)) {
        return;
      }
      if (paramsPanelRef.current?.contains(target)) {
        return;
      }
      if (otherParamsPanelRef.current?.contains(target)) {
        return;
      }
      // Check if click is inside a UiSelect dropdown menu
      if (target instanceof Element) {
        const selectMenu = target.closest('[id^="ui-select-"]');
        if (selectMenu) {
          return;
        }
      }
      setOpenPanel(null);
    };

    document.addEventListener('mousedown', handleOutside, true);
    return () => {
      document.removeEventListener('mousedown', handleOutside, true);
    };
  }, []);

  const getPanelAnchor = (
    triggerElement: HTMLDivElement | null,
    align: 'center' | 'start',
    baseWidth?: number | null
  ): PanelAnchor | null => {
    if (!triggerElement) {
      return null;
    }
    const rect = triggerElement.getBoundingClientRect();
    const anchorWidth = typeof baseWidth === 'number' && baseWidth > 0 ? baseWidth : rect.width;
    return {
      left: align === 'center' ? rect.left + anchorWidth / 2 : rect.left,
      top: rect.top - 8,
    };
  };

  const buildPanelStyle = (
    anchor: PanelAnchor | null,
    align: 'center' | 'start'
  ): React.CSSProperties | undefined => {
    if (!anchor) {
      return undefined;
    }

    const xTransform = align === 'center' ? 'translateX(-50%) ' : '';
    return {
      left: anchor.left,
      top: anchor.top,
      transform: `${xTransform}translateY(-100%)`,
    };
  };

  return (
    <div ref={containerRef} className="flex items-center gap-1">
      <div ref={modelTriggerRef} className="relative flex">
        <UiChipButton
          active={openPanel === 'model'}
          className={`${chipClassName} ${modelChipClassName}`}
          onClick={(event) => {
            event.stopPropagation();
            if (openPanel === 'model') {
              setOpenPanel(null);
              return;
            }
            setPanelProviderId(selectedModel.providerId);
            const triggerWidth = modelTriggerRef.current?.getBoundingClientRect().width ?? null;
            const nextBaseWidth = modelAnchorBaseWidth ?? triggerWidth;
            if (modelAnchorBaseWidth == null && triggerWidth) {
              setModelAnchorBaseWidth(triggerWidth);
            }
            setModelPanelAnchor(getPanelAnchor(modelTriggerRef.current, modelPanelAlign, nextBaseWidth));
            setOpenPanel('model');
          }}
        >
          <VideoIcon className={modelIconClassName} />
          <span className={modelTextClassName}>{selectedModelName}</span>
          {showProviderName && (
            <span className={providerTextClassName}>{selectedProviderName}</span>
          )}
        </UiChipButton>
      </div>

      <div ref={paramsTriggerRef} className="relative flex">
        <UiChipButton
          active={openPanel === 'params'}
          className={`${chipClassName} ${paramsChipClassName}`}
          onClick={(event) => {
            event.stopPropagation();
            if (openPanel === 'params') {
              setOpenPanel(null);
              return;
            }
            const triggerWidth = paramsTriggerRef.current?.getBoundingClientRect().width ?? null;
            const nextBaseWidth = paramsAnchorBaseWidth ?? triggerWidth;
            if (paramsAnchorBaseWidth == null && triggerWidth) {
              setParamsAnchorBaseWidth(triggerWidth);
            }
            setParamsPanelAnchor(getPanelAnchor(paramsTriggerRef.current, paramsPanelAlign, nextBaseWidth));
            setOpenPanel('params');
          }}
        >
          <SlidersHorizontal className={paramsIconClassName} />
          <span className={paramsPrimaryTextClassName}>{selectedAspectRatio.label}</span>
          {selectedDuration && (
            <span className={paramsSecondaryTextClassName}>· {selectedDuration.label}</span>
          )}
        </UiChipButton>
      </div>

      {hasOtherParamsPanel && (
        <div ref={otherParamsTriggerRef} className="relative flex">
          <UiChipButton
            active={openPanel === 'otherParams'}
            className={`${chipClassName} w-auto shrink-0 justify-center`}
            onClick={(event) => {
              event.stopPropagation();
              if (openPanel === 'otherParams') {
                setOpenPanel(null);
                return;
              }
              const triggerWidth = otherParamsTriggerRef.current?.getBoundingClientRect().width ?? null;
              const nextBaseWidth = otherParamsAnchorBaseWidth ?? triggerWidth;
              if (otherParamsAnchorBaseWidth == null && triggerWidth) {
                setOtherParamsAnchorBaseWidth(triggerWidth);
              }
              setOtherParamsPanelAnchor(
                getPanelAnchor(otherParamsTriggerRef.current, 'center', nextBaseWidth)
              );
              setOpenPanel('otherParams');
            }}
          >
            <SlidersHorizontal className={paramsIconClassName} />
            <span className={paramsPrimaryTextClassName}>{t('modelParams.otherParams')}</span>
          </UiChipButton>
        </div>
      )}

      {typeof document !== 'undefined' && renderPanel === 'model' && createPortal(
        <div
          ref={modelPanelRef}
          className={`fixed z-[80] transition-opacity duration-200 ease-out ${isPanelVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          style={buildPanelStyle(modelPanelAnchor, modelPanelAlign)}
        >
          <UiPanel className={modelPanelClassName}>
            <div className="ui-scrollbar max-h-[340px] space-y-4 overflow-y-auto p-1">
              <section>
                <div className="mb-2 text-xs font-medium text-text-muted">
                  {t('modelParams.provider')}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {providerOptions.map((provider) => {
                    const active = provider.id === panelProviderId;
                    return (
                      <button
                        key={provider.id}
                        className={`h-9 rounded-lg border px-3 text-xs transition-colors ${active
                          ? 'border-accent/50 bg-accent/15 text-text-dark'
                          : 'border-[rgba(255,255,255,0.12)] bg-bg-dark/65 text-text-muted hover:border-[rgba(255,255,255,0.2)]'
                          }`}
                        onClick={(event) => {
                          event.stopPropagation();
                          const providerApiKey = (apiKeys[provider.id] ?? '').trim();
                          if (!providerApiKey) {
                            setOpenPanel(null);
                            setMissingKeyProviderName(provider.label || provider.name);
                            return;
                          }
                          if (provider.id !== panelProviderId) {
                            const firstModel = videoModels.find((model) => model.providerId === provider.id);
                            if (firstModel) {
                              onModelChange(firstModel.id);
                            }
                          }
                          setPanelProviderId(provider.id);
                        }}
                      >
                        {provider.label || provider.name}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section>
                <div className="mb-2 text-xs font-medium text-text-muted">
                  {t('modelParams.model')}
                </div>
                <div className="flex flex-wrap gap-2">
                  {modelGroups.map((group) => {
                    const active = group.models.some((model) => model.id === selectedModel.id);
                    const targetModel = group.models.find((model) => model.id === selectedModel.id)
                      ?? group.models[0];
                    return (
                      <button
                        key={group.name}
                        className={`flex h-9 w-[120px] items-center justify-center rounded-lg border px-3 text-center text-xs transition-colors ${active
                          ? 'border-accent/50 bg-accent/15 text-text-dark'
                          : 'border-[rgba(255,255,255,0.12)] bg-bg-dark/65 text-text-muted hover:border-[rgba(255,255,255,0.2)]'
                          }`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onModelChange(targetModel.id);
                          setOpenPanel(null);
                        }}
                      >
                        <span className="truncate">{group.name}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>
          </UiPanel>
        </div>,
        document.body
      )}

      {typeof document !== 'undefined' && renderPanel === 'params' && createPortal(
        <div
          ref={paramsPanelRef}
          className={`fixed z-[80] transition-opacity duration-200 ease-out ${isPanelVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          style={buildPanelStyle(paramsPanelAnchor, paramsPanelAlign)}
        >
          <UiPanel className={paramsPanelClassName}>
            {durationOptions.length > 0 && (
              <div>
                <div className="mb-2 text-xs text-text-muted">{t('node.videoGen.duration')}</div>
                <div className="grid grid-cols-4 gap-1 rounded-xl border border-[rgba(255,255,255,0.1)] bg-bg-dark/65 p-1">
                  {durationOptions.map((item) => {
                    const active = item.value === selectedDuration?.value;
                    return (
                      <button
                        key={item.value}
                        className={`h-8 rounded-lg text-sm transition-colors ${active
                          ? 'bg-surface-dark text-text-dark'
                          : 'text-text-muted hover:bg-bg-dark'
                          }`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onDurationChange(item.value);
                        }}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className={durationOptions.length > 0 ? 'mt-3' : ''}>
              <div className="mb-2 text-xs text-text-muted">{t('modelParams.aspectRatio')}</div>
              <div className="grid grid-cols-5 gap-1 rounded-xl border border-[rgba(255,255,255,0.1)] bg-bg-dark/65 p-1">
                {aspectRatioOptions.map((item) => {
                  const active = item.value === selectedAspectRatio.value;
                  const previewStyle = getRatioPreviewStyle(item.value);

                  return (
                    <button
                      key={item.value}
                      className={`rounded-lg px-1 py-1.5 transition-colors ${active
                        ? 'bg-surface-dark text-text-dark'
                        : 'text-text-muted hover:bg-bg-dark'
                        }`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onAspectRatioChange(item.value);
                      }}
                    >
                      <div className="mb-1 flex h-6 items-center justify-center">
                        <span
                          className="inline-block rounded-[3px] border border-current/60"
                          style={previewStyle}
                        />
                      </div>
                      <div className="text-[10px]">{item.label}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </UiPanel>
        </div>,
        document.body
      )}

      {typeof document !== 'undefined' && renderPanel === 'otherParams' && createPortal(
        <div
          ref={otherParamsPanelRef}
          className={`fixed z-[80] transition-opacity duration-200 ease-out ${isPanelVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          style={buildPanelStyle(otherParamsPanelAnchor, 'center')}
        >
          <UiPanel className="w-[320px] p-3">
            <div className="space-y-2">
              {/* Audio Toggle */}
              {selectedModel.supportsAudio && (
                <div className="rounded-lg border border-[rgba(255,255,255,0.08)] bg-bg-dark/65 px-3 py-2">
                  <label className="flex cursor-pointer items-center justify-between gap-2">
                    <span className="text-xs font-medium text-text-dark">{t('node.videoGen.enableAudio')}</span>
                    <UiCheckbox
                      checked={enableAudio}
                      onCheckedChange={(checked) => onEnableAudioChange?.(checked)}
                    />
                  </label>
                </div>
              )}

              {/* Seed Input */}
              {selectedModel.supportsSeed && (
                <div className="rounded-lg border border-[rgba(255,255,255,0.08)] bg-bg-dark/65 px-3 py-2">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="text-xs font-medium text-text-dark">{t('node.videoGen.seed')}</label>
                    <input
                      type="number"
                      value={seed ?? ''}
                      onChange={(event) => {
                        const value = event.target.value;
                        onSeedChange?.(value ? Number(value) : null);
                      }}
                      placeholder="50000"
                      min="10000"
                      max="99999"
                      className="h-7 w-24 rounded border border-[rgba(255,255,255,0.15)] bg-bg-dark/60 px-2 text-xs text-text-dark placeholder:text-text-muted/50 focus:border-accent/60 focus:outline-none"
                    />
                  </div>
                  <div className="text-[10px] leading-3 text-text-muted">
                    {t('node.videoGen.seedDescription')} (10000-99999)
                  </div>
                </div>
              )}

              {/* Extra Parameters */}
              {extraParamSchemaWithoutElements.map((definition) => {
                const resolvedValue = extraParams?.[definition.key] ?? definition.defaultValue;

                return (
                  <div
                    key={definition.key}
                    className="rounded-lg border border-[rgba(255,255,255,0.08)] bg-bg-dark/65 px-3 py-2"
                  >
                    {definition.type === 'enum' && definition.options && (
                      <>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <label className="text-xs font-medium text-text-dark">
                            {translateParam(definition.key, 'label') || definition.label}
                          </label>
                          <UiSelect
                            value={String(resolvedValue ?? '')}
                            onChange={(event) => onExtraParamChange?.(definition.key, event.target.value)}
                            className="h-7 w-32 text-xs"
                          >
                            {definition.options.map((option) => (
                              <option key={option.value} value={option.value}>
                                {translateParam(definition.key, 'option', option.value) || option.label}
                              </option>
                            ))}
                          </UiSelect>
                        </div>
                        {definition.description && (
                          <div className="text-[10px] leading-3 text-text-muted">
                            {translateParam(definition.key, 'description') || definition.description}
                          </div>
                        )}
                      </>
                    )}

                    {definition.type === 'boolean' && (
                      <>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <label className="text-xs font-medium text-text-dark">
                            {translateParam(definition.key, 'label') || definition.label}
                          </label>
                          <UiCheckbox
                            checked={Boolean(resolvedValue)}
                            onCheckedChange={(checked) =>
                              onExtraParamChange?.(definition.key, checked)
                            }
                          />
                        </div>
                        {definition.description && (
                          <div className="text-[10px] leading-3 text-text-muted">
                            {translateParam(definition.key, 'description') || definition.description}
                          </div>
                        )}
                      </>
                    )}

                    {definition.type === 'number' && (
                      <>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <label className="text-xs font-medium text-text-dark">
                            {translateParam(definition.key, 'label') || definition.label}
                          </label>
                          <input
                            type="number"
                            min={definition.min}
                            max={definition.max}
                            step={definition.step}
                            value={typeof resolvedValue === 'number' ? String(resolvedValue) : ''}
                            onChange={(event) =>
                              onExtraParamChange?.(definition.key, Number(event.target.value))
                            }
                            className="h-7 w-24 rounded border border-[rgba(255,255,255,0.15)] bg-bg-dark/60 px-2 text-xs text-text-dark placeholder:text-text-muted/50 focus:border-accent/60 focus:outline-none"
                          />
                        </div>
                        {definition.description && (
                          <div className="text-[10px] leading-3 text-text-muted">
                            {translateParam(definition.key, 'description') || definition.description}
                          </div>
                        )}
                      </>
                    )}

                    {definition.type === 'string' && (
                      <>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <label className="text-xs font-medium text-text-dark">
                            {translateParam(definition.key, 'label') || definition.label}
                          </label>
                          <input
                            type="text"
                            value={typeof resolvedValue === 'string' ? resolvedValue : ''}
                            onChange={(event) =>
                              onExtraParamChange?.(definition.key, event.target.value)
                            }
                            className="h-7 flex-1 rounded border border-[rgba(255,255,255,0.15)] bg-bg-dark/60 px-2 text-xs text-text-dark placeholder:text-text-muted/50 focus:border-accent/60 focus:outline-none"
                          />
                        </div>
                        {definition.description && (
                          <div className="text-[10px] leading-3 text-text-muted">
                            {translateParam(definition.key, 'description') || definition.description}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}

              {/* Kling Elements */}
              {hasKlingElements && (
                <div className="rounded-lg border border-[rgba(255,255,255,0.08)] bg-bg-dark/65 px-3 py-2">
                  <div className="mb-2 text-xs font-medium text-text-dark">{t('node.videoGen.klingElements')}</div>
                  <KlingElementsEditor
                    elements={(klingElements as any[]) ?? []}
                    incomingImages={incomingImages}
                    onChange={(elements) => onKlingElementsChange?.(elements)}
                  />
                </div>
              )}
            </div>
          </UiPanel>
        </div>,
        document.body
      )}

      {typeof document !== 'undefined' && createPortal(
        <UiModal
          isOpen={Boolean(missingKeyProviderName)}
          title={t('modelParams.providerKeyRequiredTitle')}
          onClose={() => setMissingKeyProviderName(null)}
          widthClassName="w-[420px]"
          containerClassName="z-[120]"
          footer={(
            <>
              <UiButton
                variant="muted"
                size="sm"
                onClick={() => setMissingKeyProviderName(null)}
              >
                {t('common.cancel')}
              </UiButton>
              <UiButton
                variant="primary"
                size="sm"
                onClick={() => {
                  setMissingKeyProviderName(null);
                  setOpenPanel(null);
                  openSettingsDialog({ category: 'providers' });
                }}
              >
                {t('modelParams.goConfigure')}
              </UiButton>
            </>
          )}
        >
          <p className="text-sm text-text-muted">
            {t('modelParams.providerKeyRequiredDesc', { provider: missingKeyProviderName ?? '' })}
          </p>
        </UiModal>,
        document.body
      )}
    </div>
  );
});

VideoParamsControls.displayName = 'VideoParamsControls';
