import { ALL_ENTITY_KINDS, type EntityKind } from './placement';

type PaletteProps = {
  kinds?: EntityKind[];
  selectedKind: EntityKind | null;
  onSelect: (k: EntityKind) => void;
  className?: string;
};

const BUTTON_ORDER: readonly EntityKind[] = ['Miner', 'Belt', 'Inserter', 'Furnace'];

export default function Palette({
  kinds = ALL_ENTITY_KINDS,
  selectedKind,
  onSelect,
  className,
}: PaletteProps) {
  const enabledKinds = new Set<EntityKind>(kinds);
  const orderedKinds = BUTTON_ORDER.filter((kind) => enabledKinds.has(kind));
  const currentTool = selectedKind ?? 'None';

  return (
    <div className={className} data-testid="palette" data-current-tool={currentTool}>
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
