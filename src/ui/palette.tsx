import { useEffect, useMemo, useState } from 'react';
import { ALL_ENTITY_KINDS, TOOLBAR_ENTITY_ORDER, type EntityKind } from './placement';

type PaletteProps = {
  kinds?: EntityKind[];
  selectedKind: EntityKind | null;
  onSelect?: (k: EntityKind) => void;
  onSelectKind?: (k: EntityKind) => void;
  className?: string;
};

const BUTTON_ORDER = TOOLBAR_ENTITY_ORDER;

export default function Palette({
  kinds = ALL_ENTITY_KINDS,
  selectedKind,
  onSelect,
  onSelectKind,
  className,
}: PaletteProps) {
  const resolveSelect = onSelect ?? onSelectKind;
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
      <div className="palette-buttons">
        {orderedKinds.map((kind, index) => {
          const isActive = selectedKind === kind;
          const hotkey = index + 1 <= 9 ? String(index + 1) : null;
          const numericPadHotkey = hotkey === null ? null : `Numpad${hotkey}`;

          return (
            <button
              key={kind}
              type="button"
              aria-pressed={isActive}
              aria-label={
                hotkey === null
                  ? `Tool ${kind}`
                  : `Tool ${kind} (keys ${hotkey}, ${numericPadHotkey})`
              }
              data-active={isActive ? 'true' : 'false'}
              data-tool-index={index}
              data-hotkey={hotkey === null ? '' : `Digit${hotkey}`}
              data-hotkey-alt={numericPadHotkey ?? ''}
              data-testid={`palette-tool-${kind.toLowerCase()}`}
              data-tool-kind={kind}
              title={
                hotkey === null
                  ? kind
                  : `Tool ${kind} (keys ${hotkey}, ${numericPadHotkey ?? 'n/a'})`
              }
              onClick={() => {
                if (resolveSelect !== undefined) {
                  resolveSelect(kind);
                }
              }}
            >
              {hotkey === null ? kind : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span
                    aria-hidden="true"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 16,
                      height: 16,
                      borderRadius: 4,
                      fontSize: 10,
                      background: 'rgba(255,255,255,0.15)',
                      color: 'inherit',
                    }}
                  >
                    {hotkey}
                  </span>
                  <span>{kind}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { default as Palette } from './palette';
