import { describe, expect, it } from 'vitest';

import {
  compareRuntimeCheckpointsNewestFirst,
  normalizeAutoCheckpoint,
  normalizeRuntimeSaveStateForRuntime,
  parseRuntimeBlueprintState,
  inspectRuntimeBlueprintPlacement,
  validateRuntimeSharePayloadForImport,
  validateRuntimeBlueprintPayloadForImport,
  validateRuntimeSavePayloadForImport,
  parseRuntimeSaveState,
  buildRuntimeShareQueryValue,
  parseRuntimeSharePayloadFromQueryValue,
  parseRuntimeSharePayloadFromSearchParams,
} from '../src/ui/App';

describe('Checkpoint ordering', () => {
  it('sorts checkpoint restore records by newest tick and newest timestamp for ties', () => {
    const latestTick = normalizeAutoCheckpoint({
      createdAt: '2026-02-22T12:00:00.000Z',
      tick: 40,
      reason: 'latest-tick',
      state: { version: 1, width: 1, height: 1, seed: 'agents-ultra', tick: 40, tickCount: 40, elapsedMs: 0, paused: false, player: { x: 0, y: 0, rot: 'N', fuel: 100, maxFuel: 100 }, inventory: { ore: 0, plate: 0, gear: 0, coal: 0, used: 0, capacity: 24 }, entities: [] },
    });

    const earlierTick = normalizeAutoCheckpoint({
      createdAt: '2026-02-22T12:01:00.000Z',
      tick: 20,
      reason: 'earlier-tick',
      state: { version: 1, width: 1, height: 1, seed: 'agents-ultra', tick: 20, tickCount: 20, elapsedMs: 0, paused: true, player: { x: 0, y: 0, rot: 'N', fuel: 100, maxFuel: 100 }, inventory: { ore: 0, plate: 0, gear: 0, coal: 0, used: 0, capacity: 24 }, entities: [] },
    });

    const sameTickNewer = normalizeAutoCheckpoint({
      createdAt: '2026-02-22T13:00:00.000Z',
      tick: 40,
      reason: 'same-tick-newer',
      state: { version: 1, width: 1, height: 1, seed: 'agents-ultra', tick: 40, tickCount: 40, elapsedMs: 0, paused: false, player: { x: 0, y: 0, rot: 'N', fuel: 100, maxFuel: 100 }, inventory: { ore: 0, plate: 0, gear: 0, coal: 0, used: 0, capacity: 24 }, entities: [] },
    });

    const sameTickOlder = normalizeAutoCheckpoint({
      createdAt: '2026-02-22T12:30:00.000Z',
      tick: 40,
      reason: 'same-tick-older',
      state: { version: 1, width: 1, height: 1, seed: 'agents-ultra', tick: 40, tickCount: 40, elapsedMs: 0, paused: false, player: { x: 0, y: 0, rot: 'N', fuel: 100, maxFuel: 100 }, inventory: { ore: 0, plate: 0, gear: 0, coal: 0, used: 0, capacity: 24 }, entities: [] },
    });

    const normalized = [earlierTick, latestTick, sameTickNewer, sameTickOlder].filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    const ordered = normalized.slice().sort(compareRuntimeCheckpointsNewestFirst);

    expect(ordered[0]?.reason).toBe('same-tick-newer');
    expect(ordered[1]?.reason).toBe('same-tick-older');
    expect(ordered[2]?.reason).toBe('latest-tick');
    expect(ordered[3]?.reason).toBe('earlier-tick');
  });
});

describe('Runtime save/load compatibility parsing', () => {
  it('accepts legacy payloads with numeric rotation and missing seed while normalizing defaults', () => {
    const legacyPayload = {
      version: 0,
      width: 60,
      height: 40,
      tick: 42,
      tickCount: 4200,
      elapsedMs: 1234,
      paused: true,
      player: {
        x: 10,
        y: 12,
        fuel: 77,
        maxFuel: 100,
      },
      inventory: {
        ore: 3,
        plate: 2,
        gear: 1,
        coal: 4,
        used: 10,
        capacity: 24,
      },
      entities: [
        {
          kind: 'miner',
          pos: { x: 5, y: 6 },
          rot: 1,
          state: { holding: 'iron-ore' },
        },
      ],
    };

    const parsed = parseRuntimeSaveState(legacyPayload, { fallbackPlayerRotation: 'S' });

    expect(parsed).not.toBeNull();
    if (parsed === null) {
      return;
    }

    expect(parsed.version).toBe(0);
    expect(parsed.seed).toBe('agents-ultra');
    expect(parsed.player.rot).toBe('S');
    expect(parsed.entities).toHaveLength(1);
    expect(parsed.entities[0]?.rot).toBe('E');
    expect(parsed.entities[0]?.state).toEqual({ holding: 'iron-ore' });
  });

  it('accepts numeric string directions and normalizes entity direction aliases', () => {
    const payload = {
      version: 2,
      width: 60,
      height: 40,
      tick: 10,
      tickCount: 10,
      elapsedMs: 100,
      paused: false,
      player: {
        x: 0,
        y: 0,
        direction: '1',
        fuel: 5,
        maxFuel: 100,
      },
      inventory: {
        ore: 1,
        plate: 0,
        gear: 0,
        coal: 0,
        used: 1,
        capacity: 24,
      },
      entities: [
        {
          kind: 'furnace',
          x: 2,
          y: 3,
          rot: '3',
        },
      ],
    };

    const parsed = parseRuntimeSaveState(payload);

    expect(parsed).not.toBeNull();
    if (parsed === null) {
      return;
    }

    expect(parsed.player.rot).toBe('E');
    expect(parsed.entities[0]?.rot).toBe('W');
  });

  it('accepts envelopes with selected tool/camera metadata preserved as ignored fields', () => {
    const payloadWithEnvelopeMetadata = {
      version: 1,
      width: 60,
      height: 40,
      tick: 12,
      tickCount: 12,
      elapsedMs: 120,
      paused: false,
      player: {
        x: 3,
        y: 7,
        rot: 'S',
        fuel: 90,
        maxFuel: 110,
      },
      inventory: {
        ore: 4,
        plate: 1,
        gear: 2,
        coal: 6,
        used: 13,
        capacity: 24,
      },
      entities: [
        {
          kind: 'solar-panel',
          pos: { x: 7, y: 8 },
          rot: 'N',
        },
      ],
      selectedKind: 'Belt',
      selectedRotation: 2,
      camera: {
        zoom: 1.2,
        panX: 10,
        panY: 5,
        autoFollow: true,
      },
      createdAt: '2026-02-22T15:23:00.000Z',
      power: {
        storage: 45,
        capacity: 120,
      },
    };

    const parsed = parseRuntimeSaveState(payloadWithEnvelopeMetadata);

    expect(parsed).not.toBeNull();
    if (parsed === null) {
      return;
    }

    expect(parsed.version).toBe(1);
    expect(parsed.entities).toHaveLength(1);
    expect(parsed.player.rot).toBe('S');
    expect((parsed as Record<string, unknown>).selectedKind).toBeUndefined();
    expect((parsed as Record<string, unknown>).camera).toBeUndefined();
    expect((parsed as Record<string, unknown>).createdAt).toBeUndefined();
  });

  it('rejects envelope metadata without required runtime fields', () => {
    const malformedEnvelope = {
      selectedKind: 'Belt',
      selectedRotation: 0,
      camera: {
        zoom: 1,
      },
      createdAt: '2026-02-22T16:00:00.000Z',
    };

    expect(parseRuntimeSaveState(malformedEnvelope)).toBeNull();
  });

  it('rejects payloads nested under a state wrapper', () => {
    const statePayload = {
      version: 1,
      width: 60,
      height: 40,
      tick: 12,
      tickCount: 12,
      elapsedMs: 120,
      paused: false,
      player: {
        x: 1,
        y: 2,
        rot: 'S',
        fuel: 100,
        maxFuel: 110,
      },
      inventory: {
        ore: 1,
        plate: 0,
        gear: 0,
        coal: 0,
        used: 1,
        capacity: 24,
      },
      entities: [],
    };

    const wrapped = {
      state: statePayload,
      selectedKind: 'Belt',
      createdAt: '2026-02-22T17:00:00.000Z',
    };

    expect(parseRuntimeSaveState(wrapped)).toBeNull();
  });

  it('supports legacy power aliases and numeric strings in top-level payload', () => {
    const legacyPayload = {
      schemaVersion: '1',
      mapWidth: '60',
      mapHeight: '40',
      tick: '123',
      tickCount: '1230',
      elapsedMs: '4567',
      paused: false,
      player: {
        position: { x: 2, y: 3 },
        direction: 'north',
        fuel: '88',
        fuelCapacity: 200,
      },
      inventory: {
        ironOre: '2',
        plates: 3,
        gear: '1',
        coal: '4',
        used: '10',
        capacity: 24,
      },
      entities: [],
      powerStorage: '50',
      powerCapacity: '150',
      powerDemand: 24,
      powerConsumed: '5',
      powerGenerated: 11,
      powerShortages: '0',
    };

    const parsed = parseRuntimeSaveState(legacyPayload);

    expect(parsed).not.toBeNull();
    if (parsed === null) {
      return;
    }

    expect(parsed.version).toBe(1);
    expect(parsed.seed).toBe('agents-ultra');
    expect(parsed.player.rot).toBe('N');
    expect(parsed.inventory.ore).toBe(2);
    expect(parsed.inventory.plate).toBe(3);
    expect(parsed.power).toEqual({
      storage: 50,
      capacity: 150,
      demandThisTick: 24,
      consumedThisTick: 5,
      generatedThisTick: 11,
      shortagesThisTick: 0,
    });
  });

  it('accepts save entity collections encoded as object maps', () => {
    const payload = {
      version: 1,
      width: 60,
      height: 40,
      tick: 8,
      tickCount: 8,
      elapsedMs: 80,
      paused: false,
      player: {
        x: 3,
        y: 4,
        rot: 'S',
        fuel: 88,
        maxFuel: 120,
      },
      inventory: {
        ore: 1,
        plate: 2,
        gear: 3,
        coal: 4,
        used: 5,
        capacity: 24,
      },
      entities: {
        miner: {
          kind: 'Miner',
          pos: { x: 1, y: 2 },
          rot: '2',
        },
        furnace: {
          type: 'furnace',
          x: 5,
          y: 6,
          direction: 'south',
        },
      },
    };

    const parsed = parseRuntimeSaveState(payload);

    expect(parsed).not.toBeNull();
    if (parsed === null) {
      return;
    }

    expect(parsed.entities).toHaveLength(2);
    expect(parsed.entities[0]).toEqual({
      kind: 'miner',
      pos: { x: 1, y: 2 },
      rot: 'S',
    });
    expect(parsed.entities[1]).toEqual({
      kind: 'furnace',
      pos: { x: 5, y: 6 },
      rot: 'S',
    });
  });

  it('accepts schemaVersion aliases in save payloads when version is omitted', () => {
    const payload = {
      version: undefined,
      schemaVersion: '2',
      width: 60,
      height: 40,
      tick: 16,
      tickCount: 160,
      elapsedMs: 1600,
      paused: false,
      player: {
        x: 5,
        y: 6,
        rot: 0,
        fuel: 99,
        maxFuel: 120,
      },
      inventory: {
        ore: 1,
        plate: 0,
        gear: 0,
        coal: 0,
        used: 1,
        capacity: 24,
      },
      entities: [],
    };

    const parsed = parseRuntimeSaveState(payload);
    const validation = validateRuntimeSavePayloadForImport(payload);

    expect(parsed).not.toBeNull();
    if (parsed === null) {
      return;
    }
    expect(parsed.version).toBe(2);
    expect(validation.errors).toEqual([]);
  });

  it('validates save payloads with entity object maps', () => {
    const result = validateRuntimeSavePayloadForImport({
      version: 1,
      width: 60,
      height: 40,
      tick: 8,
      tickCount: 8,
      elapsedMs: 80,
      paused: false,
      player: {
        x: 3,
        y: 4,
        rot: 'S',
        fuel: 88,
        maxFuel: 120,
      },
      inventory: {
        ore: 1,
        plate: 2,
        gear: 3,
        coal: 4,
        used: 5,
        capacity: 24,
      },
      entities: {
        miner: {
          kind: 'Miner',
          pos: { x: 1, y: 2 },
          rot: '2',
        },
      },
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('warns when save schema metadata is missing', () => {
    const result = validateRuntimeSavePayloadForImport({
      width: 60,
      height: 40,
      tick: 8,
      tickCount: 8,
      elapsedMs: 80,
      paused: false,
      player: {
        x: 3,
        y: 4,
        rot: 'S',
        fuel: 88,
        maxFuel: 120,
      },
      inventory: {
        ore: 1,
        plate: 2,
        gear: 3,
        coal: 4,
        used: 5,
        capacity: 24,
      },
      entities: [],
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual(expect.arrayContaining([
      'Save schema version is missing; defaulting to v2.',
    ]));
  });

  it('rejects malformed checkpoint-like payloads without critical fields', () => {
    const malformed = {
      version: 1,
      width: 60,
      // height missing intentionally
      tick: 12,
      tickCount: 12,
      elapsedMs: 12,
      player: {
        x: 1,
        y: 2,
        fuel: 10,
        maxFuel: 100,
      },
      inventory: {
        ore: 0,
        plate: 0,
        gear: 0,
        coal: 0,
        used: 0,
        capacity: 24,
      },
      entities: [],
    };

    expect(parseRuntimeSaveState(malformed, { fallbackPlayerRotation: 'N' })).toBeNull();
  });

  it('provides actionable errors when save import payload is missing required fields', () => {
    const malformed = {
      version: 1,
      height: 40,
      tick: 10,
      tickCount: 10,
      elapsedMs: 10,
      paused: false,
      player: {
        x: 1,
        y: 2,
        fuel: 10,
        maxFuel: 100,
      },
      inventory: {
        ore: 0,
        plate: 0,
        gear: 0,
        coal: 0,
        used: 0,
        capacity: 24,
      },
      entities: [],
    };

    const result = validateRuntimeSavePayloadForImport(malformed);
    expect(result.errors).toEqual(expect.arrayContaining(['Save payload is missing a valid map width.']));
  });
});

describe('Runtime save schema migration', () => {
  it('upgrades older versions to the runtime schema version', () => {
    const baseline = {
      version: 1,
      width: 60,
      height: 40,
      tick: 4,
      tickCount: 4,
      elapsedMs: 100,
      paused: false,
      player: {
        x: 1,
        y: 1,
        rot: 'S',
        fuel: 20,
        maxFuel: 100,
      },
      inventory: {
        ore: 4,
        plate: 2,
        gear: 0,
        coal: 3,
        used: 9,
        capacity: 24,
      },
      entities: [],
      power: {
        storage: 10,
        capacity: 100,
      },
    };

    const parsed = parseRuntimeSaveState(baseline, {
      fallbackPlayerRotation: 'S',
    });
    expect(parsed).not.toBeNull();
    if (parsed === null) {
      return;
    }

    const normalized = normalizeRuntimeSaveStateForRuntime(parsed);

    expect(normalized.state.version).toBe(2);
    expect(normalized.warnings).toContainEqual(
      expect.objectContaining({
        code: 'schema-version-upgraded',
        message: expect.stringContaining('Upgraded save schema from v1 to v2'),
      }),
    );
  });
});

describe('Runtime blueprint parsing and import validation', () => {
  it('parses relative blueprint payloads and normalizes kind/direction aliases', () => {
    const payload = {
      version: 1,
      anchor: {
        x: 10,
        y: 14,
      },
      entities: [
        {
          kind: 'Belt',
          pos: {
            x: 2,
            y: -1,
          },
          rot: '1',
        },
        {
          kind: 'Miner',
          x: 4,
          y: 0,
          direction: 'south',
        },
      ],
    };

    const parsed = parseRuntimeBlueprintState(payload);

    expect(parsed).not.toBeNull();
    if (parsed === null) {
      return;
    }

    expect(parsed.version).toBe(1);
    expect(parsed.anchor).toEqual({ x: 10, y: 14 });
    expect(parsed.entities).toHaveLength(2);
    expect(parsed.entities[0]).toEqual({
      kind: 'belt',
      pos: { x: 2, y: -1 },
      rot: 'E',
    });
    expect(parsed.entities[1]).toEqual({
      kind: 'miner',
      pos: { x: 4, y: 0 },
      rot: 'S',
    });
  });

  it('parses blueprint payloads where entities are stored as object maps', () => {
    const payload = {
      version: 1,
      anchor: {
        x: 5,
        y: 6,
      },
      entities: {
        belt: {
          kind: 'Belt',
          x: 1,
          y: 2,
          direction: '1',
        },
        furnace: {
          type: 'furnace',
          pos: { x: -2, y: 3 },
          rot: 'weird',
        },
      },
    };

    const parsed = parseRuntimeBlueprintState(payload);

    expect(parsed).not.toBeNull();
    if (parsed === null) {
      return;
    }

    expect(parsed.version).toBe(1);
    expect(parsed.entities).toHaveLength(2);
    expect(parsed.entities[0]).toEqual({
      kind: 'belt',
      pos: { x: 1, y: 2 },
      rot: 'E',
    });
    expect(parsed.entities[1]).toEqual({
      kind: 'furnace',
      pos: { x: -2, y: 3 },
      rot: 'N',
    });
  });

  it('accepts schemaVersion aliases when blueprint version is omitted', () => {
    const payload = {
      version: undefined,
      schemaVersion: '1',
      anchor: {
        x: 0,
        y: 0,
      },
      entities: [
        {
          kind: 'belt',
          pos: {
            x: 2,
            y: 3,
          },
          rot: 'E',
        },
      ],
    };

    const parsed = parseRuntimeBlueprintState(payload);
    const validation = validateRuntimeBlueprintPayloadForImport(payload);

    expect(parsed).not.toBeNull();
    if (parsed === null) {
      return;
    }

    expect(parsed.version).toBe(1);
    expect(validation.errors).toEqual([]);
  });

  it('validates blueprint payload shape and preserves entity count when valid', () => {
    const payload = {
      version: 1,
      anchor: {
        x: 0,
        y: 0,
      },
      entities: Array.from({ length: 3 }, () => ({
        kind: 'belt',
        x: 0,
        y: 0,
      })),
    };

    const result = validateRuntimeBlueprintPayloadForImport(payload);

    expect(result.errors).toEqual([]);
    expect(result.blueprint).not.toBeNull();
    if (result.blueprint === null) {
      return;
    }

    expect(result.blueprint.entities).toHaveLength(3);
  });

  it('validates blueprint payloads with object-map entities', () => {
    const result = validateRuntimeBlueprintPayloadForImport({
      version: 1,
      anchor: {
        x: 0,
        y: 0,
      },
      entities: {
        leftBelt: {
          kind: 'belt',
          x: 0,
          y: 0,
        },
        topMiner: {
          type: 'miner',
          pos: { x: 1, y: 1 },
          direction: 'S',
        },
      },
    });

    expect(result.errors).toEqual([]);
    expect(result.blueprint).not.toBeNull();
    if (result.blueprint === null) {
      return;
    }

    expect(result.blueprint.entities).toHaveLength(2);
  });

  it('warns when blueprint schema metadata is missing and defaults to the current version', () => {
    const result = validateRuntimeBlueprintPayloadForImport({
      anchor: {
        x: 0,
        y: 0,
      },
      entities: {
        belt: {
          kind: 'Belt',
          x: 0,
          y: 0,
        },
      },
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual(expect.arrayContaining([
      'Blueprint schema version is missing; defaulting to v1.',
    ]));
  });

  it('rejects malformed blueprint payloads', () => {
    const result = validateRuntimeBlueprintPayloadForImport({
      version: 1,
      anchor: {
        x: 'bad',
        y: 0,
      },
      entities: [
        {
          kind: 'not-a-kind',
          x: 0,
          y: 0,
        },
      ],
    });

    expect(result.errors).not.toEqual([]);
    expect(result.blueprint).toBeNull();
  });

  it('flags missing or invalid anchor fields as malformed', () => {
    const result = validateRuntimeBlueprintPayloadForImport({
      version: 1,
      entities: [
        {
          kind: 'belt',
          x: 0,
          y: 0,
        },
      ],
    });

    expect(result.errors).toContain('Blueprint payload is missing anchor coordinates.');
    expect(result.blueprint).toBeNull();
  });

  it('accepts legacy entity field forms and emits upgrade warnings', () => {
    const result = validateRuntimeBlueprintPayloadForImport({
      version: 2,
      anchor: {
        x: 4,
        y: 5,
      },
      name: 'Legacy blueprint',
      createdAt: 'not-a-date',
      entities: [
        {
          kind: 'Belt',
          x: 1,
          y: 2,
          direction: 'south',
          rot: 'weird',
        },
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.blueprint).not.toBeNull();
    expect(result.blueprint?.entities).toHaveLength(1);
    expect(result.blueprint?.entities[0]).toEqual({
      kind: 'belt',
      pos: { x: 1, y: 2 },
      rot: 'S',
    });
    expect(result.warnings.some((warning) => warning.includes('legacy kind'))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('invalid rotation'))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('createdAt metadata'))).toBe(true);
  });

  it('rejects duplicate blueprint entity coordinates', () => {
    const result = validateRuntimeBlueprintPayloadForImport({
      version: 1,
      anchor: {
        x: 0,
        y: 0,
      },
      entities: [
        {
          kind: 'belt',
          pos: { x: 1, y: 2 },
        },
        {
          type: 'Belt',
          x: 1,
          y: 2,
        },
      ],
    });

    expect(result.errors).not.toEqual([]);
    expect(result.errors[0]).toContain('duplicates relative tile');
    expect(result.blueprint).toBeNull();
  });

  it('flags player-tile, out-of-bounds, and occupied placement blockers before applying', () => {
    const blueprint = {
      version: 1,
      anchor: {
        x: 0,
        y: 0,
      },
      entities: [
        {
          kind: 'belt',
          pos: {
            x: 1,
            y: 2,
          },
          rot: 'N',
        },
        {
          kind: 'miner',
          pos: {
            x: 60,
            y: 0,
          },
          rot: 'E',
        },
        {
          kind: 'furnace',
          pos: {
            x: 4,
            y: 5,
          },
          rot: 'S',
        },
      ],
    };

    const inspection = inspectRuntimeBlueprintPlacement(blueprint, {
      playerSnapshot: {
        x: 1,
        y: 2,
        fuel: 20,
      },
      occupiedTiles: [{ x: 4, y: 5 }],
      isOre: () => true,
    });

    expect(inspection.ok).toBe(false);
    expect(inspection.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ index: 0, code: 'player-tile' }),
        expect.objectContaining({ index: 1, code: 'out-of-bounds' }),
        expect.objectContaining({ index: 2, code: 'tile-occupied' }),
      ]),
    );
  });

  it('honors custom placement probes when available', () => {
    const blueprint = {
      version: 1,
      anchor: {
        x: 0,
        y: 0,
      },
      entities: [
        {
          kind: 'belt',
          pos: {
            x: 1,
            y: 2,
          },
          rot: 'N',
        },
      ],
    };

    const inspection = inspectRuntimeBlueprintPlacement(blueprint, {
      playerSnapshot: {
        x: 10,
        y: 10,
        fuel: 20,
      },
      occupiedTiles: [],
      canPlacePlacement: () => ({ ok: false, reasonCode: 'occupied' }),
    });

    expect(inspection.ok).toBe(false);
    expect(inspection.blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'tile-occupied' })]),
    );
  });

  it('provides bounds and fuel cost for valid blueprints', () => {
    const blueprint = {
      version: 1,
      anchor: {
        x: 0,
        y: 0,
      },
      entities: [
        {
          kind: 'belt',
          pos: {
            x: 3,
            y: 3,
          },
          rot: 'W',
        },
        {
          kind: 'belt',
          pos: {
            x: 5,
            y: 1,
          },
          rot: 'N',
        },
      ],
    };

    const inspection = inspectRuntimeBlueprintPlacement(blueprint, {
      playerSnapshot: {
        x: 10,
        y: 10,
        fuel: 20,
      },
      occupiedTiles: [],
    });

    expect(inspection.ok).toBe(true);
    expect(inspection.fuelCost).toBe(4);
    expect(inspection.bounds).toEqual({
      left: 13,
      right: 15,
      top: 11,
      bottom: 13,
    });
  });
});

describe('Runtime share payload validation', () => {
  const baselineState = {
    version: 2,
    width: 60,
    height: 40,
    tick: 1,
    tickCount: 1,
    elapsedMs: 10,
    paused: false,
    player: {
      x: 1,
      y: 2,
      rot: 'S',
      fuel: 100,
      maxFuel: 120,
    },
    inventory: {
      ore: 0,
      plate: 0,
      gear: 0,
      coal: 0,
      used: 0,
      capacity: 24,
    },
    entities: [],
  };

  const baselineBlueprint = {
    version: 1,
    anchor: {
      x: 0,
      y: 0,
    },
    entities: [
      {
        kind: 'belt',
        pos: {
          x: 0,
          y: 0,
        },
        rot: 'N',
      },
    ],
  };

  it('accepts runtime-save share envelopes', () => {
    const result = validateRuntimeSharePayloadForImport({
      kind: 'runtime-save',
      schemaVersion: 1,
      payload: baselineState,
      createdAt: '2026-02-22T20:00:00.000Z',
    });

    expect(result.errors).toEqual([]);
    expect(result.kind).toBe('runtime-save');
    expect(result.savePayload).not.toBeNull();
    expect(result.blueprintPayload).toBeNull();
  });

  it('accepts runtime-blueprint share envelopes', () => {
    const result = validateRuntimeSharePayloadForImport({
      kind: 'runtime-blueprint',
      schemaVersion: 1,
      payload: baselineBlueprint,
      createdAt: '2026-02-22T20:00:00.000Z',
    });

    expect(result.errors).toEqual([]);
    expect(result.kind).toBe('runtime-blueprint');
    expect(result.blueprintPayload).not.toBeNull();
    expect(result.savePayload).toBeNull();
    expect(result.blueprintPayload?.entities).toHaveLength(1);
  });

  it('rejects malformed blueprint share payloads using strict blueprint validation', () => {
    const malformedBlueprint = {
      version: 1,
      anchor: {
        x: 'bad',
        y: 0,
      },
      entities: [
        {
          kind: 'belt',
          x: 1,
          y: 1,
        },
      ],
    };

    const result = validateRuntimeSharePayloadForImport({
      kind: 'runtime-blueprint',
      schemaVersion: 1,
      payload: malformedBlueprint,
    });

    expect(result.errors).not.toEqual([]);
    expect(result.kind).toBeNull();
    expect(result.blueprintPayload).toBeNull();
  });

  it('infers save payloads from legacy raw objects', () => {
    const result = validateRuntimeSharePayloadForImport(baselineState);

    expect(result.errors).toEqual([]);
    expect(result.kind).toBe('runtime-save');
    expect(result.savePayload).not.toBeNull();
  });

  it('infers save payloads from legacy object-map entity collections', () => {
    const result = validateRuntimeSharePayloadForImport({
      version: 2,
      width: 60,
      height: 40,
      tick: 4,
      tickCount: 4,
      elapsedMs: 120,
      paused: false,
      player: {
        x: 1,
        y: 2,
        rot: 'N',
        fuel: 90,
        maxFuel: 100,
      },
      inventory: {
        ore: 1,
        plate: 0,
        gear: 0,
        coal: 0,
        used: 0,
        capacity: 24,
      },
      entities: {
        miner: {
          kind: 'miner',
          pos: { x: 1, y: 2 },
          rot: 0,
        },
      },
    });

    expect(result.errors).toEqual([]);
    expect(result.kind).toBe('runtime-save');
    expect(result.savePayload).not.toBeNull();
    expect(result.savePayload?.entities).toHaveLength(1);
  });

  it('rejects unsupported share payloads', () => {
    const result = validateRuntimeSharePayloadForImport({ foo: 'bar' });

    expect(result.errors).not.toEqual([]);
    expect(result.kind).toBeNull();
    expect(result.savePayload).toBeNull();
    expect(result.blueprintPayload).toBeNull();
  });

  it('builds and parses runtime save share query values', () => {
    const savePayload = {
      kind: 'runtime-save',
      schemaVersion: 1,
      payload: baselineState,
      createdAt: '2026-02-22T20:00:00.000Z',
    };

    const queryValue = buildRuntimeShareQueryValue(savePayload);
    const parsed = parseRuntimeSharePayloadFromQueryValue(queryValue);

    expect(parsed.errors).toEqual([]);
    expect(parsed.kind).toBe('runtime-save');
    expect(parsed.savePayload).not.toBeNull();
    expect(parsed.blueprintPayload).toBeNull();
    expect(parsed.savePayload?.version).toBe(2);
  });

  it('builds and parses runtime blueprint share query values', () => {
    const blueprintPayload = {
      kind: 'runtime-blueprint',
      schemaVersion: 1,
      payload: baselineBlueprint,
      createdAt: '2026-02-22T20:00:00.000Z',
    };

    const queryValue = buildRuntimeShareQueryValue(blueprintPayload);
    const parsed = parseRuntimeSharePayloadFromQueryValue(queryValue);

    expect(parsed.errors).toEqual([]);
    expect(parsed.kind).toBe('runtime-blueprint');
    expect(parsed.blueprintPayload).not.toBeNull();
    expect(parsed.savePayload).toBeNull();
    expect(parsed.blueprintPayload?.entities).toHaveLength(1);
  });

  it('rejects malformed share query values', () => {
    const parsed = parseRuntimeSharePayloadFromQueryValue('!!!bad');

    expect(parsed.errors).toEqual(['Share URL payload is not valid base64.']);
    expect(parsed.kind).toBeNull();
    expect(parsed.savePayload).toBeNull();
    expect(parsed.blueprintPayload).toBeNull();
  });

  it('returns null when no runtime-share query parameter exists', () => {
    const parsed = parseRuntimeSharePayloadFromSearchParams('?other=1');

    expect(parsed).toBeNull();
  });

  it('parses runtime-save share payload from full runtime-share URL', () => {
    const link = 'http://127.0.0.1:4173/?foo=bar&runtime-share=' + encodeURIComponent(buildRuntimeShareQueryValue({
      kind: 'runtime-save',
      schemaVersion: 1,
      payload: {
        version: 2,
        width: 60,
        height: 40,
        tick: 1,
        tickCount: 1,
        elapsedMs: 10,
        paused: false,
        player: {
          x: 0,
          y: 0,
          rot: 'S',
          fuel: 100,
          maxFuel: 100,
        },
        inventory: {
          ore: 0,
          plate: 0,
          gear: 0,
          coal: 0,
          used: 0,
          capacity: 24,
        },
        entities: [],
      },
      createdAt: '2026-02-22T20:00:00.000Z',
    }));

    const parsed = parseRuntimeSharePayloadFromSearchParams(link);

    expect(parsed).not.toBeNull();
    if (parsed === null) {
      return;
    }

    expect(parsed.errors).toEqual([]);
    expect(parsed.kind).toBe('runtime-save');
    expect(parsed.savePayload).not.toBeNull();
    expect(parsed.savePayload?.version).toBe(2);
    expect(parsed.savePayload?.player).toMatchObject({
      x: 0,
      y: 0,
      rot: 'S',
      fuel: 100,
      maxFuel: 100,
    });
  });
});
