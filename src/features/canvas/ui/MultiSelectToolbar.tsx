import { memo, useMemo } from 'react';
import { useReactFlow, useViewport } from '@xyflow/react';
import { Group } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiChipButton } from '@/components/ui/primitives';
import { useCanvasStore } from '@/stores/canvasStore';
import { DEFAULT_NODE_WIDTH, type CanvasNode } from '@/features/canvas/domain/canvasNodes';

interface MultiSelectToolbarProps {
  onGroup: (nodeIds: string[]) => void;
}

function getNodeBounds(node: CanvasNode) {
  const w = node.measured?.width ?? node.width ?? DEFAULT_NODE_WIDTH;
  const h = node.measured?.height ?? node.height ?? 200;
  return { x: node.position.x, y: node.position.y, w, h };
}

export const MultiSelectToolbar = memo(({ onGroup }: MultiSelectToolbarProps) => {
  const { t } = useTranslation();
  const nodes = useCanvasStore((state) => state.nodes);
  const rf = useReactFlow();
  const viewport = useViewport();

  const selectedNodes = useMemo(
    () => nodes.filter((n) => n.selected),
    [nodes],
  );

  const screenPos = useMemo(() => {
    if (selectedNodes.length < 2) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;

    for (const node of selectedNodes) {
      const b = getNodeBounds(node);
      if (b.x < minX) minX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.x + b.w > maxX) maxX = b.x + b.w;
    }

    const centerX = (minX + maxX) / 2;
    const topY = minY;

    const screen = rf.flowToScreenPosition({ x: centerX, y: topY });
    return { x: screen.x, y: screen.y - 48 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodes, rf, viewport]);

  if (!screenPos) return null;

  const handleGroup = () => {
    onGroup(selectedNodes.map((n) => n.id));
  };

  return (
    <div
      className="pointer-events-auto fixed z-[10001] flex items-center gap-1"
      style={{
        left: screenPos.x,
        top: screenPos.y,
        transform: 'translateX(-50%)',
      }}
    >
      <UiChipButton
        className="h-8 rounded-full px-3 text-xs shadow-lg"
        onClick={handleGroup}
      >
        <Group className="h-3.5 w-3.5" />
        {t('nodeToolbar.groupSelected')}
      </UiChipButton>
    </div>
  );
});

MultiSelectToolbar.displayName = 'MultiSelectToolbar';
