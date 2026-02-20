import type { ItemKind } from "../src/core/types";

type TransportChainSim = {
  step: (deltaMs: number) => void;
  getEntityById: (id: string) => { state?: unknown } | undefined;
  tickCount: number;
};

type NormalizedBeltSlot = ItemKind | "empty";

type RawBeltState = {
  item?: unknown;
};

export type TransportTraceFrame = {
  tick: number;
  sourceBefore: NormalizedBeltSlot;
  sourceAfter: NormalizedBeltSlot;
  middleBefore: NormalizedBeltSlot;
  middleAfter: NormalizedBeltSlot;
  sinkBefore: NormalizedBeltSlot;
  sinkAfter: NormalizedBeltSlot;
  sourceToMiddle: boolean;
  middleToSink: boolean;
};

export type TransportTraceDivergence = {
  index: number;
  tick: number;
  expected: TransportTraceFrame;
  actual: TransportTraceFrame;
};

const isItemKind = (value: unknown): value is ItemKind =>
  value === "iron-ore" || value === "iron-plate";

const readBeltItem = (value: { state?: unknown } | undefined, role: string): NormalizedBeltSlot => {
  if (value === undefined) {
    throw new Error(`Expected ${role} belt entity for transport tracing`);
  }

  if (!("state" in value) || value.state === undefined) {
    throw new Error(`Expected ${role} belt state to be set for transport tracing`);
  }

  if (value.state === null || typeof value.state !== "object") {
    throw new Error(`Expected ${role} belt state to be an object for transport tracing`);
  }

  const state = value.state as RawBeltState;
  if (state.item === null || state.item === undefined) {
    return "empty";
  }

  if (!isItemKind(state.item)) {
    throw new Error(`Expected ${role} belt item in transport tracing to be a valid item kind`);
  }

  return state.item;
};

const readBeltState = (sim: TransportChainSim, sourceId: string, middleId: string, sinkId: string) => ({
  source: readBeltItem(sim.getEntityById(sourceId), "source"),
  middle: readBeltItem(sim.getEntityById(middleId), "middle"),
  sink: readBeltItem(sim.getEntityById(sinkId), "sink"),
});

const toTransportFrame = (
  tick: number,
  before: ReturnType<typeof readBeltState>,
  after: ReturnType<typeof readBeltState>,
): TransportTraceFrame => {
  return {
    tick,
    sourceBefore: before.source,
    sourceAfter: after.source,
    middleBefore: before.middle,
    middleAfter: after.middle,
    sinkBefore: before.sink,
    sinkAfter: after.sink,
    sourceToMiddle:
      before.source !== "empty" &&
      before.middle === "empty" &&
      after.source === "empty" &&
      after.middle === before.source,
    middleToSink:
      before.middle !== "empty" &&
      before.sink === "empty" &&
      after.middle === "empty" &&
      after.sink === before.middle,
  };
};

const transportFramesEqual = (left: TransportTraceFrame, right: TransportTraceFrame): boolean => {
  return (
    left.tick === right.tick &&
    left.sourceBefore === right.sourceBefore &&
    left.sourceAfter === right.sourceAfter &&
    left.middleBefore === right.middleBefore &&
    left.middleAfter === right.middleAfter &&
    left.sinkBefore === right.sinkBefore &&
    left.sinkAfter === right.sinkAfter &&
    left.sourceToMiddle === right.sourceToMiddle &&
    left.middleToSink === right.middleToSink
  );
};

export const collect3BeltTransportTrace = ({
  sim,
  sourceId,
  middleId,
  sinkId,
  steps,
  stepMs,
  beforeStep,
}: {
  sim: TransportChainSim;
  sourceId: string;
  middleId: string;
  sinkId: string;
  steps: number;
  stepMs: number;
  beforeStep?: (tick: number, sim: TransportChainSim) => void;
}): TransportTraceFrame[] => {
  const traces: TransportTraceFrame[] = [];
  let previous = readBeltState(sim, sourceId, middleId, sinkId);
  let tick = sim.tickCount;

  for (let index = 1; index <= steps; index += 1) {
    const nextTick = tick + 1;
    beforeStep?.(nextTick, sim);
    sim.step(stepMs);
    tick = nextTick;
    const current = readBeltState(sim, sourceId, middleId, sinkId);
    traces.push(toTransportFrame(tick, previous, current));
    previous = current;
  }

  return traces;
};

export const findFirstTransportTraceDivergence = (
  expected: ReadonlyArray<TransportTraceFrame>,
  actual: ReadonlyArray<TransportTraceFrame>,
): TransportTraceDivergence | null => {
  if (expected.length !== actual.length) {
    throw new Error(
      `Transport trace length mismatch: expected ${expected.length} frames but got ${actual.length}`,
    );
  }

  for (let index = 0; index < expected.length; index += 1) {
    const left = expected[index];
    const right = actual[index];

    if (!transportFramesEqual(left, right)) {
      return {
        index,
        tick: left.tick,
        expected: left,
        actual: right,
      };
    }
  }

  return null;
};
