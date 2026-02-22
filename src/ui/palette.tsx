import { useEffect, useMemo, useState } from 'react';
import { ALL_ENTITY_KINDS, type EntityKind } from './placement';

type PaletteProps = {
  kinds?: EntityKind[];
  selectedKind: EntityKind | null;
  onSelect: (k: EntityKind) => void;
  className?: string;
};

const BUTTON_ORDER: readonly EntityKind[] = ['Miner', 'Belt', 'Inserter', 'Furnace', 'Chest'];

export default function Palette({
  kinds = ALL_ENTITY_KINDS,
  selectedKind,
  onSelect,
  className,
}: PaletteProps) {
  const enabledKinds = new Set<EntityKind>(kinds);
  const orderedKinds = BUTTON_ORDER.filter((kind) => enabledKinds.has(kind));
  const currentTool = selectedKind ?? 'None';
  const hasKinds = orderedKinds.length > 0;
  const [probeState, setProbeState] = useState<'startup' | 'running' | 'error'>(
    selectedKind === null ? 'startup' : 'running',
  );
  const mergedClassName = useMemo(() => ['palette', className].filter(Boolean).join(' '), [className]);

  useEffect(() => {
    if (!hasKinds) {
      setProbeState('error');
      return;
    }

    if (selectedKind === null) {
      setProbeState('startup');
      return;
    }

    const timer = window.setTimeout(() => {
      setProbeState('running');
    }, 500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [hasKinds, selectedKind]);

  const statusLabel = useMemo(() => {
    if (probeState === 'error') {
      return 'Startup probe: no tools loaded';
    }
    if (probeState === 'startup') {
      return 'Startup probe: initializing…';
    }
    return 'Probe ok';
  }, [probeState]);

  const statusNode = useMemo(() => {
    if (probeState === 'startup' || probeState === 'error') {
      return <span>{statusLabel}</span>;
    }

    return (
      <span>
        <span className="palette-probe-dot" aria-hidden="true" />
        <span>Probe ok</span>
      </span>
    );
  }, [probeState, statusLabel]);

  return (
    <div
      className={mergedClassName}
      data-testid="palette"
      data-current-tool={currentTool}
      data-probe-state={probeState}
      aria-live="polite"
    >
      <div className="palette-probe" data-testid="palette-probe" data-probe-state={probeState}>
        {statusNode}
      </div>
      {orderedKinds.map((kind) => {
        const isActive = selectedKind === kind;

        return (
          <button
            key={kind}
            type="button"
            aria-pressed={isActive}
            aria-label={`Tool ${kind}`}
            data-active={isActive ? 'true' : 'false'}
            data-testid={`palette-tool-${kind.toLowerCase()}`}
            data-tool-kind={kind}
            onClick={() => onSelect(kind)}
          >
            {kind}
          </button>
        );
      })}
    </div>
  );
}

export { default as Palette } from './palette';
