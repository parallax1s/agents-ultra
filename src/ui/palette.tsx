/// <reference path="../types/react-shim.d.ts" />
/// <reference path="../types/modules.d.ts" />

import React from 'react';

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
}: PaletteProps): React.JSX.Element {
  const enabledKinds = new Set<EntityKind>(kinds);
  const orderedKinds = BUTTON_ORDER.filter((kind) => enabledKinds.has(kind));

  return (
    <div className={className}>
      {orderedKinds.map((kind) => {
        const isActive = selectedKind === kind;

        return (
          <button
            key={kind}
            type="button"
            aria-pressed={isActive}
            data-active={isActive ? 'true' : 'false'}
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
