import { describe, expect, it } from "vitest";

import { registerEntity } from "../src/core/registry";
import { createSim } from "../src/core/sim";

const COMPAT_KIND = "compat-probe-entity";

let definitionRegistered = false;

function ensureCompatDefinition(): void {
  if (definitionRegistered) {
    return;
  }

  registerEntity(COMPAT_KIND, {
    create: () => ({ ticks: 0 }),
    update: (entity) => {
      const state = (entity.state ?? {}) as { ticks?: number };
      const current = typeof state.ticks === "number" ? state.ticks : 0;
      state.ticks = current + 1;
      entity.state = state;
    },
  });

  definitionRegistered = true;
}

describe("sim API compatibility", () => {
  it("supports legacy object-style addEntity({ kind, pos, rot })", () => {
    ensureCompatDefinition();
    const sim = createSim();

    const id = sim.addEntity({
      kind: COMPAT_KIND,
      pos: { x: 2, y: 3 },
      rot: "E",
    });

    expect(id).toBeTypeOf("string");
    expect(sim.getEntityById(id)).toMatchObject({
      id,
      kind: COMPAT_KIND,
      pos: { x: 2, y: 3 },
      rot: "E",
    });
  });

  it("supports two-arg addEntity(kind, init) and defaults rotation to N", () => {
    ensureCompatDefinition();
    const sim = createSim({ width: 8, height: 8, seed: 1 });

    const id = sim.addEntity(COMPAT_KIND, {
      pos: { x: 1, y: 1 },
    });

    const entity = sim.getEntityById(id);
    expect(entity?.rot).toBe("N");
    sim.step(1000 / 60);
    expect((sim.getEntityById(id)?.state as { ticks?: number } | undefined)?.ticks).toBe(1);
  });

  it("rejects out-of-bounds placements with a clear error", () => {
    ensureCompatDefinition();
    const sim = createSim({ width: 4, height: 4, seed: 1 });

    expect(() =>
      sim.addEntity(COMPAT_KIND, {
        pos: { x: 4, y: 0 },
      }),
    ).toThrow(/out of bounds/i);
  });
});
