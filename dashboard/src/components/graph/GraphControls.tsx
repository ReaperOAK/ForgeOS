'use client';

import { useCallback } from 'react';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

interface GraphControlsProps {
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitToView: () => void;
}

export function GraphControls({
  scale,
  onZoomIn,
  onZoomOut,
  onFitToView,
}: GraphControlsProps) {
  const handleZoomIn = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onZoomIn();
    },
    [onZoomIn],
  );

  const handleZoomOut = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onZoomOut();
    },
    [onZoomOut],
  );

  const handleFit = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onFitToView();
    },
    [onFitToView],
  );

  return (
    <div
      className="absolute bottom-4 right-4 flex items-center gap-1 bg-surface border border-border rounded-lg shadow-lg p-1 z-10"
      role="toolbar"
      aria-label="Graph controls"
    >
      <button
        onClick={handleZoomIn}
        className="p-2 rounded-md hover:bg-primary-muted focus-ring transition-colors duration-fast"
        aria-label="Zoom in"
        title="Zoom in"
      >
        <ZoomIn size={16} aria-hidden="true" />
      </button>
      <span className="text-xs text-muted px-2 tabular-nums select-none min-w-[3rem] text-center">
        {Math.round(scale * 100)}%
      </span>
      <button
        onClick={handleZoomOut}
        className="p-2 rounded-md hover:bg-primary-muted focus-ring transition-colors duration-fast"
        aria-label="Zoom out"
        title="Zoom out"
      >
        <ZoomOut size={16} aria-hidden="true" />
      </button>
      <div className="w-px h-5 bg-border mx-1" aria-hidden="true" />
      <button
        onClick={handleFit}
        className="p-2 rounded-md hover:bg-primary-muted focus-ring transition-colors duration-fast"
        aria-label="Fit to view"
        title="Fit to view"
      >
        <Maximize2 size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
