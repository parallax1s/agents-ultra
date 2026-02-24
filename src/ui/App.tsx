/// <reference path="../types/react-shim.d.ts" />
/// <reference path="../types/modules.d.ts" />

import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import Palette from './palette';
import {
  ALL_ENTITY_KINDS,
  createPlacementController,
  type CoreActionOutcome,
  type EntityKind,
  TOOLBAR_ENTITY_ORDER,
  type Rotation,
  type Simulation,
} from './placement';
import { createRenderer, preloadRendererSvgs } from './renderer';
import { createMap } from '../core/map';
import { createSim } from '../core/sim';
import {
  detectCoarsePointer,
  type UiSettings,
  normalizeUiSettings,
  getSystemReducedMotion,
  UI_SETTINGS_STORAGE_KEY,
} from './ui-settings';
import '../entities/all';

const TILE_SIZE = 32;
const WORLD_WIDTH = 60;
const WORLD_HEIGHT = 40;
const WORLD_SEED = 'agents-ultra';
const SIM_STEP_MS = 1000 / 60;
const SAVE_STORAGE_KEY = 'agents-ultra-save-v1';
const PLAYER_MAX_FUEL = 100;
const PLAYER_MOVE_FUEL_COST = 1;
const PLAYER_MINE_FUEL_COST = 1;
const PLAYER_BUILD_FUEL_COST = 2;
const PLAYER_REFUEL_AMOUNT = 25;
const PLAYER_FUEL_INFINITE = true;
const PLAYER_INVENTORY_CAPACITY = 24;
const CAMERA_MIN_ZOOM = 0.5;
const CAMERA_MAX_ZOOM = 10;
const CAMERA_ZOOM_STEP = 0.25;
const CAMERA_DEFAULT_ZOOM = 1;
const MINIMAP_CELL_SIZE = 3;
const MINIMAP_WIDTH = WORLD_WIDTH * MINIMAP_CELL_SIZE;
const MINIMAP_HEIGHT = WORLD_HEIGHT * MINIMAP_CELL_SIZE;
const TOOL_PANEL_LEFT = 12;
const HUD_LEFT = TOOL_PANEL_LEFT;
const WORLD_CANVAS_TEST_ID = 'world-canvas';
const RUNTIME_HISTORY_LIMIT = 60;
const RUNTIME_SAVE_SLOT_COUNT = 3;
const SAVE_SLOT_STORAGE_KEY_PREFIX = `${SAVE_STORAGE_KEY}-slot-`;
const RUNTIME_CHECKPOINT_STORAGE_KEY = `${SAVE_STORAGE_KEY}-checkpoints-v1`;
const RUNTIME_CHECKPOINT_SCHEMA_VERSION = 1;
const RUNTIME_CHECKPOINT_LIMIT = 12;
const SAVE_SLOT_INDEX_FALLBACK = 0;
const RUNTIME_AGENT_PLAN_STORAGE_KEY = 'agents-ultra-agent-plan-v1';
const RUNTIME_AGENT_PLAN_STORAGE_SCHEMA_VERSION = 1;
const RUNTIME_SAVE_SCHEMA_VERSION = 2;
const RUNTIME_BLUEPRINT_SCHEMA_VERSION = 1;
const RUNTIME_SHARE_SCHEMA_VERSION = 1;
const RUNTIME_AGENT_PLAN_DEFAULT_AGENT_ID = 'agent-default';
const MAX_RUNTIME_SAVE_IMPORT_BYTES = 1_000_000;
const MAX_RUNTIME_BLUEPRINT_IMPORT_BYTES = 1_000_000;
const MAX_RUNTIME_BLUEPRINT_ENTITIES = 5000;
const MAX_RUNTIME_PLAN_IMPORT_BYTES = 200_000;
const MAX_RUNTIME_AGENT_PLAN_COMMANDS = 5_000;
const RUNTIME_PLAN_DEFAULT_STEP_DELAY_MS = 80;
const RUNTIME_PLAN_MIN_STEP_DELAY_MS = 20;
const RUNTIME_PLAN_MAX_STEP_DELAY_MS = 2_000;
const RUNTIME_PLAN_MAX_LOG_ENTRIES = 24;
export const RUNTIME_SHARE_URL_QUERY_PARAM = 'runtime-share';

type ShortcutHelpItem = {
  keys: string;
  description: string;
};

type ShortcutHelpAction = {
  id: string;
  label: string;
  description: string;
};

type ShortcutHelpSection = {
  heading: string;
  items: ReadonlyArray<ShortcutHelpItem>;
};

type RuntimeAgentDirection = RuntimeDirection;

type RuntimeAgentPlanCommand =
  | {
      type: 'select';
      tool: EntityKind | 'none';
    }
  | {
      type: 'rotate';
      steps: number;
    }
  | {
      type: 'set-rotation';
      rotation: Rotation;
    }
  | {
      type: 'place' | 'remove';
      x: number;
      y: number;
      tool?: EntityKind;
      rotation?: Rotation;
    }
  | {
      type: 'move';
      direction: RuntimeAgentDirection;
    }
  | {
      type: 'step';
      ticks: number;
    }
  | {
      type: 'pause' | 'resume' | 'toggle-pause';
    }
  | {
      type: 'enable-agent' | 'disable-agent';
      targetAgent: string;
    }
  | {
      type: 'set-plan-speed';
      delayMs: number;
    }
  | {
      type: 'set-agent-speed';
      targetAgent: string;
      delayMs: number;
    }
  | {
      type: 'set-agent-order';
      order: string[];
    }
  | {
      type: 'enable-automation' | 'disable-automation';
      automationAgent: 'auto-refuel' | 'auto-pickup' | 'auto-deposit';
    }
  | {
      type: 'interact';
      action: 'pickup' | 'deposit' | 'refuel';
      x?: number;
      y?: number;
    }
  & {
    agent?: string;
    };

type RuntimeAgentPlan = {
  version: number;
  commands: RuntimeAgentPlanCommand[];
  name?: string;
  tags?: Record<string, unknown>;
};

type RuntimeAgentPlanStoragePayload = {
  schemaVersion: number;
  plan: RuntimeAgentPlan;
  enabledAgents?: RuntimeAgentPlanEnabledAgents;
};

type RuntimeAgentPlanExecutionState = {
  agentOrder: string[];
  commandIndexesByAgent: Record<string, number[]>;
  commandCursorByAgent: Record<string, number>;
  nextAgentCursor: number;
};

type RuntimeAgentPlanExecutionFilter = {
  enabledAgents?: ReadonlySet<string>;
};

type RuntimeAgentPlanEnabledAgents = Record<string, boolean>;

type RuntimeAgentPlanNextCommand = {
  agent: string;
  command: RuntimeAgentPlanCommand;
  commandIndex: number;
};

type RuntimeAgentPlanCommandDescription = {
  label: string;
  details: string;
};

type RuntimeAgentPlanAgentSummary = {
  agent: string;
  totalCommands: number;
  completedCommands: number;
  enabled: boolean;
};

type RuntimeAgentPlanParseResult =
  | {
      status: 'missing';
      plan: null;
      enabledAgents: null;
      warnings: string[];
    }
  | {
      status: 'invalid';
      plan: null;
      enabledAgents: null;
      warnings: string[];
    }
  | {
      status: 'valid';
      plan: RuntimeAgentPlan;
      enabledAgents: RuntimeAgentPlanEnabledAgents;
      warnings: string[];
    };

type RuntimeSaveCompatibilityWarning = {
  code:
    | 'map-size-mismatch'
    | 'seed-mismatch'
    | 'schema-version-upgraded'
    | 'unknown-entity-kind'
    | 'entity-position-clamped'
    | 'entity-kind-normalized'
    | 'player-position-clamped'
    | 'power-field-clamped';
  message: string;
};

type RuntimeSaveImportValidation = {
  errors: string[];
  warnings: string[];
};

type RuntimeSharePayloadKind = 'runtime-save' | 'runtime-blueprint';

type RuntimeShareEnvelope = {
  kind: RuntimeSharePayloadKind;
  schemaVersion: number;
  payload: RuntimeSaveState | RuntimeBlueprintState;
  createdAt?: string;
};

type RuntimeShareImportValidation = {
  errors: string[];
  warnings: string[];
  kind: RuntimeSharePayloadKind | null;
  savePayload: RuntimeSaveState | null;
  blueprintPayload: RuntimeBlueprintState | null;
};

type RuntimeAgentPlanImportValidation = {
  errors: string[];
  warnings: string[];
  plan: RuntimeAgentPlan | null;
};

type RuntimeAgentPlanImportPayload = {
  errors: string[];
  warnings: string[];
  plan: RuntimeAgentPlan | null;
  enabledAgents: RuntimeAgentPlanEnabledAgents | null;
};

type RuntimeSaveCompatibilitySummary = {
  state: RuntimeSaveState;
  warnings: RuntimeSaveCompatibilityWarning[];
};

type RuntimeBlueprintEntity = {
  kind: RuntimeEntityKind;
  pos: Tile;
  rot: RuntimeDirection;
};

type RuntimeBlueprintState = {
  version: number;
  schemaVersion?: number;
  anchor: Tile;
  entities: RuntimeBlueprintEntity[];
  name?: string;
  createdAt?: string;
};

type RuntimeBlueprintImportValidation = {
  errors: string[];
  warnings: string[];
  blueprint: RuntimeBlueprintState | null;
};

type RuntimeBlueprintPlacementIssue = {
  index: number;
  kind: RuntimeEntityKind;
  x: number;
  y: number;
  code: 'out-of-bounds' | 'tile-occupied' | 'player-tile' | 'resource-required' | 'unsupported-entity' | 'insufficient-fuel' | 'invalid-placement';
  message: string;
};

type RuntimeBlueprintPlacementPlan = {
  kind: RuntimeEntityKind;
  tile: Tile;
  rotation: Rotation;
};

type RuntimeBlueprintPlacementInspectionContext = {
  playerSnapshot: {
    x: number;
    y: number;
    fuel: number;
  };
  occupiedTiles?: ReadonlyArray<Tile> | ReadonlySet<string>;
  isOre?: (x: number, y: number) => boolean;
  canPlacePlacement?: (kind: EntityKind, tile: Tile, rotation: Rotation) => CoreActionOutcome | boolean;
};

type RuntimeBlueprintPlacementInspectionResult = {
  planned: RuntimeBlueprintPlacementPlan[];
  blockers: RuntimeBlueprintPlacementIssue[];
  bounds: { left: number; top: number; right: number; bottom: number } | null;
  fuelCost: number;
  ok: boolean;
};

const isRuntimeAgentPlanCommandType = (value: unknown): value is RuntimeAgentPlanCommand['type'] => {
  return value === 'select'
    || value === 'rotate'
    || value === 'set-rotation'
    || value === 'place'
    || value === 'remove'
    || value === 'move'
    || value === 'step'
    || value === 'pause'
    || value === 'resume'
    || value === 'toggle-pause'
    || value === 'enable-agent'
    || value === 'disable-agent'
    || value === 'set-plan-speed'
    || value === 'set-agent-speed'
    || value === 'set-agent-order'
    || value === 'enable-automation'
    || value === 'disable-automation'
    || value === 'interact';
};

const parseRuntimeAgentPlanTargetAgent = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const parseRuntimeAgentPlanAutomationAgent = (
  value: unknown,
): 'auto-refuel' | 'auto-pickup' | 'auto-deposit' | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return null;
  }

  if (normalized === 'auto-refuel' || normalized === 'autorefuel' || normalized === 'refuel') {
    return 'auto-refuel';
  }

  if (normalized === 'auto-pickup' || normalized === 'autopickup' || normalized === 'pickup') {
    return 'auto-pickup';
  }

  if (normalized === 'auto-deposit' || normalized === 'autodeposit' || normalized === 'deposit') {
    return 'auto-deposit';
  }

  return null;
};

const parseRuntimeAgentPlanInteractionAction = (
  value: unknown,
): 'pickup' | 'deposit' | 'refuel' | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return null;
  }

  if (normalized === 'pickup' || normalized === 'take' || normalized === 'grab') {
    return 'pickup';
  }

  if (normalized === 'deposit' || normalized === 'put' || normalized === 'drop') {
    return 'deposit';
  }

  if (normalized === 'refuel' || normalized === 'fuel' || normalized === 'recharge') {
    return 'refuel';
  }

  return null;
};

const parseRuntimeAgentPlanAgentOrder = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const parsed: string[] = [];
  const seen = new Set<string>();
  for (const rawEntry of value) {
    if (typeof rawEntry !== 'string') {
      return null;
    }

    const normalized = rawEntry.trim();
    if (normalized.length === 0) {
      return null;
    }

    if (!seen.has(normalized)) {
      seen.add(normalized);
      parsed.push(normalized);
    }
  }

  return parsed.length > 0 ? parsed : null;
};

const normalizeRuntimeAgentPlanCommandAgent = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const parseRuntimeAgentDirection = (value: unknown): RuntimeAgentDirection | null => {
  if (value === 'N' || value === 'E' || value === 'S' || value === 'W') {
    return value;
  }

  return null;
};

const parseRuntimeAgentPlanTool = (value: unknown): EntityKind | 'none' | null => {
  if (value === null || value === undefined || value === 'none') {
    return 'none';
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }

  if (RUNTIME_TOOL_CYCLE_ORDER.includes(normalized as EntityKind)) {
    return normalized as EntityKind;
  }

  const normalizedLower = normalized.toLowerCase();
  const matchingLabel = RUNTIME_TOOL_CYCLE_ORDER.find((kind) => kind.toLowerCase() === normalizedLower);
  if (matchingLabel !== undefined) {
    return matchingLabel;
  }

  return null;
};

const resolveRuntimeAgentPlanCommandAgent = (command: RuntimeAgentPlanCommand): string => {
  return command.agent === undefined || command.agent.trim().length === 0
    ? RUNTIME_AGENT_PLAN_DEFAULT_AGENT_ID
    : command.agent;
};

export const createRuntimeAgentPlanExecutionState = (plan: RuntimeAgentPlan): RuntimeAgentPlanExecutionState => {
  const commandIndexesByAgent: Record<string, number[]> = {};
  const commandCursorByAgent: Record<string, number> = {};
  const agentOrder: string[] = [];

  for (let index = 0; index < plan.commands.length; index += 1) {
    const command = plan.commands[index];
    if (command === undefined) {
      continue;
    }

    const agent = resolveRuntimeAgentPlanCommandAgent(command);
    if (commandIndexesByAgent[agent] === undefined) {
      commandIndexesByAgent[agent] = [];
      commandCursorByAgent[agent] = 0;
      agentOrder.push(agent);
    }
    commandIndexesByAgent[agent].push(index);
  }

  return {
    agentOrder,
    commandIndexesByAgent,
    commandCursorByAgent,
    nextAgentCursor: 0,
  };
};

export const pickNextRuntimeAgentPlanCommand = (
  plan: RuntimeAgentPlan,
  state: RuntimeAgentPlanExecutionState,
  options?: RuntimeAgentPlanExecutionFilter,
): RuntimeAgentPlanNextCommand | null => {
  if (state.agentOrder.length === 0) {
    return null;
  }

  const enabledAgents = options?.enabledAgents;
  const hasAgentFilter = enabledAgents !== undefined;

  for (let index = 0; index < state.agentOrder.length; index += 1) {
    const agentIndex = (state.nextAgentCursor + index) % state.agentOrder.length;
    const agent = state.agentOrder[agentIndex];

    if (hasAgentFilter && !enabledAgents.has(agent)) {
      continue;
    }

    const commandIndexes = state.commandIndexesByAgent[agent];
    const cursor = state.commandCursorByAgent[agent] ?? 0;

    if (commandIndexes === undefined || cursor < 0 || cursor >= commandIndexes.length) {
      continue;
    }

    const commandIndex = commandIndexes[cursor];
    if (typeof commandIndex !== 'number') {
      continue;
    }

    const command = plan.commands[commandIndex];
    if (command === undefined) {
      continue;
    }

    state.commandCursorByAgent[agent] = cursor + 1;
    state.nextAgentCursor = (agentIndex + 1) % state.agentOrder.length;

    return {
      agent,
      command,
      commandIndex,
    };
  }

  return null;
};

export const cloneRuntimeAgentPlanExecutionState = (
  state: RuntimeAgentPlanExecutionState,
): RuntimeAgentPlanExecutionState => {
  const clonedCommandIndexesByAgent: Record<string, number[]> = {};
  const clonedCommandCursorByAgent: Record<string, number> = {};

  for (const [agent, cursor] of Object.entries(state.commandCursorByAgent)) {
    clonedCommandCursorByAgent[agent] = cursor;
  }

  for (const [agent, commandIndexes] of Object.entries(state.commandIndexesByAgent)) {
    clonedCommandIndexesByAgent[agent] = commandIndexes.slice();
  }

  return {
    agentOrder: state.agentOrder.slice(),
    commandIndexesByAgent: clonedCommandIndexesByAgent,
    commandCursorByAgent: clonedCommandCursorByAgent,
    nextAgentCursor: state.nextAgentCursor,
  };
};

export const peekNextRuntimeAgentPlanCommand = (
  plan: RuntimeAgentPlan,
  state: RuntimeAgentPlanExecutionState,
  options?: RuntimeAgentPlanExecutionFilter,
): RuntimeAgentPlanNextCommand | null => {
  const workingState = cloneRuntimeAgentPlanExecutionState(state);
  return pickNextRuntimeAgentPlanCommand(plan, workingState, options);
};

export const isRuntimeAgentPlanCommandStateMutating = (command: RuntimeAgentPlanCommand): boolean => {
  return command.type === 'place'
    || command.type === 'remove'
    || command.type === 'move'
    || command.type === 'step'
    || command.type === 'pause'
    || command.type === 'resume'
    || command.type === 'toggle-pause'
    || command.type === 'interact';
};

export const describeRuntimeAgentPlanCommand = (command: RuntimeAgentPlanCommand): RuntimeAgentPlanCommandDescription => {
  const rotationLabel = (rotation: Rotation | undefined): string => {
    return rotation === 0 ? 'north (N)' : rotation === 1 ? 'east (E)' : rotation === 2 ? 'south (S)' : 'west (W)';
  };

  if (command.type === 'select') {
    return {
      label: 'select',
      details:
        command.tool === 'none'
          ? 'clear tool'
          : `tool ${command.tool}`,
    };
  }

  if (command.type === 'rotate') {
    const normalizedSteps = ((command.steps % 4) + 4) % 4;
    return {
      label: 'rotate',
      details: `${normalizedSteps} step${normalizedSteps === 1 ? '' : 's'}`,
    };
  }

  if (command.type === 'set-rotation') {
    return {
      label: 'set rotation',
      details: rotationLabel(command.rotation),
    };
  }

  if (command.type === 'place' || command.type === 'remove') {
    const action = command.type === 'place' ? 'place' : 'remove';
    const tool = command.tool === undefined ? 'entity' : command.tool;
    return {
      label: action,
      details: `${tool} at (${command.x}, ${command.y})${command.rotation === undefined ? '' : `, ${rotationLabel(command.rotation)}`}`,
    };
  }

  if (command.type === 'move') {
    return {
      label: 'move',
      details: command.direction,
    };
  }

  if (command.type === 'step') {
    return {
      label: 'step',
      details: `${command.ticks} tick${command.ticks === 1 ? '' : 's'}`,
    };
  }

  if (command.type === 'enable-agent' || command.type === 'disable-agent') {
    return {
      label: command.type === 'enable-agent' ? 'enable agent' : 'disable agent',
      details: command.targetAgent,
    };
  }

  if (command.type === 'set-plan-speed') {
    return {
      label: 'set plan speed',
      details: `${command.delayMs}ms`,
    };
  }

  if (command.type === 'set-agent-speed') {
    return {
      label: 'set agent speed',
      details: `${command.targetAgent} -> ${command.delayMs}ms`,
    };
  }

  if (command.type === 'set-agent-order') {
    return {
      label: 'set agent order',
      details: command.order.join(' -> '),
    };
  }

  if (command.type === 'enable-automation' || command.type === 'disable-automation') {
    return {
      label: command.type === 'enable-automation' ? 'enable automation' : 'disable automation',
      details: command.automationAgent,
    };
  }

  if (command.type === 'interact') {
    const target = command.x === undefined || command.y === undefined
      ? 'self'
      : `(${command.x}, ${command.y})`;
    return {
      label: 'interact',
      details: `${command.action} ${target}`,
    };
  }

  return {
    label: 'pause state',
    details: command.type,
  };
};

export const describeRuntimeAgentPlanCommandForLog = (command: RuntimeAgentPlanCommand): string => {
  const described = describeRuntimeAgentPlanCommand(command);
  const agentSuffix = command.agent === undefined ? '' : ` [${command.agent}]`;
  return `${described.label} ${described.details}${agentSuffix}`;
};

export const describeNextRuntimeAgentPlanCommand = (
  command: RuntimeAgentPlanNextCommand | null,
): string => {
  if (command === null) {
    return 'No pending command.';
  }

  return `#${command.commandIndex + 1} ${command.agent}: ${describeRuntimeAgentPlanCommandForLog(command.command)}`;
};

export const clampRuntimePlanStepDelayMs = (value: unknown): number => {
  const next = typeof value === 'number' && Number.isFinite(value) ? value : RUNTIME_PLAN_DEFAULT_STEP_DELAY_MS;
  const rounded = Math.round(next);
  const clamped = Math.min(RUNTIME_PLAN_MAX_STEP_DELAY_MS, Math.max(RUNTIME_PLAN_MIN_STEP_DELAY_MS, rounded));
  return clamped;
};

const createDefaultRuntimePlanEnabledAgentsState = (plan: RuntimeAgentPlan | null): RuntimeAgentPlanEnabledAgents => {
  if (plan === null) {
    return {};
  }

  const executionState = createRuntimeAgentPlanExecutionState(plan);
  const enabledAgents: RuntimeAgentPlanEnabledAgents = {};
  for (const agent of executionState.agentOrder) {
    enabledAgents[agent] = true;
  }
  return enabledAgents;
};

const resolveRuntimePlanEnabledAgentsFromStorage = (
  plan: RuntimeAgentPlan | null,
  rawEnabledAgents: unknown,
): RuntimeAgentPlanEnabledAgents => {
  if (plan === null) {
    return {};
  }

  const executionState = createRuntimeAgentPlanExecutionState(plan);
  const enabledAgents: RuntimeAgentPlanEnabledAgents = {};
  const raw = isRecord(rawEnabledAgents) ? rawEnabledAgents : null;

  for (const agent of executionState.agentOrder) {
    const candidate = raw?.[agent];
    enabledAgents[agent] = candidate === false ? false : true;
  }

  return enabledAgents;
};

const resolveEnabledRuntimePlanAgents = (
  plan: RuntimeAgentPlan,
  enabledAgents: RuntimeAgentPlanEnabledAgents,
): ReadonlySet<string> => {
  const executionState = createRuntimeAgentPlanExecutionState(plan);
  const enabledAgentSet = new Set<string>();

  for (const agent of executionState.agentOrder) {
    if (enabledAgents[agent] !== false) {
      enabledAgentSet.add(agent);
    }
  }

  return enabledAgentSet;
};

const hasEnabledRuntimePlanAgents = (enabledAgents: RuntimeAgentPlanEnabledAgents): boolean => {
  return Object.values(enabledAgents).some((enabled) => enabled);
};

export const summarizeRuntimePlanAgents = (
  plan: RuntimeAgentPlan | null,
  executionState: RuntimeAgentPlanExecutionState | null,
  enabledAgents: RuntimeAgentPlanEnabledAgents,
): RuntimeAgentPlanAgentSummary[] => {
  if (plan === null) {
    return [];
  }

  const effectiveState = executionState ?? createRuntimeAgentPlanExecutionState(plan);
  const summaries: RuntimeAgentPlanAgentSummary[] = [];

  for (const agent of effectiveState.agentOrder) {
    const commandIndexes = effectiveState.commandIndexesByAgent[agent];
    const totalCommands = Array.isArray(commandIndexes) ? commandIndexes.length : 0;
    const rawCompleted = effectiveState.commandCursorByAgent[agent];
    const completedCommands = Math.max(
      0,
      Math.min(rawCompleted === undefined ? 0 : rawCompleted, totalCommands),
    );
    summaries.push({
      agent,
      totalCommands,
      completedCommands,
      enabled: enabledAgents[agent] !== false,
    });
  }

  return summaries;
};

const normalizeRuntimeAgentPlanCommand = (value: unknown): RuntimeAgentPlanCommand | null => {
  if (!isRecord(value)) {
    return null;
  }

  const rawType = value.type;
  if (!isRuntimeAgentPlanCommandType(rawType)) {
    return null;
  }

  if (rawType === 'select') {
    const tool = parseRuntimeAgentPlanTool(value.tool);
    if (tool === null) {
      return null;
    }
    const agent = normalizeRuntimeAgentPlanCommandAgent(value.agent);

    return {
      type: 'select',
      tool: tool === 'none' ? 'none' : tool,
      ...(agent === undefined ? {} : { agent }),
    };
  }

  if (rawType === 'rotate') {
    const steps = toInt(value.steps);
    if (steps === null) {
      return null;
    }
    const agent = normalizeRuntimeAgentPlanCommandAgent(value.agent);

    return {
      type: 'rotate',
      steps,
      ...(agent === undefined ? {} : { agent }),
    };
  }

  if (rawType === 'set-rotation') {
    const rotation = toInt(value.rotation);
    if (rotation === null) {
      return null;
    }

    const normalizedRotation = ((rotation % 4) + 4) % 4;
    const agent = normalizeRuntimeAgentPlanCommandAgent(value.agent);

    return {
      type: 'set-rotation',
      rotation: normalizedRotation as Rotation,
      ...(agent === undefined ? {} : { agent }),
    };
  }

  if (rawType === 'place' || rawType === 'remove') {
    const x = toInt(value.x);
    const y = toInt(value.y);
    if (x === null || y === null) {
      return null;
    }

    if (x < 0 || y < 0 || x >= WORLD_WIDTH || y >= WORLD_HEIGHT) {
      return null;
    }

    const tool = value.tool === undefined ? undefined : parseRuntimeAgentPlanTool(value.tool);
    const rawRotation = toInt(value.rotation);
    const commandRotation = rawRotation === null ? undefined : ((rawRotation % 4) + 4) % 4;
    if (tool === null) {
      return null;
    }

    if (rawRotation !== null && commandRotation === null) {
      return null;
    }

    const command: RuntimeAgentPlanCommand = {
      type: rawType,
      x,
      y,
      rotation: commandRotation === undefined ? undefined : commandRotation as Rotation,
    };
    const agent = normalizeRuntimeAgentPlanCommandAgent(value.agent);
    if (agent !== undefined) {
      command.agent = agent;
    }
    if (tool !== undefined && tool !== 'none') {
      command.tool = tool;
    }

    return command;
  }

  if (rawType === 'move') {
    const direction = parseRuntimeAgentDirection(value.direction);
    if (direction === null) {
      return null;
    }
    const agent = normalizeRuntimeAgentPlanCommandAgent(value.agent);

    return {
      type: 'move',
      direction,
      ...(agent === undefined ? {} : { agent }),
    };
  }

  if (rawType === 'step') {
    const ticks = toInt(value.ticks);
    if (ticks === null || ticks <= 0) {
      return null;
    }
    const agent = normalizeRuntimeAgentPlanCommandAgent(value.agent);

    return {
      type: 'step',
      ticks,
      ...(agent === undefined ? {} : { agent }),
    };
  }

  if (rawType === 'enable-agent' || rawType === 'disable-agent') {
    const targetAgent = parseRuntimeAgentPlanTargetAgent((value as { targetAgent?: unknown }).targetAgent)
      ?? parseRuntimeAgentPlanTargetAgent((value as { target?: unknown }).target)
      ?? parseRuntimeAgentPlanTargetAgent((value as { agentId?: unknown }).agentId)
      ?? parseRuntimeAgentPlanTargetAgent((value as { id?: unknown }).id)
      ?? parseRuntimeAgentPlanTargetAgent((value as { targetAgentId?: unknown }).targetAgentId);

    if (targetAgent === null) {
      return null;
    }

    const agent = normalizeRuntimeAgentPlanCommandAgent(value.agent);
    return {
      type: rawType,
      targetAgent,
      ...(agent === undefined ? {} : { agent }),
    };
  }

  if (rawType === 'set-plan-speed') {
    const delayMs = toInt(value.delayMs);
    if (delayMs === null || delayMs <= 0) {
      return null;
    }
    const agent = normalizeRuntimeAgentPlanCommandAgent(value.agent);
    return {
      type: rawType,
      delayMs: clampRuntimePlanStepDelayMs(delayMs),
      ...(agent === undefined ? {} : { agent }),
    };
  }

  if (rawType === 'set-agent-speed') {
    const targetAgent = parseRuntimeAgentPlanTargetAgent((value as { targetAgent?: unknown }).targetAgent)
      ?? parseRuntimeAgentPlanTargetAgent((value as { target?: unknown }).target)
      ?? parseRuntimeAgentPlanTargetAgent((value as { targetAgentId?: unknown }).targetAgentId)
      ?? parseRuntimeAgentPlanTargetAgent((value as { agentId?: unknown }).agentId)
      ?? parseRuntimeAgentPlanTargetAgent((value as { id?: unknown }).id);

    const delayMs = toInt(value.delayMs);
    if (delayMs === null || delayMs <= 0 || targetAgent === null) {
      return null;
    }

    const agent = normalizeRuntimeAgentPlanCommandAgent(value.agent);
    return {
      type: rawType,
      targetAgent,
      delayMs: clampRuntimePlanStepDelayMs(delayMs),
      ...(agent === undefined ? {} : { agent }),
    };
  }

  if (rawType === 'set-agent-order') {
    const order = parseRuntimeAgentPlanAgentOrder(
      (value as { order?: unknown }).order
      ?? (value as { agents?: unknown }).agents
      ?? (value as { agentOrder?: unknown }).agentOrder,
    );
    if (order === null) {
      return null;
    }

    const agent = normalizeRuntimeAgentPlanCommandAgent(value.agent);
    return {
      type: rawType,
      order,
      ...(agent === undefined ? {} : { agent }),
    };
  }

  if (rawType === 'enable-automation' || rawType === 'disable-automation') {
    const automationAgent = parseRuntimeAgentPlanAutomationAgent((value as { automationAgent?: unknown }).automationAgent)
      ?? parseRuntimeAgentPlanAutomationAgent((value as { automationAgentId?: unknown }).automationAgentId)
      ?? parseRuntimeAgentPlanAutomationAgent((value as { agentId?: unknown }).agentId)
      ?? parseRuntimeAgentPlanAutomationAgent((value as { id?: unknown }).id)
      ?? parseRuntimeAgentPlanAutomationAgent((value as { targetAgent?: unknown }).targetAgent);

    if (automationAgent === null) {
      return null;
    }

    const agent = normalizeRuntimeAgentPlanCommandAgent(value.agent);
    return {
      type: rawType,
      automationAgent,
      ...(agent === undefined ? {} : { agent }),
    };
  }

  if (rawType === 'interact') {
    const action = parseRuntimeAgentPlanInteractionAction((value as { action?: unknown }).action);
    if (action === null) {
      return null;
    }

    const rawX = toSignedInt((value as { x?: unknown }).x);
    const rawY = toSignedInt((value as { y?: unknown }).y);
    if ((rawX === null && rawY !== null) || (rawX !== null && rawY === null)) {
      return null;
    }

    if (rawX !== null && (rawX < 0 || rawX >= WORLD_WIDTH)) {
      return null;
    }
    if (rawY !== null && (rawY < 0 || rawY >= WORLD_HEIGHT)) {
      return null;
    }

    const agent = normalizeRuntimeAgentPlanCommandAgent(value.agent);
    const command: RuntimeAgentPlanCommand = {
      type: 'interact',
      action,
      ...(rawX === null || rawY === null ? {} : { x: rawX, y: rawY }),
      ...(agent === undefined ? {} : { agent }),
    };
    return command;
  }

  const agent = normalizeRuntimeAgentPlanCommandAgent(value.agent);
  const command: RuntimeAgentPlanCommand = {
    type: rawType,
  };
  if (agent !== undefined) {
    command.agent = agent;
  }
  return command;
};

const normalizeRuntimeAgentPlan = (value: unknown): RuntimeAgentPlan | null => {
  const payload = isRecord(value) ? value : null;
  const commandsSource = Array.isArray(value)
    ? value
    : payload !== null && Array.isArray(payload.commands)
      ? payload.commands
      : null;

  if (commandsSource === null) {
    return null;
  }

  const commands: RuntimeAgentPlanCommand[] = [];
  for (const rawCommand of commandsSource) {
    const next = normalizeRuntimeAgentPlanCommand(rawCommand);
    if (next === null) {
      return null;
    }
    commands.push(next);
  }

  const rawVersion = payload !== null ? toInt(payload.version) : null;
  const version = rawVersion === null || rawVersion <= 0 ? 1 : rawVersion;
  const rawName = typeof payload?.name === 'string' ? payload.name.trim() : '';

  return {
    version,
    commands,
    name: rawName.length > 0 ? rawName : undefined,
  };
};

const normalizeRuntimeAgentPlanStoragePayload = (
  raw: unknown,
): RuntimeAgentPlanStoragePayload | null => {
  const payload = isRecord(raw) ? raw : null;
  const rawPlan = payload === null || payload.plan === undefined ? raw : payload.plan;
  const plan = normalizeRuntimeAgentPlan(rawPlan);
  if (plan === null) {
    return null;
  }

  const schemaVersion = (() => {
    const value = payload === null ? null : toInt(payload.schemaVersion);
    return value === null || value <= 0 ? RUNTIME_AGENT_PLAN_STORAGE_SCHEMA_VERSION : value;
  })();

  const enabledAgents = resolveRuntimePlanEnabledAgentsFromStorage(
    plan,
    payload === null ? null : payload.enabledAgents,
  );

  return {
    schemaVersion,
    plan,
    enabledAgents,
  };
};

const writeRuntimeAgentPlanStoragePayload = (
  plan: RuntimeAgentPlan,
  enabledAgents: RuntimeAgentPlanEnabledAgents,
): boolean => {
  const payload: RuntimeAgentPlanStoragePayload = {
    schemaVersion: RUNTIME_AGENT_PLAN_STORAGE_SCHEMA_VERSION,
    plan,
    enabledAgents: resolveRuntimePlanEnabledAgentsFromStorage(plan, enabledAgents),
  };
  return writeRuntimeStorageItem(RUNTIME_AGENT_PLAN_STORAGE_KEY, JSON.stringify(payload));
};

const readRuntimeAgentPlanPayloadFromStorage = (storageKey: string): RuntimeAgentPlanParseResult => {
  const raw = readRuntimeStorageItem(storageKey);
  if (raw === null) {
    return { status: 'missing', plan: null, enabledAgents: null, warnings: [] };
  }

  if (raw.length > MAX_RUNTIME_PLAN_IMPORT_BYTES) {
    removeRuntimeStorageItem(storageKey);
    return { status: 'invalid', plan: null, enabledAgents: null, warnings: ['Stored plan payload is too large.'] };
  }

  const parsed = safeParseJson(raw);
  if (parsed === null) {
    removeRuntimeStorageItem(storageKey);
    return { status: 'invalid', plan: null, enabledAgents: null, warnings: ['Stored plan payload is invalid JSON.'] };
  }

  const normalized = resolveRuntimeAgentPlanImportPayload(parsed);
  if (normalized.plan === null) {
    removeRuntimeStorageItem(storageKey);
    return { status: 'invalid', plan: null, enabledAgents: null, warnings: normalized.warnings };
  }

  return {
    status: 'valid',
    plan: normalized.plan,
    enabledAgents: normalized.enabledAgents,
    warnings: normalized.warnings,
  };
};

type Tile = {
  x: number;
  y: number;
};

export type CameraState = {
  zoom: number;
  panX: number;
  panY: number;
};

type RendererApi = {
  setGhost(tile: Tile | null, valid: boolean): void;
  setCamera?(camera: CameraState): void;
  setReducedMotionEnabled?(enabled: boolean): void;
  requestRender?: () => void;
  destroy(): void;
  resize?(width: number, height: number): void;
};

type PaletteProps = {
  selectedKind: EntityKind | null;
  onSelectKind(kind: EntityKind): void;
};

type PaletteViewComponent = (props: PaletteProps) => ReturnType<typeof Palette>;

const PaletteView = Palette as unknown as PaletteViewComponent;

const ITEM_ORDER = ['iron-ore', 'iron-plate', 'iron-gear', 'coal', 'wood'] as const;
type RuntimeItemKind = (typeof ITEM_ORDER)[number];

const ITEM_COLORS: Record<RuntimeItemKind, string> = {
  'iron-ore': '#4f86f7',
  'iron-plate': '#f7ca4f',
  'iron-gear': '#c084fc',
  'coal': '#343434',
  'wood': '#4d6b37',
};

const MINIMAP_COLORS = {
  empty: '#111111',
  ore: '#3258a3',
  coal: '#444444',
  tree: '#2f5f2f',
  player: '#f7d76a',
  entities: {
    miner: '#ff6f6f',
    belt: '#8ab4ff',
    splitter: '#8affd7',
    inserter: '#ffb347',
    furnace: '#9e78da',
    chest: '#58b06f',
    assembler: '#7be4ff',
    'solar-panel': '#f6e85f',
    accumulator: '#d4c44a',
  } as Record<RuntimeEntityKind, string>,
};

type HotkeyMap = Record<string, EntityKind>;

const TOOL_HOTKEY_ORDER: ReadonlyArray<EntityKind> = TOOLBAR_ENTITY_ORDER.slice(0, 9);

const HOTKEY_TO_KIND: Readonly<HotkeyMap> = (() => {
  const entries = TOOL_HOTKEY_ORDER
    .flatMap((kind, index) => {
      const digit = String(index + 1);
      return [
        [
          `Digit${digit}`,
          kind,
        ] as const,
        [
          `Numpad${digit}`,
          kind,
        ] as const,
      ];
    });

  return Object.fromEntries(entries) as HotkeyMap;
})();

type HudSyncOptions = {
  includeMinimap?: boolean;
  includeMetrics?: boolean;
  includeFuel?: boolean;
  includePlayer?: boolean;
  includeInventory?: boolean;
  includeAdjacent?: boolean;
};

type RuntimeDirection = 'N' | 'E' | 'S' | 'W';
type RuntimeEntityKind = 'miner' | 'belt' | 'splitter' | 'inserter' | 'furnace' | 'chest' | 'assembler' | 'solar-panel' | 'accumulator';

type RuntimeEntity = {
  id: string;
  kind: RuntimeEntityKind;
  pos: Tile;
  rot: RuntimeDirection;
  state?: Record<string, unknown>;
};

type RuntimeSaveEntity = {
  kind: string;
  pos: Tile;
  rot: RuntimeDirection;
  state?: Record<string, unknown>;
};

type RuntimeSaveInventory = {
  ore: number;
  plate: number;
  gear: number;
  coal: number;
  wood: number;
  used: number;
  capacity: number;
};

type RuntimeSavePlayer = {
  x: number;
  y: number;
  rot: RuntimeDirection;
  fuel: number;
  maxFuel: number;
};

type RuntimeSaveCamera = {
  zoom: number;
  panX: number;
  panY: number;
  autoFollow?: boolean;
};

type RuntimeSaveState = {
  version: number;
  seed: string;
  width: number;
  height: number;
  tick: number;
  tickCount: number;
  elapsedMs: number;
  paused: boolean;
  player: RuntimeSavePlayer;
  inventory: RuntimeSaveInventory;
  entities: RuntimeSaveEntity[];
  power?: {
    storage?: number;
    capacity?: number;
    demandThisTick?: number;
    consumedThisTick?: number;
    generatedThisTick?: number;
    shortagesThisTick?: number;
  };
};

type RuntimeSaveEnvelope = RuntimeSaveState & {
  selectedKind?: EntityKind | null;
  selectedRotation?: Rotation;
  camera?: RuntimeSaveCamera;
  createdAt?: string;
};

type RuntimeCheckpoint = {
  createdAt: string;
  tick: number;
  reason: string;
  state: RuntimeSaveState;
};

type RuntimeCheckpointStoragePayload = {
  schemaVersion: number;
  checkpoints: RuntimeCheckpoint[];
  createdAt?: string;
};

type RuntimeNormalizedCheckpoint = RuntimeCheckpoint & {
  createdAtTime: number;
};

type ParseRuntimeSaveStateOptions = {
  fallbackPlayerRotation?: RuntimeDirection;
};

type RuntimeAdjacentInteractive = {
  id: string;
  x: number;
  y: number;
  kind: string;
  canAccept: ReadonlyArray<RuntimeItemKind>;
  canProvide: ReadonlyArray<RuntimeItemKind>;
  details: ReadonlyArray<string>;
};

type HudSelectedEntity = {
  id: string;
  kind: string;
  x: number;
  y: number;
  canAccept: ReadonlyArray<RuntimeItemKind>;
  canProvide: ReadonlyArray<RuntimeItemKind>;
  details: ReadonlyArray<string>;
};

type RuntimeItemKindOrder = ReadonlyArray<RuntimeItemKind>;

type RuntimeItemHost = {
  id: string;
  kind: string;
  x: number;
  y: number;
  state: Record<string, unknown>;
  canAcceptItem?: (item: string) => boolean;
  acceptItem?: (item: string) => boolean;
  canProvideItem?: (item: string) => boolean;
  provideItem?: (item: string) => string | null;
};

type TutorialMissionId =
  | 'move-player'
  | 'select-tool'
  | 'place-miner'
  | 'place-belt'
  | 'place-chest'
  | 'mine-resource'
  | 'transfer-items'
  | 'build-power'
  | 'sustain-power'
  | 'refuel';

type TutorialMission = {
  id: TutorialMissionId;
  title: string;
  hint: string;
};

type TutorialMissionProgress = TutorialMission & {
  completed: boolean;
  completedAtTick?: number;
};

type TutorialMissionBaseline = {
  metrics: RuntimeMetrics;
  player: Tile;
};

const TUTORIAL_MISSION_ORDER: ReadonlyArray<TutorialMissionId> = [
  'move-player',
  'select-tool',
  'place-miner',
  'place-belt',
  'place-chest',
  'mine-resource',
  'transfer-items',
  'build-power',
  'sustain-power',
  'refuel',
];

const TUTORIAL_MISSIONS: ReadonlyArray<TutorialMission> = [
  {
    id: 'move-player',
    title: 'Move the player',
    hint: 'Use W/A/S/D or arrow keys to move once.',
  },
  {
    id: 'select-tool',
    title: 'Choose a build tool',
    hint: 'Select a tool (for example Miner or Belt).',
  },
  {
    id: 'place-miner',
    title: 'Place your first Miner',
    hint: 'Place Miner on an ore tile.',
  },
  {
    id: 'place-belt',
    title: 'Lay a Belt',
    hint: 'Place a Belt to move materials.',
  },
  {
    id: 'place-chest',
    title: 'Place a Chest',
    hint: 'Build a Chest to store items.',
  },
  {
    id: 'mine-resource',
    title: 'Mine a Resource',
    hint: 'Mine ore, coal, or a tree from an adjacent tile.',
  },
  {
    id: 'transfer-items',
    title: 'Move items with interactions',
    hint: 'Use Q/E or click a nearby host.',
  },
  {
    id: 'build-power',
    title: 'Build a power source',
    hint: 'Place a SolarPanel or Accumulator.',
  },
  {
    id: 'sustain-power',
    title: 'Sustain the power grid',
    hint: 'Keep consumers running with no power shortages.',
  },
  {
    id: 'refuel',
    title: 'Refuel',
    hint: 'Press F when inventory or nearby furnace has coal or wood.',
  },
];

const createInitialTutorialMissionState = (): TutorialMissionProgress[] => (
  TUTORIAL_MISSIONS.map((mission) => ({
    ...mission,
    completed: false,
  }))
);

const RUNTIME_TOOL_CYCLE_ORDER: ReadonlyArray<EntityKind> = [...TOOLBAR_ENTITY_ORDER];
const RUNTIME_KIND_LABEL: Record<RuntimeAdjacentInteractive["kind"] | string, string> = {
  chest: 'Chest',
  furnace: 'Furnace',
  miner: 'Miner',
  belt: 'Belt',
  splitter: 'Splitter',
  inserter: 'Inserter',
  assembler: 'Assembler',
  'solar-panel': 'SolarPanel',
  accumulator: 'Accumulator',
};

const RUNTIME_SAVE_ENTITY_KIND_ALIASES: Record<string, RuntimeEntityKind> = {
  Miner: 'miner',
  Belt: 'belt',
  Splitter: 'splitter',
  Inserter: 'inserter',
  Furnace: 'furnace',
  Chest: 'chest',
  Assembler: 'assembler',
  SolarPanel: 'solar-panel',
  'Solar-Panel': 'solar-panel',
  'Solar Panel': 'solar-panel',
  'solar panel': 'solar-panel',
  solarpanel: 'solar-panel',
  Accumulator: 'accumulator',
  'Accumulator-Storage': 'accumulator',
  'Accumulator Storage': 'accumulator',
  'accumulator-storage': 'accumulator',
  'accumulator storage': 'accumulator',
  accumulator: 'accumulator',
};

const isRuntimeSaveEntityKind = (value: string): value is RuntimeEntityKind => {
  return value === 'miner'
    || value === 'belt'
    || value === 'splitter'
    || value === 'inserter'
    || value === 'furnace'
    || value === 'chest'
    || value === 'assembler'
    || value === 'solar-panel'
    || value === 'accumulator';
};

const normalizeRuntimeSaveEntityKind = (value: string): {
  kind: RuntimeEntityKind;
  changed: boolean;
} | null => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (isRuntimeSaveEntityKind(trimmed)) {
    return { kind: trimmed, changed: false };
  }

  const aliased = RUNTIME_SAVE_ENTITY_KIND_ALIASES[trimmed];
  if (aliased !== undefined) {
    return { kind: aliased, changed: true };
  }

  const lower = trimmed.toLowerCase();
  if (isRuntimeSaveEntityKind(lower)) {
    return { kind: lower, changed: trimmed !== lower };
  }

  const dashed = lower.replace(/\s+/g, '-');
  if (isRuntimeSaveEntityKind(dashed)) {
    return { kind: dashed, changed: dashed !== trimmed };
  }

  return null;
};

const addRuntimeSaveWarning = (
  warnings: RuntimeSaveCompatibilityWarning[],
  warning: RuntimeSaveCompatibilityWarning,
): void => {
  warnings.push(warning);
};

const describeRuntimeSaveCompatibilityWarnings = (warnings: RuntimeSaveCompatibilityWarning[]): string => {
  const summaryByCode = new Map<string, string>();
  for (const warning of warnings) {
    if (!summaryByCode.has(warning.code)) {
      summaryByCode.set(warning.code, warning.message);
    }
  }

  return summaryByCode.size === 0
    ? ''
    : `Compatibility adjustments: ${Array.from(summaryByCode.values()).join(' ')}`;
};

const ROTATION_TO_RUNTIME_DIRECTION: Readonly<Record<Rotation, RuntimeDirection>> = {
  0: 'N',
  1: 'E',
  2: 'S',
  3: 'W',
};

const DIRECTION_TO_RUNTIME_ROTATION: Readonly<Record<RuntimeDirection, Rotation>> = {
  N: 0,
  E: 1,
  S: 2,
  W: 3,
};

const RUNTIME_DIRECTION_BY_NUMBER: Readonly<Record<number, RuntimeDirection>> = {
  0: 'N',
  1: 'E',
  2: 'S',
  3: 'W',
};

type PlacementSnapshot = {
  tick: number;
  tickCount: number;
  elapsedMs: number;
  entityCount: number;
  fuel: number;
  maxFuel: number;
  player: Tile;
  inventory: {
    ore: number;
    plate: number;
    gear: number;
    coal: number;
    used: number;
    capacity: number;
  };
};

type InventoryState = PlacementSnapshot['inventory'];

type ChestStateLike = {
  capacity?: unknown;
  stored?: unknown;
  canAcceptItem?: unknown;
  acceptItem?: unknown;
  canProvideItem?: unknown;
  provideItem?: unknown;
  items?: unknown;
};

type RuntimeSimulation = Simulation & {
  width: number;
  height: number;
  tileSize: number;
  tick: number;
  tickCount: number;
  elapsedMs: number;
  saveState: () => RuntimeSaveState;
  loadState: (state: unknown) => CoreActionOutcome;
  stepTicks: (count: number) => CoreActionOutcome;
  reset: () => void;
  isPaused: () => boolean;
  getMap: () => ReturnType<typeof createMap>;
  getAllEntities: () => RuntimeEntity[];
  getPlacementSnapshot: () => PlacementSnapshot;
  getInventorySnapshot: () => PlacementSnapshot['inventory'];
  getPlayerSnapshot: () => { x: number; y: number; fuel: number; maxFuel: number; rot?: RuntimeDirection };
  movePlayer: (direction: RuntimeDirection) => CoreActionOutcome;
  refuel: () => CoreActionOutcome;
  pickupItem: () => CoreActionOutcome;
  depositItem: () => CoreActionOutcome;
  pause: () => void;
  resume: () => void;
  setRuntimeRenderCallback?: (callback: (() => void) | null) => void;
  interactWithChestAtTile?: (tile: Tile, action: 'pickup' | 'deposit') => CoreActionOutcome;
  interactWithItemHostAtTile?: (tile: Tile, action: 'pickup' | 'deposit') => CoreActionOutcome;
  mineResourceAtTile?: (tile: Tile) => CoreActionOutcome;
  getTileScreenPoint?: (tile: Tile) => { x: number; y: number } | null;
  getTileCanvasPoint?: (tile: Tile) => { x: number; y: number } | null;
  destroy: () => void;
};

type Feedback = {
  kind: 'success' | 'error';
  message: string;
};

type RuntimeMetrics = {
  entityCount: number;
  miners: number;
  belts: number;
  splitters: number;
  inserters: number;
  furnaces: number;
  chests: number;
  assemblers: number;
  solarPanels: number;
  accumulators: number;
  oreInTransit: number;
  platesInTransit: number;
  gearsInTransit: number;
  coalInTransit: number;
  woodInTransit: number;
  chestOre: number;
  chestPlates: number;
  chestGears: number;
  chestCoal: number;
  chestWood: number;
  oreRemaining: number;
  coalRemaining: number;
  woodRemaining: number;
  furnacesCrafting: number;
  furnacesReady: number;
  powerStorage: number;
  powerCapacity: number;
  powerDemandThisTick: number;
  powerConsumedThisTick: number;
  powerGeneratedThisTick: number;
  powerShortagesThisTick: number;
};

type AutomationAgentId = 'auto-refuel' | 'auto-pickup' | 'auto-deposit';

type AutomationAgentConfig = {
  id: AutomationAgentId;
  label: string;
  description: string;
  cooldownMs: number;
};

const AUTOMATION_AGENTS: ReadonlyArray<AutomationAgentConfig> = [
  {
    id: 'auto-refuel',
    label: 'Auto Refuel',
    description: 'Automatically press F when adjacent furnace fuel is available and fuel is low.',
    cooldownMs: 350,
  },
  {
    id: 'auto-pickup',
    label: 'Auto Pickup',
    description: 'Automatically press Q on adjacent chests when inventory has free space.',
    cooldownMs: 180,
  },
  {
    id: 'auto-deposit',
    label: 'Auto Deposit',
    description: 'Automatically press E on adjacent chests while carrying items.',
    cooldownMs: 180,
  },
];

const AUTO_REFUEL_TRIGGER_RATIO = 0.35;

type AutomationEnabledState = Record<AutomationAgentId, boolean>;
type AutomationStatusState = Record<AutomationAgentId, string>;
type AutomationNextRunState = Record<AutomationAgentId, number>;

const INITIAL_AUTOMATION_ENABLED_STATE: AutomationEnabledState = {
  'auto-refuel': false,
  'auto-pickup': false,
  'auto-deposit': false,
};

const EMPTY_AUTOMATION_STATUS_STATE: AutomationStatusState = {
  'auto-refuel': 'idle',
  'auto-pickup': 'idle',
  'auto-deposit': 'idle',
};

const EMPTY_AUTOMATION_NEXT_RUN_STATE: AutomationNextRunState = {
  'auto-refuel': 0,
  'auto-pickup': 0,
  'auto-deposit': 0,
};

type HudState = {
  tool: EntityKind | null;
  rotation: Rotation;
  paused: boolean;
  tick: number;
  fuel: number;
  maxFuel: number;
  player: Tile;
  inventory: PlacementSnapshot['inventory'];
  metrics: RuntimeMetrics;
  selectedEntity: HudSelectedEntity | null;
  adjacentChest: {
    id: string;
    x: number;
    y: number;
    inventory: InventoryState;
    used: number;
    remaining: number;
  } | null;
  adjacentInteractive: RuntimeAdjacentInteractive | null;
};

const createEmptyRuntimeMetrics = (): RuntimeMetrics => ({
  entityCount: 0,
  miners: 0,
  belts: 0,
  splitters: 0,
  inserters: 0,
  furnaces: 0,
  chests: 0,
  assemblers: 0,
  solarPanels: 0,
  accumulators: 0,
  oreInTransit: 0,
  platesInTransit: 0,
  gearsInTransit: 0,
  coalInTransit: 0,
  woodInTransit: 0,
  chestOre: 0,
  chestPlates: 0,
  chestGears: 0,
  chestCoal: 0,
  chestWood: 0,
  oreRemaining: 0,
  coalRemaining: 0,
  woodRemaining: 0,
  furnacesCrafting: 0,
  furnacesReady: 0,
  powerStorage: 0,
  powerCapacity: 0,
  powerDemandThisTick: 0,
  powerConsumedThisTick: 0,
  powerGeneratedThisTick: 0,
  powerShortagesThisTick: 0,
});

const RUNTIME_KIND: Record<EntityKind, RuntimeEntityKind> = {
  Miner: 'miner',
  Belt: 'belt',
  Splitter: 'splitter',
  Inserter: 'inserter',
  Furnace: 'furnace',
  Chest: 'chest',
  Assembler: 'assembler',
  SolarPanel: 'solar-panel',
  Accumulator: 'accumulator',
};

const RUNTIME_KIND_TO_TOOL_KIND: Readonly<Record<RuntimeEntityKind, EntityKind>> = {
  miner: 'Miner',
  belt: 'Belt',
  splitter: 'Splitter',
  inserter: 'Inserter',
  furnace: 'Furnace',
  chest: 'Chest',
  assembler: 'Assembler',
  'solar-panel': 'SolarPanel',
  accumulator: 'Accumulator',
};

const ROTATION_TO_DIRECTION: Record<Rotation, RuntimeDirection> = {
  0: 'N',
  1: 'E',
  2: 'S',
  3: 'W',
};

const DIRECTION_TO_DELTA: Readonly<Record<RuntimeDirection, Tile>> = {
  N: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: 1 },
  W: { x: -1, y: 0 },
};

const getAdjacentInteractionTiles = (tile: Tile): Tile[] => {
  return [
    tile,
    { x: tile.x, y: tile.y - 1 },
    { x: tile.x + 1, y: tile.y },
    { x: tile.x, y: tile.y + 1 },
    { x: tile.x - 1, y: tile.y },
  ].filter((candidate) =>
    candidate.x >= 0 &&
    candidate.y >= 0 &&
    candidate.x < WORLD_WIDTH &&
    candidate.y < WORLD_HEIGHT
  );
};

const toInt = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.floor(value);
  return normalized >= 0 ? normalized : 0;
};

const toSignedInt = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.floor(value);
};

const addUniqueMessage = (messages: string[], message: string): void => {
  if (!messages.includes(message)) {
    messages.push(message);
  }
};

const resolveRuntimeBlueprintEntityImportPosition = (
  entry: Record<string, unknown>,
): { x: number; y: number; source: 'pos' | 'legacy' } | null => {
  const posCandidate = isRecord(entry.pos) ? entry.pos : null;
  const posX = toSignedInt(posCandidate?.x);
  const posY = toSignedInt(posCandidate?.y);
  const x = posX
    ?? toSignedInt((entry as { x?: unknown }).x)
    ?? toSignedInt((entry as { left?: unknown }).left);
  const y = posY
    ?? toSignedInt((entry as { y?: unknown }).y)
    ?? toSignedInt((entry as { top?: unknown }).top);
  if (x === null || y === null) {
    return null;
  }

  return {
    x,
    y,
    source: posCandidate === null || posX === null || posY === null ? 'legacy' : 'pos',
  };
};

export const inspectRuntimeBlueprintPlacement = (
  blueprint: RuntimeBlueprintState,
  context: RuntimeBlueprintPlacementInspectionContext,
): RuntimeBlueprintPlacementInspectionResult => {
  const occupied = new Set<string>();
  if (context.occupiedTiles instanceof Set) {
    for (const key of context.occupiedTiles) {
      if (typeof key === 'string' && key.includes(',')) {
        occupied.add(key);
      }
    }
  } else if (context.occupiedTiles !== undefined) {
    for (const tile of context.occupiedTiles) {
      const positionX = toSignedInt(tile?.x);
      const positionY = toSignedInt(tile?.y);
      if (positionX === null || positionY === null) {
        continue;
      }
      occupied.add(`${positionX},${positionY}`);
    }
  }

  const planned: RuntimeBlueprintPlacementPlan[] = [];
  const blockers: RuntimeBlueprintPlacementIssue[] = [];
  const plannedOccupancy = new Set<string>();
  const fuelCost = blueprint.entities.length * PLAYER_BUILD_FUEL_COST;

  if (!PLAYER_FUEL_INFINITE && context.playerSnapshot.fuel < fuelCost) {
    blockers.push({
      index: -1,
      kind: 'belt',
      x: context.playerSnapshot.x,
      y: context.playerSnapshot.y,
      code: 'insufficient-fuel',
      message: `Blueprint requires ${fuelCost} fuel, but player has ${context.playerSnapshot.fuel}.`,
    });
  }

  let bounds: RuntimeBlueprintPlacementInspectionResult['bounds'] = null;

  for (let index = 0; index < blueprint.entities.length; index += 1) {
    const entry = blueprint.entities[index];
    if (entry === undefined) {
      continue;
    }

    const plannedTile = {
      x: context.playerSnapshot.x + (entry.pos.x - blueprint.anchor.x),
      y: context.playerSnapshot.y + (entry.pos.y - blueprint.anchor.y),
    };
    const rotation = DIRECTION_TO_RUNTIME_ROTATION[entry.rot];
    const plannedPlacement: RuntimeBlueprintPlacementPlan = {
      kind: entry.kind,
      tile: plannedTile,
      rotation,
    };
    planned.push(plannedPlacement);

    if (bounds === null) {
      bounds = {
        left: plannedTile.x,
        right: plannedTile.x,
        top: plannedTile.y,
        bottom: plannedTile.y,
      };
    } else {
      if (plannedTile.x < bounds.left) {
        bounds.left = plannedTile.x;
      }
      if (plannedTile.x > bounds.right) {
        bounds.right = plannedTile.x;
      }
      if (plannedTile.y < bounds.top) {
        bounds.top = plannedTile.y;
      }
      if (plannedTile.y > bounds.bottom) {
        bounds.bottom = plannedTile.y;
      }
    }

    const tileKey = `${plannedTile.x},${plannedTile.y}`;
    const isOwnTile = plannedTile.x === context.playerSnapshot.x && plannedTile.y === context.playerSnapshot.y;
    if (plannedTile.x < 0 || plannedTile.y < 0 || plannedTile.x >= WORLD_WIDTH || plannedTile.y >= WORLD_HEIGHT) {
      blockers.push({
        index,
        kind: entry.kind,
        x: plannedTile.x,
        y: plannedTile.y,
        code: 'out-of-bounds',
        message: 'Tile is outside world bounds.',
      });
    }

    if (isOwnTile) {
      blockers.push({
        index,
        kind: entry.kind,
        x: plannedTile.x,
        y: plannedTile.y,
        code: 'player-tile',
        message: 'Tile is occupied by the player.',
      });
    }

    if (occupied.has(tileKey) || plannedOccupancy.has(tileKey)) {
      blockers.push({
        index,
        kind: entry.kind,
        x: plannedTile.x,
        y: plannedTile.y,
        code: 'tile-occupied',
        message: 'Tile already occupied.',
      });
    }

    const kindForRuntime = RUNTIME_KIND_TO_TOOL_KIND[entry.kind];
    if (kindForRuntime === undefined) {
      blockers.push({
        index,
        kind: entry.kind,
        x: plannedTile.x,
        y: plannedTile.y,
        code: 'unsupported-entity',
        message: `Unsupported blueprint entity '${entry.kind}'.`,
      });
      plannedOccupancy.add(tileKey);
      continue;
    }

    plannedOccupancy.add(tileKey);

    if (context.canPlacePlacement !== undefined) {
      const placementOutcome = context.canPlacePlacement(kindForRuntime, plannedTile, rotation);
      const normalized = normalizePlacementOutcome(placementOutcome);
      if (!normalized.ok) {
        blockers.push({
          index,
          kind: entry.kind,
          x: plannedTile.x,
          y: plannedTile.y,
          code: resolvePlacementBlockerReason(normalized.reasonCode),
          message: normalized.message ?? `Placement blocked by ${normalized.reasonCode ?? 'unknown reasons'}.`,
        });
      }
    } else if (entry.kind === 'miner' && context.isOre !== undefined) {
      const isOreTile = context.isOre(plannedTile.x, plannedTile.y);
      if (isOreTile !== true) {
        blockers.push({
          index,
          kind: entry.kind,
          x: plannedTile.x,
          y: plannedTile.y,
          code: 'resource-required',
          message: 'Miner requires an ore tile.',
        });
      }
    }
  }

  return {
    planned,
    blockers,
    bounds,
    fuelCost,
    ok: blockers.length === 0,
  };
};

const normalizePlacementOutcome = (value: CoreActionOutcome | boolean): {
  ok: boolean;
  reasonCode?: string;
  message?: string;
} => {
  if (typeof value === 'boolean') {
    return {
      ok: value,
      reasonCode: value === true ? undefined : 'invalid-placement',
    };
  }

  if (!isRecord(value)) {
    return { ok: false, reasonCode: 'invalid-placement' };
  }

  if (value.ok === true || value.success === true || value.allowed === true) {
    return { ok: true };
  }

  return {
    ok: false,
    reasonCode: typeof value.reasonCode === 'string' ? value.reasonCode : typeof value.status === 'string' ? value.status : typeof value.code === 'string' ? value.code : 'invalid-placement',
    message: typeof value.reason === 'string' ? value.reason : undefined,
  };
};

const resolvePlacementBlockerReason = (reasonCode: string | undefined): RuntimeBlueprintPlacementIssue['code'] => {
  if (reasonCode === 'out_of_bounds') {
    return 'out-of-bounds';
  }
  if (reasonCode === 'occupied' || reasonCode === 'blocked-occupied') {
    return 'tile-occupied';
  }
  if (reasonCode === 'needs_resource' || reasonCode === 'resource-required' || reasonCode === 'blocked-resource-required') {
    return 'resource-required';
  }
  if (reasonCode === 'no_fuel' || reasonCode === 'insufficient-fuel') {
    return 'insufficient-fuel';
  }
  if (reasonCode === 'player-tile') {
    return 'player-tile';
  }
  return 'invalid-placement';
};

const describeRuntimeBlueprintPlacementBlockers = (
  blockers: RuntimeBlueprintPlacementIssue[],
): string => {
  if (blockers.length === 0) {
    return 'No blockers.';
  }

  const grouped = new Map<string, number>();
  for (const blocker of blockers) {
    grouped.set(blocker.code, (grouped.get(blocker.code) ?? 0) + 1);
  }

  const summary = Array.from(grouped.entries())
    .map(([code, count]) => `${count} ${code}`)
    .join(', ');
  const details = blockers.slice(0, 3).map((blocker) =>
    `#${blocker.index >= 0 ? blocker.index : 'global'} (${blocker.x}, ${blocker.y}): ${blocker.message}`,
  ).join(' | ');
  const remaining = blockers.length > 3 ? ` + ${blockers.length - 3} more.` : '';

  return `${summary}. ${details}${remaining}`;
};

const cloneRuntimeStateDeep = <T,>(value: T): T => {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  return JSON.parse(JSON.stringify(value)) as T;
};

export type CameraTransformSeed = {
  tile: Tile;
  zoom: number;
  canvasWidth: number;
  canvasHeight: number;
  worldWidth?: number;
  worldHeight?: number;
  tileSize?: number;
};

export const computeCameraPanForTile = ({
  tile,
  zoom,
  canvasWidth,
  canvasHeight,
  worldWidth = WORLD_WIDTH,
  worldHeight = WORLD_HEIGHT,
  tileSize = TILE_SIZE,
}: CameraTransformSeed): CameraState => {
  const worldW = Math.max(1, Math.floor(worldWidth * tileSize));
  const worldH = Math.max(1, Math.floor(worldHeight * tileSize));
  const clampedZoom = clampCameraZoom(zoom, CAMERA_DEFAULT_ZOOM);
  const baseScale = Math.max(0.0001, Math.min(canvasWidth / worldW, canvasHeight / worldH));
  const scale = baseScale * clampedZoom;
  const baseOffsetX = Math.floor((canvasWidth - worldW * baseScale) / 2);
  const baseOffsetY = Math.floor((canvasHeight - worldH * baseScale) / 2);
  const targetX = (tile.x + 0.5) * tileSize * scale;
  const targetY = (tile.y + 0.5) * tileSize * scale;

  return {
    zoom: clampedZoom,
    panX: Math.round(canvasWidth / 2 - (baseOffsetX + targetX)),
    panY: Math.round(canvasHeight / 2 - (baseOffsetY + targetY)),
  };
};

export type MinimapPoint = {
  x: number;
  y: number;
};

export type MinimapPointToTileSeed = {
  point: MinimapPoint;
  minimapWidth: number;
  minimapHeight: number;
  worldWidth?: number;
  worldHeight?: number;
};

export const minimapPointToTile = ({
  point,
  minimapWidth,
  minimapHeight,
  worldWidth = WORLD_WIDTH,
  worldHeight = WORLD_HEIGHT,
}: MinimapPointToTileSeed): Tile | null => {
  const targetWorldWidth = worldWidth;
  const targetWorldHeight = worldHeight;

  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    !Number.isFinite(minimapWidth) ||
    !Number.isFinite(minimapHeight) ||
    targetWorldWidth <= 0 ||
    targetWorldHeight <= 0
  ) {
    return null;
  }

  if (minimapWidth <= 0 || minimapHeight <= 0) {
    return null;
  }

  const tileWidth = minimapWidth / targetWorldWidth;
  const tileHeight = minimapHeight / targetWorldHeight;
  if (tileWidth <= 0 || tileHeight <= 0) {
    return null;
  }

  const x = Math.floor(point.x / tileWidth);
  const y = Math.floor(point.y / tileHeight);

  if (x < 0 || y < 0 || x >= targetWorldWidth || y >= targetWorldHeight) {
    return null;
  }

  return { x, y };
};

const clampCameraZoom = (zoom: unknown, fallback = CAMERA_DEFAULT_ZOOM): number => {
  const next = typeof zoom === 'number' && Number.isFinite(zoom) ? zoom : fallback;
  const bounded = Math.min(CAMERA_MAX_ZOOM, Math.max(CAMERA_MIN_ZOOM, next));
  return Number((Math.round(bounded * 100) / 100).toFixed(2));
};

const isRuntimeDirection = (value: unknown): value is RuntimeDirection => {
  return value === 'N' || value === 'E' || value === 'S' || value === 'W';
};

const isLegacyRotation = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 3;
};

const toCompatInt = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const normalized = Math.floor(value);
    return normalized >= 0 ? normalized : null;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      const normalized = Math.floor(parsed);
      return normalized >= 0 ? normalized : null;
    }
  }

  return null;
};

const coerceCollectionValuesToArray = (value: unknown): unknown[] | null => {
  if (value === undefined) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (!isRecord(value)) {
    return null;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return null;
  }

  return Object.values(value);
};

const RUNTIME_DIRECTION_BY_NAME: Record<string, RuntimeDirection> = {
  n: 'N',
  north: 'N',
  up: 'N',
  e: 'E',
  east: 'E',
  right: 'E',
  s: 'S',
  south: 'S',
  down: 'S',
  w: 'W',
  west: 'W',
  left: 'W',
};

const POWER_FIELD_ALIASES: ReadonlyArray<[string, string]> = [
  ['storage', 'powerStorage'],
  ['capacity', 'powerCapacity'],
  ['demandThisTick', 'powerDemand'],
  ['consumedThisTick', 'powerConsumed'],
  ['generatedThisTick', 'powerGenerated'],
  ['shortagesThisTick', 'powerShortages'],
];

const normalizeRuntimeDirection = (value: unknown): RuntimeDirection | null => {
  if (isRuntimeDirection(value)) {
    return value;
  }

  const numeric = toCompatInt(value);
  if (numeric !== null && numeric <= 3) {
    return RUNTIME_DIRECTION_BY_NUMBER[numeric];
  }

  if (isLegacyRotation(value)) {
    return RUNTIME_DIRECTION_BY_NUMBER[Math.floor(value)];
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return null;
  }

  if (normalized.length === 1) {
    return RUNTIME_DIRECTION_BY_NAME[normalized] ?? null;
  }

  return RUNTIME_DIRECTION_BY_NAME[normalized] ?? null;
};

export const parseRuntimeSaveState = (
  value: unknown,
  options: ParseRuntimeSaveStateOptions = {},
): RuntimeSaveState | null => {
  if (!isRecord(value)) {
    return null;
  }

  const width = toCompatInt(value.width) ?? toCompatInt((value as { mapWidth?: unknown }).mapWidth);
  const height = toCompatInt(value.height) ?? toCompatInt((value as { mapHeight?: unknown }).mapHeight);
  if (width === null || height === null) {
    return null;
  }

  const playerRecord = isRecord(value.player) ? value.player : null;
  const playerPosition = isRecord(playerRecord?.position) ? playerRecord.position : null;
  const playerX = toCompatInt(playerRecord?.x) ?? toCompatInt(playerPosition?.x);
  const playerY = toCompatInt(playerRecord?.y) ?? toCompatInt(playerPosition?.y);
  if (playerX === null || playerY === null) {
    return null;
  }

  const playerRotation = normalizeRuntimeDirection(
    playerRecord?.rot,
  ) ?? normalizeRuntimeDirection(playerRecord?.rotation) ?? normalizeRuntimeDirection(playerRecord?.direction) ?? options.fallbackPlayerRotation ?? 'S';

  const fuel = toCompatInt(playerRecord?.fuel);
  const maxFuel = toCompatInt(playerRecord?.maxFuel) ?? toCompatInt(playerRecord?.fuelCapacity);
  const inventoryRecord = isRecord(value.inventory) ? value.inventory : null;
  if (inventoryRecord === null) {
    return null;
  }
  const rawPower = (() => {
    const legacyPowerFromRoot = isRecord(value) ? value : null;
    const nestedPower = isRecord((value as { power?: unknown }).power) ? (value as { power?: unknown }).power : null;
    const power: Record<string, unknown> = {};

    if (nestedPower !== null) {
      for (const [powerKey, powerValue] of Object.entries(nestedPower)) {
        if (powerValue !== undefined) {
          power[powerKey] = powerValue;
        }
      }
    }

    for (const [canonicalField, legacyField] of POWER_FIELD_ALIASES) {
      if (Object.prototype.hasOwnProperty.call(power, canonicalField)) {
        continue;
      }
      const legacyValue = legacyPowerFromRoot?.[legacyField];
      if (legacyValue !== undefined) {
        power[canonicalField] = legacyValue;
      }
    }

    return Object.keys(power).length === 0 ? undefined : power;
  })();

  const rawEntities = coerceCollectionValuesToArray((value as { entities?: unknown }).entities) ?? [];
  const entities: RuntimeSaveEntity[] = [];
  for (const entity of rawEntities) {
    if (!isRecord(entity)) {
      continue;
    }

    const entityKind = typeof entity.kind === 'string'
      ? entity.kind
      : typeof entity.type === 'string'
        ? entity.type
        : null;
    const position = isRecord(entity.pos) ? entity.pos : isRecord(entity.position) ? entity.position : null;
    const legacyX = toCompatInt((entity as { x?: unknown }).x) ?? toCompatInt((entity as { col?: unknown }).col);
    const legacyY = toCompatInt((entity as { y?: unknown }).y) ?? toCompatInt((entity as { row?: unknown }).row);
    const x = toCompatInt(position?.x) ?? legacyX;
    const y = toCompatInt(position?.y) ?? legacyY;
    if (
      entityKind === null ||
      entityKind.trim().length === 0 ||
      x === null ||
      y === null
    ) {
      continue;
    }

    const rotation = normalizeRuntimeDirection(
      entity.rot,
    ) ?? normalizeRuntimeDirection((entity as { direction?: unknown }).direction) ?? normalizeRuntimeDirection((entity as { rotation?: unknown }).rotation) ?? 'N';

    const serializableState = isRecord(entity.state) ? entity.state : undefined;
    entities.push({
      kind: entityKind,
      pos: { x, y },
      rot: rotation,
      state: serializableState,
    });
  }

  return {
      version: toCompatInt(value.version) ?? toCompatInt((value as { schemaVersion?: unknown }).schemaVersion) ?? 1,
      seed: typeof value.seed === 'string' && value.seed.trim().length > 0 ? value.seed : WORLD_SEED,
      width,
      height,
      tick: toCompatInt(value.tick) ?? 0,
      tickCount: toCompatInt(value.tickCount) ?? 0,
      elapsedMs: toCompatInt(value.elapsedMs) ?? 0,
      paused: value.paused === true,
      player: {
        x: playerX,
        y: playerY,
        rot: playerRotation,
        fuel: fuel === null ? 0 : fuel,
        maxFuel: maxFuel === null || maxFuel <= 0 ? PLAYER_MAX_FUEL : maxFuel,
      },
      inventory: {
        ore: toCompatInt(
          (inventoryRecord as { ironOre?: unknown }).ironOre,
        ) ?? toCompatInt(inventoryRecord.ore) ?? 0,
        plate: toCompatInt(inventoryRecord.plate) ?? toCompatInt(inventoryRecord.plates) ?? 0,
        gear: toCompatInt(inventoryRecord.gear) ?? 0,
        coal: toCompatInt(inventoryRecord.coal) ?? 0,
        wood: toCompatInt(inventoryRecord.wood) ?? 0,
        used: toCompatInt(inventoryRecord.used) ?? 0,
        capacity: toCompatInt(inventoryRecord.capacity) ?? PLAYER_INVENTORY_CAPACITY,
      },
      entities,
      power: {
        storage: getPowerField(rawPower, 'storage'),
        capacity: getPowerField(rawPower, 'capacity'),
        demandThisTick: getPowerField(rawPower, 'demandThisTick'),
        consumedThisTick: getPowerField(rawPower, 'consumedThisTick'),
        generatedThisTick: getPowerField(rawPower, 'generatedThisTick'),
        shortagesThisTick: getPowerField(rawPower, 'shortagesThisTick'),
      },
  };
};

export const validateRuntimeSavePayloadForImport = (payload: unknown): RuntimeSaveImportValidation => {
  const result: RuntimeSaveImportValidation = {
    errors: [],
    warnings: [],
  };
  const resolvedPayload = resolveRuntimeSavePayload(payload);
  if (!isRecord(resolvedPayload)) {
    result.errors.push('Save payload is not a valid object.');
    return result;
  }

  const width = toCompatInt(resolvedPayload.width) ?? toCompatInt((resolvedPayload as { mapWidth?: unknown }).mapWidth);
  if (width === null) {
    result.errors.push('Save payload is missing a valid map width.');
  }

  const height = toCompatInt(resolvedPayload.height) ?? toCompatInt((resolvedPayload as { mapHeight?: unknown }).mapHeight);
  if (height === null) {
    result.errors.push('Save payload is missing a valid map height.');
  }

  const playerRecord = isRecord(resolvedPayload.player) ? resolvedPayload.player : null;
  if (playerRecord === null) {
    result.errors.push('Save payload is missing player state.');
  } else {
    const playerPosition = isRecord(playerRecord.position) ? playerRecord.position : null;
    const playerX = toCompatInt(playerRecord.x) ?? toCompatInt(playerPosition?.x);
    const playerY = toCompatInt(playerRecord.y) ?? toCompatInt(playerPosition?.y);
    if (playerX === null || playerY === null) {
      result.errors.push('Save payload is missing player coordinates.');
    }
  }

  const inventoryRecord = isRecord(resolvedPayload.inventory) ? resolvedPayload.inventory : null;
  if (inventoryRecord === null) {
    result.errors.push('Save payload is missing inventory snapshot.');
  }

  const entitiesValue = coerceCollectionValuesToArray((resolvedPayload as { entities?: unknown }).entities);
  if (entitiesValue === null && (resolvedPayload as { entities?: unknown }).entities !== undefined) {
    result.errors.push('Save payload has an invalid entities list.');
  }

  const version = toCompatInt(resolvedPayload.version) ?? toCompatInt((resolvedPayload as { schemaVersion?: unknown }).schemaVersion);
  if (version === null) {
    result.warnings.push(
      `Save schema version is missing; defaulting to v${RUNTIME_SAVE_SCHEMA_VERSION}.`,
    );
  } else if (version > RUNTIME_SAVE_SCHEMA_VERSION) {
    result.warnings.push(
      `Save schema v${version} is newer than the current app schema v${RUNTIME_SAVE_SCHEMA_VERSION}.`,
    );
  } else if (version < RUNTIME_SAVE_SCHEMA_VERSION) {
    result.warnings.push(
      `Save schema v${version} is older than the current app schema v${RUNTIME_SAVE_SCHEMA_VERSION} and will be upgraded.`,
    );
  }

  const parsedState = parseRuntimeSaveState(resolvedPayload, {
    fallbackPlayerRotation: 'S',
  });
  if (parsedState === null) {
    result.errors.push('Save payload is malformed or unsupported.');
    return result;
  }

  return result;
};

const resolveRuntimeSharePayload = (value: unknown): (RuntimeShareEnvelope & { schemaVersion: number }) | null => {
  if (!isRecord(value)) {
    return null;
  }

  const schemaVersion =
    toCompatInt((value as { schemaVersion?: unknown }).schemaVersion) ?? RUNTIME_SHARE_SCHEMA_VERSION;
  const kindValue = typeof value.kind === 'string'
    ? value.kind
    : null;
  if (kindValue === 'runtime-save' || kindValue === 'runtime-blueprint') {
    const payload = isRecord((value as { payload?: unknown }).payload)
      ? (value as { payload?: unknown }).payload
      : null;
    if (payload === null) {
      return null;
    }
    return {
      kind: kindValue,
      payload,
      schemaVersion,
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : undefined,
    } as RuntimeShareEnvelope & { schemaVersion: number };
  }

  const nestedSave = isRecord((value as { state?: unknown }).state) ? (value as { state?: unknown }).state : null;
  if (nestedSave !== null && parseRuntimeSaveState(nestedSave) !== null) {
    return {
      kind: 'runtime-save',
      payload: nestedSave,
      schemaVersion,
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : undefined,
    } as RuntimeShareEnvelope & { schemaVersion: number };
  }

  const blueprint = parseRuntimeBlueprintState(value);
  if (blueprint !== null) {
    return {
      kind: 'runtime-blueprint',
      payload: value as RuntimeBlueprintState,
      schemaVersion,
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : undefined,
    } as RuntimeShareEnvelope & { schemaVersion: number };
  }

  const save = parseRuntimeSaveState(value, { fallbackPlayerRotation: 'S' });
  if (save !== null) {
    return {
      kind: 'runtime-save',
      payload: value as RuntimeSaveState,
      schemaVersion,
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : undefined,
    } as RuntimeShareEnvelope & { schemaVersion: number };
  }

  return null;
};

export const validateRuntimeSharePayloadForImport = (payload: unknown): RuntimeShareImportValidation => {
  const result: RuntimeShareImportValidation = {
    errors: [],
    warnings: [],
    kind: null,
    savePayload: null,
    blueprintPayload: null,
  };

  const resolved = resolveRuntimeSharePayload(payload);
  if (resolved === null) {
    result.errors.push('Clipboard payload is not a recognized runtime payload.');
    return result;
  }

  if (resolved.schemaVersion > RUNTIME_SHARE_SCHEMA_VERSION) {
    result.warnings.push(
      `Share payload schema v${resolved.schemaVersion} is newer than the current app schema v${RUNTIME_SHARE_SCHEMA_VERSION}.`,
    );
  }

  if (resolved.kind === 'runtime-save') {
    const parsed = parseRuntimeSaveState(resolved.payload);
    if (parsed === null) {
      result.errors.push('Clipboard save payload is malformed.');
      return result;
    }
    result.kind = 'runtime-save';
    result.savePayload = parsed;
    return result;
  }

  const blueprintValidation = validateRuntimeBlueprintPayloadForImport(resolved.payload);
  if (blueprintValidation.errors.length > 0) {
    result.errors.push(...blueprintValidation.errors);
    return result;
  }
  if (blueprintValidation.blueprint === null) {
    result.errors.push('Clipboard blueprint payload is malformed.');
    return result;
  }
  result.kind = 'runtime-blueprint';
  result.blueprintPayload = blueprintValidation.blueprint;
  for (const warning of blueprintValidation.warnings) {
    addUniqueMessage(result.warnings, warning);
  }
  return result;
};

const encodeRuntimeSharePayload = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const decodeRuntimeSharePayload = (value: string): string | null => {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
};

const parseRuntimeShareSearchSource = (searchOrUrl: string): string => {
  const withoutHash = searchOrUrl.split('#', 1)[0] ?? searchOrUrl;
  const queryIndex = withoutHash.indexOf('?');
  if (queryIndex < 0) {
    return withoutHash;
  }

  return withoutHash.slice(queryIndex + 1);
};

export const buildRuntimeShareQueryValue = (payload: RuntimeShareEnvelope): string => {
  return encodeRuntimeSharePayload(JSON.stringify(payload));
};

export const parseRuntimeSharePayloadFromQueryValue = (value: string): RuntimeShareImportValidation => {
  const result: RuntimeShareImportValidation = {
    errors: [],
    warnings: [],
    kind: null,
    savePayload: null,
    blueprintPayload: null,
  };

  const decoded = decodeRuntimeSharePayload(value);
  if (decoded === null) {
    result.errors.push('Share URL payload is not valid base64.');
    return result;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    result.errors.push('Share URL payload is not valid JSON.');
    return result;
  }

  return validateRuntimeSharePayloadForImport(parsed);
};

export const parseRuntimeSharePayloadFromSearchParams = (searchOrUrl: string): RuntimeShareImportValidation | null => {
  const query = parseRuntimeShareSearchSource(searchOrUrl);
  const params = new URLSearchParams(query);
  const encoded = params.get(RUNTIME_SHARE_URL_QUERY_PARAM);
  if (encoded === null || encoded.length === 0) {
    return null;
  }

  return parseRuntimeSharePayloadFromQueryValue(encoded);
};

const parseRuntimeSharePayloadFromClipboardText = (clipboardText: string): RuntimeShareImportValidation | null => {
  const trimmed = clipboardText.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const searchPayload = parseRuntimeSharePayloadFromSearchParams(trimmed);
  if (searchPayload !== null) {
    return searchPayload;
  }

  const queryPayload = parseRuntimeSharePayloadFromQueryValue(trimmed);
  if (queryPayload.kind !== null || queryPayload.errors.length === 0) {
    return queryPayload;
  }

  const parsed = safeParseJson(trimmed);
  if (parsed === null) {
    return queryPayload;
  }

  return validateRuntimeSharePayloadForImport(parsed);
};

const buildRuntimeShareLink = (payload: RuntimeShareEnvelope): string | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const url = new URL(window.location.href);
    url.searchParams.set(RUNTIME_SHARE_URL_QUERY_PARAM, buildRuntimeShareQueryValue(payload));
    return url.toString();
  } catch {
    return null;
  }
};

const clearRuntimeShareParamFromUrl = (searchOrUrl?: string): string | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const currentUrl = searchOrUrl === undefined
      ? window.location.href
      : new URL(searchOrUrl, window.location.href).toString();
    const url = new URL(currentUrl);
    if (!url.searchParams.has(RUNTIME_SHARE_URL_QUERY_PARAM)) {
      return null;
    }

    url.searchParams.delete(RUNTIME_SHARE_URL_QUERY_PARAM);
    return url.toString();
  } catch {
    return null;
  }
};

const resolveRuntimeBlueprintPayload = (value: unknown): unknown | null => {
  if (!isRecord(value)) {
    return null;
  }

  return value;
};

export const parseRuntimeBlueprintState = (value: unknown): RuntimeBlueprintState | null => {
  if (!isRecord(value)) {
    return null;
  }

  const version = toCompatInt(value.version) ?? toCompatInt((value as { schemaVersion?: unknown }).schemaVersion) ?? RUNTIME_BLUEPRINT_SCHEMA_VERSION;
  const anchorValue = isRecord(value.anchor) ? value.anchor : null;
  const anchor: Tile = {
    x: toSignedInt(anchorValue?.x) ?? 0,
    y: toSignedInt(anchorValue?.y) ?? 0,
  };

  const rawEntities = coerceCollectionValuesToArray((value as { entities?: unknown }).entities);
  if (rawEntities === null) {
    return null;
  }

  const entities: RuntimeBlueprintEntity[] = [];
  for (const entry of rawEntities) {
    if (!isRecord(entry)) {
      return null;
    }

    const entityKindValue =
      typeof entry.kind === 'string'
        ? entry.kind
        : typeof entry.type === 'string'
          ? entry.type
          : null;
    const normalizedKind = entityKindValue === null ? null : normalizeRuntimeSaveEntityKind(entityKindValue);
    if (normalizedKind === null) {
      return null;
    }

    const entityPosValue = isRecord(entry.pos) ? entry.pos : null;
    const positionX =
      toSignedInt(entityPosValue?.x)
      ?? toSignedInt((entry as { x?: unknown }).x)
      ?? toSignedInt((entry as { left?: unknown }).left)
      ?? 0;
    const positionY =
      toSignedInt(entityPosValue?.y)
      ?? toSignedInt((entry as { y?: unknown }).y)
      ?? toSignedInt((entry as { top?: unknown }).top)
      ?? 0;

    const rotation = normalizeRuntimeDirection(
      entry.rot,
    ) ?? normalizeRuntimeDirection((entry as { direction?: unknown }).direction) ?? normalizeRuntimeDirection((entry as { rotation?: unknown }).rotation) ?? 'N';

    entities.push({
      kind: normalizedKind.kind,
      pos: {
        x: positionX,
        y: positionY,
      },
      rot: rotation,
    });
  }

  return {
    version,
    anchor,
    entities,
    name: typeof value.name === 'string' && value.name.trim().length > 0 ? value.name : undefined,
    createdAt: typeof value.createdAt === 'string' && value.createdAt.trim().length > 0 ? value.createdAt : undefined,
  };
};

export const validateRuntimeBlueprintPayloadForImport = (
  payload: unknown,
): RuntimeBlueprintImportValidation => {
  const result: RuntimeBlueprintImportValidation = {
    errors: [],
    warnings: [],
    blueprint: null,
  };

  const resolved = resolveRuntimeBlueprintPayload(payload);
  if (resolved === null) {
    result.errors.push('Blueprint payload is not a valid object.');
    return result;
  }

  const resolvedRecord = resolved as Record<string, unknown>;
  const version = toCompatInt(resolvedRecord.version) ?? toCompatInt((resolvedRecord as { schemaVersion?: unknown }).schemaVersion);
  if (version !== null && version > RUNTIME_BLUEPRINT_SCHEMA_VERSION) {
    result.warnings.push(
      `Blueprint schema v${version} is newer than the current app schema v${RUNTIME_BLUEPRINT_SCHEMA_VERSION}.`,
    );
  } else if (version === null) {
    result.warnings.push(
      `Blueprint schema version is missing; defaulting to v${RUNTIME_BLUEPRINT_SCHEMA_VERSION}.`,
    );
  } else if (version < RUNTIME_BLUEPRINT_SCHEMA_VERSION) {
    result.warnings.push(
      `Blueprint schema v${version} is older than the current app schema v${RUNTIME_BLUEPRINT_SCHEMA_VERSION} and will be upgraded.`,
    );
  }

  const anchorRecord = isRecord(resolvedRecord.anchor)
    ? resolvedRecord.anchor
    : null;
  if (anchorRecord === null) {
    result.errors.push('Blueprint payload is missing anchor coordinates.');
  } else {
    if (toSignedInt(anchorRecord.x) === null) {
      result.errors.push('Blueprint anchor.x must be a valid integer.');
    }
    if (toSignedInt(anchorRecord.y) === null) {
      result.errors.push('Blueprint anchor.y must be a valid integer.');
    }
  }

  const rawEntities = coerceCollectionValuesToArray((resolvedRecord as { entities?: unknown }).entities);
  if (rawEntities === null) {
    result.errors.push('Blueprint entities must be an array.');
  } else {
    if (rawEntities.length > MAX_RUNTIME_BLUEPRINT_ENTITIES) {
      result.errors.push(
        `Blueprint has ${rawEntities.length} entities, but only ${MAX_RUNTIME_BLUEPRINT_ENTITIES} are supported.`,
      );
    } else {
      if (rawEntities.length === 0) {
        addUniqueMessage(
          result.warnings,
          'Blueprint has no entities and importing it will do nothing.',
        );
      }

      const seenTiles = new Set<string>();
      for (let index = 0; index < rawEntities.length; index += 1) {
        const entry = rawEntities[index];
        if (!isRecord(entry)) {
          result.errors.push(`Blueprint entity at index ${index} is not a valid object.`);
          continue;
        }

        const rawKind = typeof entry.kind === 'string'
          ? entry.kind
          : typeof entry.type === 'string'
            ? entry.type
            : null;
        if (rawKind === null || rawKind.trim().length === 0) {
          result.errors.push(`Blueprint entity at index ${index} is missing a kind.`);
          continue;
        }

        const normalizedKind = normalizeRuntimeSaveEntityKind(rawKind);
        if (normalizedKind === null) {
          result.errors.push(`Blueprint entity at index ${index} has unsupported kind '${rawKind}'.`);
          continue;
        }
        if (normalizedKind.changed) {
          addUniqueMessage(
            result.warnings,
            `Blueprint entity at index ${index} uses legacy kind '${rawKind}' and was normalized to '${normalizedKind.kind}'.`,
          );
        }

        const position = resolveRuntimeBlueprintEntityImportPosition(entry);
        if (position === null) {
          result.errors.push(
            `Blueprint entity at index ${index} is missing a valid tile position.`,
          );
          continue;
        }
        if (position.source === 'legacy') {
          addUniqueMessage(
            result.warnings,
            `Blueprint entity at index ${index} uses legacy x/y fields; prefer pos.x/pos.y.`,
          );
        }

        const tileKey = `${position.x},${position.y}`;
        if (seenTiles.has(tileKey)) {
          result.errors.push(`Blueprint entity at index ${index} duplicates relative tile (${position.x}, ${position.y}).`);
        } else {
          seenTiles.add(tileKey);
        }

        const hasExplicitRotation = Object.prototype.hasOwnProperty.call(entry, 'rot')
          || Object.prototype.hasOwnProperty.call(entry, 'direction')
          || Object.prototype.hasOwnProperty.call(entry, 'rotation');
        const rotation = normalizeRuntimeDirection(
          entry.rot,
        ) ?? normalizeRuntimeDirection((entry as { direction?: unknown }).direction) ?? normalizeRuntimeDirection((entry as { rotation?: unknown }).rotation);
        if (rotation === null && hasExplicitRotation) {
          addUniqueMessage(
            result.warnings,
            `Blueprint entity at index ${index} has invalid rotation and will default to North.`,
          );
        }
      }
    }
  }

  if (typeof resolvedRecord.createdAt === 'string' && resolvedRecord.createdAt.trim().length > 0) {
    const createdAtValue = resolvedRecord.createdAt.trim();
    const createdAtMs = Date.parse(createdAtValue);
    if (Number.isNaN(createdAtMs)) {
      addUniqueMessage(
        result.warnings,
        'Blueprint has invalid createdAt metadata and imported structure will default it to import time.',
      );
    } else if (createdAtMs > Date.now()) {
      addUniqueMessage(result.warnings, 'Blueprint createdAt is in the future.');
    }
  } else {
    addUniqueMessage(result.warnings, 'Blueprint createdAt metadata is missing.');
  }

  if (result.errors.length > 0) {
    return result;
  }

  const parsed = parseRuntimeBlueprintState(resolvedRecord);
  if (parsed === null) {
    result.errors.push('Blueprint payload is malformed or unsupported.');
    return result;
  }

  if (parsed.entities.length > MAX_RUNTIME_BLUEPRINT_ENTITIES) {
    result.errors.push(
      `Blueprint has ${parsed.entities.length} entities, but only ${MAX_RUNTIME_BLUEPRINT_ENTITIES} are supported.`,
    );
    return result;
  }
  const fuelCost = parsed.entities.length * PLAYER_BUILD_FUEL_COST;
  if (PLAYER_FUEL_INFINITE) {
    addUniqueMessage(result.warnings, 'Import will consume no fuel (infinite fuel mode).');
  } else {
    addUniqueMessage(result.warnings, `Import will consume ${fuelCost} fuel.`);
  }

  result.blueprint = parsed;
  return result;
};

export const describeRuntimeSaveStateSummary = (state: RuntimeSaveState): string => {
  return `v${state.version} ${state.width}x${state.height}, ${state.entities.length} entities, tick ${state.tick}.`;
};

export const validateRuntimeAgentPlanPayloadForImport = (
  payload: unknown,
): RuntimeAgentPlanImportValidation => {
  const resolved = resolveRuntimeAgentPlanImportPayload(payload);
  return {
    errors: resolved.errors,
    warnings: resolved.warnings,
    plan: resolved.plan,
  };
};

export const resolveRuntimeAgentPlanImportPayload = (
  payload: unknown,
): RuntimeAgentPlanImportPayload => {
  const result: RuntimeAgentPlanImportValidation = {
    errors: [],
    warnings: [],
    plan: null,
  };

  const resolved = normalizeRuntimeAgentPlanStoragePayload(payload);
  if (resolved === null) {
    result.errors.push('Plan payload is not a valid command list.');
    return {
      ...result,
      enabledAgents: null,
    };
  }

  if (resolved.schemaVersion > RUNTIME_AGENT_PLAN_STORAGE_SCHEMA_VERSION) {
    result.warnings.push(
      `Plan schema v${resolved.schemaVersion} is newer than the current app schema v${RUNTIME_AGENT_PLAN_STORAGE_SCHEMA_VERSION}.`,
    );
  }

  if (resolved.plan.commands.length === 0) {
    result.warnings.push('Plan has no commands.');
  }

  if (resolved.plan.commands.length > MAX_RUNTIME_AGENT_PLAN_COMMANDS) {
    result.errors.push(
      `Plan has ${resolved.plan.commands.length} commands, but only ${MAX_RUNTIME_AGENT_PLAN_COMMANDS} are supported.`,
    );
  } else {
    result.plan = resolved.plan;
  }

  return {
    ...result,
    enabledAgents: result.plan === null ? null : resolved.enabledAgents,
  };
};

export const formatRuntimeAgentPlanWarnings = (warnings: readonly string[]): string => {
  if (warnings.length === 0) {
    return '';
  }
  return ` Warnings: ${warnings.join(' ')}`;
};

export const normalizeRuntimeSaveStateForRuntime = (
  state: RuntimeSaveState,
): RuntimeSaveCompatibilitySummary => {
  const warnings: RuntimeSaveCompatibilityWarning[] = [];
  const normalizedState = cloneRuntimeStateDeep(state);

  if (normalizedState.version !== RUNTIME_SAVE_SCHEMA_VERSION) {
    addRuntimeSaveWarning(warnings, {
      code: 'schema-version-upgraded',
      message: `Upgraded save schema from v${normalizedState.version} to v${RUNTIME_SAVE_SCHEMA_VERSION}.`,
    });
    normalizedState.version = RUNTIME_SAVE_SCHEMA_VERSION;
  }

  const normalizedWidth = Math.max(1, Math.min(WORLD_WIDTH, Math.floor(normalizedState.width)));
  const normalizedHeight = Math.max(1, Math.min(WORLD_HEIGHT, Math.floor(normalizedState.height)));
  if (normalizedWidth !== normalizedState.width || normalizedHeight !== normalizedState.height) {
    addRuntimeSaveWarning(warnings, {
      code: 'map-size-mismatch',
      message: `Loaded map (${normalizedState.width}x${normalizedState.height}) into current map (${WORLD_WIDTH}x${WORLD_HEIGHT}).`,
    });
    normalizedState.width = normalizedWidth;
    normalizedState.height = normalizedHeight;
  }

  if (normalizedState.seed !== WORLD_SEED) {
    addRuntimeSaveWarning(warnings, {
      code: 'seed-mismatch',
      message: `Seed '${normalizedState.seed}' does not match current seed.`,
    });
    normalizedState.seed = WORLD_SEED;
  }

  const playerMaxFuel = Math.max(PLAYER_MAX_FUEL, normalizedState.player.maxFuel);
  const normalizedPlayerX = Math.max(0, Math.min(normalizedState.width - 1, normalizedState.player.x));
  const normalizedPlayerY = Math.max(0, Math.min(normalizedState.height - 1, normalizedState.player.y));
  const normalizedPlayerFuel = Math.max(0, Math.min(playerMaxFuel, normalizedState.player.fuel));
  if (normalizedState.player.x !== normalizedPlayerX || normalizedState.player.y !== normalizedPlayerY) {
    addRuntimeSaveWarning(warnings, {
      code: 'player-position-clamped',
      message: `Player position was clamped to (${normalizedPlayerX}, ${normalizedPlayerY}).`,
    });
  }
  if (normalizedState.player.maxFuel !== playerMaxFuel) {
    addRuntimeSaveWarning(warnings, {
      code: 'power-field-clamped',
      message: `Clamped player max fuel to ${playerMaxFuel}.`,
    });
  }

  if (normalizedState.player.fuel !== normalizedPlayerFuel) {
    addRuntimeSaveWarning(warnings, {
      code: 'power-field-clamped',
      message: 'Player fuel was clamped to valid bounds.',
    });
  }

  normalizedState.player = {
    ...normalizedState.player,
    x: normalizedPlayerX,
    y: normalizedPlayerY,
    rot: isRuntimeDirection(normalizedState.player.rot)
      ? normalizedState.player.rot
      : isLegacyRotation(normalizedState.player.rot)
        ? RUNTIME_DIRECTION_BY_NUMBER[Math.floor(normalizedState.player.rot)]
        : 'S',
    fuel: normalizedPlayerFuel,
    maxFuel: playerMaxFuel,
  };

  normalizedState.inventory = normalizeInventoryState({
    capacity: normalizedState.inventory.capacity,
    ore: normalizedState.inventory.ore,
    plate: normalizedState.inventory.plate,
    gear: normalizedState.inventory.gear,
    coal: normalizedState.inventory.coal,
    wood: normalizedState.inventory.wood,
    used: normalizedState.inventory.used,
  });

  const normalizedEntities: RuntimeSaveEntity[] = [];
  for (const entity of normalizedState.entities) {
    const resolvedKind = normalizeRuntimeSaveEntityKind(entity.kind);
    if (resolvedKind === null) {
      addRuntimeSaveWarning(warnings, {
        code: 'unknown-entity-kind',
        message: `Removed unsupported entity kind '${entity.kind}'.`,
      });
      continue;
    }

    if (resolvedKind.changed) {
      addRuntimeSaveWarning(warnings, {
        code: 'entity-kind-normalized',
        message: `Renamed entity kind '${entity.kind}' to '${resolvedKind.kind}'.`,
      });
    }

    const normalizedX = Math.max(0, Math.min(normalizedState.width - 1, entity.pos.x));
    const normalizedY = Math.max(0, Math.min(normalizedState.height - 1, entity.pos.y));
    if (entity.pos.x !== normalizedX || entity.pos.y !== normalizedY) {
      addRuntimeSaveWarning(warnings, {
        code: 'entity-position-clamped',
        message: `Clamped entity ${resolvedKind.kind} to (${normalizedX}, ${normalizedY}).`,
      });
    }

    const normalizedRotation = isRuntimeDirection(entity.rot)
      ? entity.rot
      : isLegacyRotation(entity.rot)
        ? RUNTIME_DIRECTION_BY_NUMBER[Math.floor(entity.rot)]
        : 'N';

    normalizedEntities.push({
      ...entity,
      kind: resolvedKind.kind,
      pos: {
        x: normalizedX,
        y: normalizedY,
      },
      rot: normalizedRotation,
    });
  }
  normalizedState.entities = normalizedEntities;

  const power = normalizedState.power ?? {};
  const normalizedPower: RuntimeSaveState['power'] = {};
  const rawCapacity = typeof power.capacity === 'number'
    ? Math.floor(power.capacity)
    : undefined;
  if (rawCapacity !== undefined) {
    const nextCapacity = Math.max(1, rawCapacity);
    if (nextCapacity !== rawCapacity) {
      addRuntimeSaveWarning(warnings, {
        code: 'power-field-clamped',
        message: `Clamped solar network capacity to ${nextCapacity}.`,
      });
    }
    normalizedPower.capacity = nextCapacity;
  }

  const rawStorage = typeof power.storage === 'number'
    ? Math.floor(power.storage)
    : undefined;
  if (rawStorage !== undefined) {
    const maxStorage = normalizedPower.capacity ?? Math.max(0, rawStorage);
    const nextStorage = Math.max(0, Math.min(rawStorage, maxStorage));
    if (nextStorage !== rawStorage) {
      addRuntimeSaveWarning(warnings, {
        code: 'power-field-clamped',
        message: `Clamped power storage to ${nextStorage}.`,
      });
    }
    normalizedPower.storage = nextStorage;
  }

  const normalizePositiveInt = (value: unknown): number | undefined => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return undefined;
    }
    const normalized = Math.max(0, Math.floor(value));
    if (normalized !== value) {
      addRuntimeSaveWarning(warnings, {
        code: 'power-field-clamped',
        message: `Clamped power value to ${normalized}.`,
      });
    }
    return normalized;
  };

  const normalizedDemandThisTick = normalizePositiveInt(power.demandThisTick);
  const normalizedConsumedThisTick = normalizePositiveInt(power.consumedThisTick);
  const normalizedGeneratedThisTick = normalizePositiveInt(power.generatedThisTick);
  const normalizedShortagesThisTick = normalizePositiveInt(power.shortagesThisTick);
  if (normalizedDemandThisTick !== undefined) {
    normalizedPower.demandThisTick = normalizedDemandThisTick;
  }
  if (normalizedConsumedThisTick !== undefined) {
    normalizedPower.consumedThisTick = normalizedConsumedThisTick;
  }
  if (normalizedGeneratedThisTick !== undefined) {
    normalizedPower.generatedThisTick = normalizedGeneratedThisTick;
  }
  if (normalizedShortagesThisTick !== undefined) {
    normalizedPower.shortagesThisTick = normalizedShortagesThisTick;
  }

  if (Object.keys(normalizedPower).length > 0) {
    normalizedState.power = normalizedPower;
  }

  return {
    state: normalizedState,
    warnings,
  };
};

const getPowerField = (source: unknown, key: string): number | undefined => {
  if (!isRecord(source)) {
    return undefined;
  }
  const value = source[key];
  const numeric = toCompatInt(value);
  return numeric === null ? undefined : numeric;
};

export const normalizeAutoCheckpoint = (value: unknown): RuntimeNormalizedCheckpoint | null => {
  if (!isRecord(value)) {
    return null;
  }

  const tick = toInt(value.tick);
  if (tick === null) {
    return null;
  }

  const normalizedState = parseRuntimeSaveState(value.state, { fallbackPlayerRotation: 'S' });
  if (normalizedState === null) {
    return null;
  }

  const createdAt = typeof value.createdAt === 'string' && value.createdAt.trim().length > 0 ? value.createdAt : new Date().toISOString();
  const parsedCreatedAt = Date.parse(createdAt);

  return {
    createdAt,
    createdAtTime: Number.isFinite(parsedCreatedAt) ? parsedCreatedAt : 0,
    tick,
    reason: typeof value.reason === 'string' && value.reason.trim().length > 0 ? value.reason : 'restore',
    state: normalizedState,
  };
};

export const compareRuntimeCheckpointsNewestFirst = (
  left: RuntimeNormalizedCheckpoint,
  right: RuntimeNormalizedCheckpoint,
): number => {
  if (left.tick !== right.tick) {
    return right.tick - left.tick;
  }

  if (left.createdAtTime !== right.createdAtTime) {
    return right.createdAtTime - left.createdAtTime;
  }

  return 0;
};

const normalizeInventoryState = (state: InventoryState): InventoryState => {
  const capacity = Number.isFinite(state.capacity) ? Math.max(1, Math.floor(state.capacity)) : PLAYER_INVENTORY_CAPACITY;
  const ore = Math.max(0, Math.floor(state.ore));
  const plate = Math.max(0, Math.floor(state.plate));
  const gear = Math.max(0, Math.floor(state.gear));
  const coal = Math.max(0, Math.floor(state.coal));
  const wood = Math.max(0, Math.floor(state.wood));
  const used = Math.max(0, Math.min(capacity, ore + plate + gear + coal + wood));
  return {
    capacity,
    ore,
    plate,
    gear,
    coal,
    wood,
    used,
  };
};

const readInventoryCount = (state: InventoryState, item: RuntimeItemKind): number => {
  if (item === 'coal') {
    return state.coal;
  }
  if (item === 'wood') {
    return state.wood;
  }
  if (item === 'iron-gear') {
    return state.gear;
  }
  if (item === 'iron-plate') {
    return state.plate;
  }

  return state.ore;
};

const resolveTile = (value: unknown): Tile | null => {
  if (!isRecord(value)) {
    return null;
  }
  const x = toInt(value.x);
  const y = toInt(value.y);
  if (x === null || y === null) {
    return null;
  }
  return { x, y };
};

const getEntitySnapshotState = (entity: unknown): Record<string, unknown> | null => {
  return isRecord(entity) ? (entity as Record<string, unknown>) : null;
};

const resolveBooleanFromHostProbe = (result: unknown): boolean | null => {
  if (typeof result !== 'boolean') {
    return null;
  }
  return result;
};

const collectRuntimeHostCapabilities = (hostState: Record<string, unknown>): {
  canAccept: ReadonlyArray<RuntimeItemKind>;
  canProvide: ReadonlyArray<RuntimeItemKind>;
} => {
  const canAcceptFn = hostState.canAcceptItem;
  const canProvideFn = hostState.canProvideItem;
  const acceptItem = hostState.acceptItem;
  const provideItem = hostState.provideItem;

  const canAccept = new Set<RuntimeItemKind>();
  const canProvide = new Set<RuntimeItemKind>();

  for (const item of ITEM_ORDER) {
    if (typeof canAcceptFn === 'function') {
      const accepted = resolveBooleanFromHostProbe(canAcceptFn.call(hostState, item));
      if (accepted === true) {
        canAccept.add(item);
      }
    } else if (typeof acceptItem === 'function') {
      canAccept.add(item);
    }

    if (typeof canProvideFn === 'function') {
      const canProvideItem = resolveBooleanFromHostProbe(canProvideFn.call(hostState, item));
      if (canProvideItem === true) {
        canProvide.add(item);
      }
    } else if (typeof provideItem === 'function') {
      canProvide.add(item);
    }
  }

  return {
    canAccept: Array.from(canAccept),
    canProvide: Array.from(canProvide),
  };
};

const getChestInventorySnapshotFromState = (chestState: unknown): InventoryState | null => {
  const raw = getEntitySnapshotState(chestState);
  if (raw === null) {
    return null;
  }

  const storedValue = raw.stored;
  const storedRecord = isRecord(storedValue) ? storedValue : null;
  const capacity = toInt(raw.capacity) ?? PLAYER_INVENTORY_CAPACITY;
  const ore = toInt(storedRecord?.["iron-ore"]) ?? 0;
  const plate = toInt(storedRecord?.["iron-plate"]) ?? 0;
  const gear = toInt(storedRecord?.["iron-gear"]) ?? 0;
  const coal = toInt(storedRecord?.coal) ?? 0;
  const wood = toInt(storedRecord?.wood) ?? 0;

  return normalizeInventoryState({
    capacity,
    ore,
    plate,
    gear,
    coal,
    wood,
    used: ore + plate + gear + coal + wood,
  });
};

const getAdjacentInteractiveKindLabel = (kind: string): string => {
  return RUNTIME_KIND_LABEL[kind] ?? kind;
};

const formatInteractiveCapabilities = (
  caps: Pick<HudState['adjacentInteractive'], 'canAccept' | 'canProvide'>,
): string => {
  const parts: string[] = [];
  if (caps.canAccept.length > 0) {
    const acceptList = caps.canAccept.join(', ');
    parts.push(`E:${acceptList}`);
  }
  if (caps.canProvide.length > 0) {
    const provideList = caps.canProvide.join(', ');
    parts.push(`Q:${provideList}`);
  }
  if (parts.length === 0) {
    return '';
  }

  return ` [${parts.join(' | ')}]`;
};

const toRuntimeItemKind = (value: unknown): RuntimeItemKind | null => {
  if (typeof value !== 'string') {
    return null;
  }

  return ITEM_ORDER.includes(value) ? (value as RuntimeItemKind) : null;
};

const toDisplayInteractiveItem = (value: unknown): string => {
  const kind = toRuntimeItemKind(value);
  if (kind !== null) {
    if (kind === 'iron-ore') {
      return 'ore';
    }
    if (kind === 'iron-plate') {
      return 'plate';
    }
    if (kind === 'iron-gear') {
      return 'gear';
    }

    return kind;
  }

  if (value === null) {
    return 'none';
  }

  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return 'n/a';
};

const toDisplayInteractiveNumber = (value: unknown): string => {
  const normalized = toCompatInt(value);
  if (normalized === null) {
    return 'n/a';
  }

  return String(normalized);
};

const toDisplayInteractiveBoolean = (value: unknown): string => {
  if (value === true) {
    return 'yes';
  }
  if (value === false) {
    return 'no';
  }

  return 'n/a';
};

const toDisplayInteractiveProgress = (value: unknown): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'n/a';
  }

  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
};

const buildEntityDiagnosticLines = (kind: string, hostState: Record<string, unknown>): ReadonlyArray<string> => {
  const lines: string[] = [];
  const seen = new Set<string>();

  const add = (key: string, rawValue: unknown, format: (value: unknown) => string = toDisplayInteractiveItem): void => {
    if (rawValue === undefined || seen.has(key)) {
      return;
    }

    lines.push(`${key}:${format(rawValue)}`);
    seen.add(key);
  };

  if (kind === 'miner') {
    add('output', hostState.output, toDisplayInteractiveItem);
    add('hasOutput', hostState.hasOutput, toDisplayInteractiveBoolean);
    add('justMined', hostState.justMined, toDisplayInteractiveBoolean);
  }

  if (kind === 'belt' || kind === 'splitter') {
    add('item', hostState.item);
    add('buffer', hostState.buffer);
    add('accept', hostState.accept);
    if (kind === 'splitter') {
      add('nextOutputIndex', hostState.nextOutputIndex, toDisplayInteractiveNumber);
    }
  }

  if (kind === 'inserter') {
    add('holding', hostState.holding);
    add('state', hostState.state);
    add('skipDropAtTick', hostState.skipDropAtTick, toDisplayInteractiveNumber);
  }

  if (kind === 'furnace' || kind === 'assembler') {
    add('input', hostState.input);
    add('output', hostState.output);
    add('fuel', hostState.storage, toDisplayInteractiveNumber);
    add('crafting', hostState.crafting, toDisplayInteractiveBoolean);
    add('inputOccupied', hostState.inputOccupied, toDisplayInteractiveBoolean);
    add('outputOccupied', hostState.outputOccupied, toDisplayInteractiveBoolean);
    add('progress', hostState.progress01, toDisplayInteractiveProgress);
  }

  if (kind === 'chest') {
    const stored = isRecord(hostState.stored) ? (hostState.stored as Record<string, unknown>) : null;
    add('ore', stored?.['iron-ore']);
    add('plate', stored?.['iron-plate']);
    add('gear', stored?.['iron-gear']);
    add('coal', stored?.coal);
    add('wood', stored?.wood);
    add('capacity', hostState.capacity, toDisplayInteractiveNumber);
  }

  add('storage', hostState.storage, toDisplayInteractiveNumber);
  add('storageCapacity', hostState.storageCapacity, toDisplayInteractiveNumber);
  add('tickPhase', hostState.tickPhase, toDisplayInteractiveNumber);
  add('light', hostState.light);

  return lines;
};

const formatAdjacentInteractiveValue = (value: HudState["adjacentInteractive"]): string => {
  if (value === null) {
    return 'none';
  }

  return `${getAdjacentInteractiveKindLabel(value.kind)}@(${value.x}, ${value.y})${formatInteractiveCapabilities(value)}`;
};

const buildSelectedEntitySnapshot = (sim: Simulation, tile: Tile): HudState["selectedEntity"] => {
  const entities = getEntitiesAtFromSim(sim, tile);
  const entity = entities[0];
  if (entity === undefined || typeof entity.kind !== 'string') {
    return null;
  }

  const pos = resolveTile(entity.pos);
  if (pos === null) {
    return null;
  }

  const hostState = getEntitySnapshotState(entity.state);
  const capabilities = hostState === null
    ? {
      canAccept: [] as ReadonlyArray<RuntimeItemKind>,
      canProvide: [] as ReadonlyArray<RuntimeItemKind>,
    }
    : collectRuntimeHostCapabilities(hostState);

  return {
    id: entity.id,
    kind: entity.kind,
    x: pos.x,
    y: pos.y,
    canAccept: capabilities.canAccept,
    canProvide: capabilities.canProvide,
    details: hostState === null ? [] : buildEntityDiagnosticLines(entity.kind, hostState),
  };
};

const refreshSelectedEntitySnapshot = (
  sim: Simulation,
  selected: HudState["selectedEntity"],
): HudState["selectedEntity"] => {
  if (selected === null) {
    return null;
  }

  const snapshot = buildSelectedEntitySnapshot(sim, {
    x: selected.x,
    y: selected.y,
  });

  if (snapshot === null) {
    return null;
  }

  if (selected.id.length > 0 && snapshot.id.length > 0 && snapshot.id !== selected.id) {
    return null;
  }

  return snapshot;
};

const formatSelectedEntityValue = (value: HudState["selectedEntity"]): string => {
  if (value === null) {
    return 'none';
  }

  const kindLabel = RUNTIME_KIND_LABEL[value.kind] ?? value.kind;
  return `${kindLabel}@(${value.x}, ${value.y})`;
};

const formatSelectedEntityDetails = (value: HudState["selectedEntity"]): string => {
  if (value === null || value.details.length === 0) {
    return 'none';
  }
  return value.details.join(' · ');
};

type CursorResourceSummary = {
  label: string;
  remaining: number;
  remainingKnown: boolean;
};

const getCursorResourceSummary = (
  map: ReturnType<typeof createMap> | null,
  tile: Tile | null,
): CursorResourceSummary | null => {
  if (map === null || tile === null) {
    return null;
  }

  if (!map.isOre(tile.x, tile.y) && !map.isTree(tile.x, tile.y)) {
    return null;
  }

  const label = map.isTree(tile.x, tile.y)
    ? 'Wood'
    : map.isCoal(tile.x, tile.y)
      ? 'Coal'
      : 'Iron Ore';

  const readAmount = map.getResourceAmountAt;
  if (typeof readAmount !== 'function') {
    return {
      label,
      remaining: 1,
      remainingKnown: false,
    };
  }

  const remaining = readAmount(tile.x, tile.y);
  return {
    label,
    remaining,
    remainingKnown: true,
  };
};

const safeParseJson = (value: string): unknown | null => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const readUiSettingsFromStorage = (): UiSettings => {
  const raw = readRuntimeStorageItem(UI_SETTINGS_STORAGE_KEY);
  const parsed = raw === null ? null : safeParseJson(raw);
  return normalizeUiSettings(parsed, { reducedMotionDefault: getSystemReducedMotion() });
};

const writeUiSettingsToStorage = (settings: UiSettings): boolean => {
  return writeRuntimeStorageItem(UI_SETTINGS_STORAGE_KEY, JSON.stringify(normalizeUiSettings(settings, {
    reducedMotionDefault: getSystemReducedMotion(),
  })));
};

let runtimeStorageCache: Storage | null | undefined;

const resolveRuntimeStorage = (): Storage | null => {
  if (runtimeStorageCache !== undefined) {
    return runtimeStorageCache;
  }

  if (typeof window === 'undefined' || typeof window.localStorage !== 'object') {
    runtimeStorageCache = null;
    return null;
  }

  try {
    window.localStorage.getItem('__agents_ultra_runtime_storage_probe__');
    runtimeStorageCache = window.localStorage;
    return runtimeStorageCache;
  } catch {
    runtimeStorageCache = null;
    return null;
  }
};

const readRuntimeStorageItem = (storageKey: string): string | null => {
  const storage = resolveRuntimeStorage();
  if (storage === null) {
    return null;
  }

  try {
    return storage.getItem(storageKey);
  } catch {
    return null;
  }
};

const writeRuntimeStorageItem = (storageKey: string, value: string): boolean => {
  const storage = resolveRuntimeStorage();
  if (storage === null) {
    return false;
  }

  try {
    storage.setItem(storageKey, value);
    return true;
  } catch {
    return false;
  }
};

const removeRuntimeStorageItem = (storageKey: string): boolean => {
  const storage = resolveRuntimeStorage();
  if (storage === null) {
    return false;
  }

  try {
    storage.removeItem(storageKey);
    return true;
  } catch {
    return false;
  }
};

const normalizeRuntimeCheckpointStoragePayload = (value: unknown): RuntimeNormalizedCheckpoint[] => {
  if (Array.isArray(value) === false) {
    const record = isRecord(value) ? value : null;
    const nested = record === null ? null : value.checkpoints;
    if (!Array.isArray(nested)) {
      return [];
    }
    value = nested;
  }

  const checkpoints = (value as unknown[])
    .map((entry) => normalizeAutoCheckpoint(entry))
    .filter((entry): entry is RuntimeNormalizedCheckpoint => entry !== null);

  const sorted = checkpoints.sort(compareRuntimeCheckpointsNewestFirst);
  return sorted.slice(0, RUNTIME_CHECKPOINT_LIMIT);
};

const readRuntimeCheckpointsFromStorage = (): RuntimeNormalizedCheckpoint[] => {
  const raw = readRuntimeStorageItem(RUNTIME_CHECKPOINT_STORAGE_KEY);
  if (raw === null) {
    return [];
  }

  if (raw.length > MAX_RUNTIME_SAVE_IMPORT_BYTES) {
    removeRuntimeStorageItem(RUNTIME_CHECKPOINT_STORAGE_KEY);
    return [];
  }

  const parsed = safeParseJson(raw);
  if (parsed === null) {
    removeRuntimeStorageItem(RUNTIME_CHECKPOINT_STORAGE_KEY);
    return [];
  }

  const normalized = normalizeRuntimeCheckpointStoragePayload(parsed);
  if (normalized.length === 0 && Array.isArray(parsed) === false) {
    const record = isRecord(parsed) ? parsed : null;
    const hasKnownPayloadShape = record !== null && (Array.isArray(record.checkpoints) || Array.isArray(record.state));
    if (!hasKnownPayloadShape) {
      removeRuntimeStorageItem(RUNTIME_CHECKPOINT_STORAGE_KEY);
    }
  }

  return normalized;
};

const writeRuntimeCheckpointsToStorage = (checkpoints: RuntimeNormalizedCheckpoint[]): boolean => {
  const payload: RuntimeCheckpointStoragePayload = {
    schemaVersion: RUNTIME_CHECKPOINT_SCHEMA_VERSION,
    checkpoints: checkpoints,
    createdAt: new Date().toISOString(),
  };
  return writeRuntimeStorageItem(RUNTIME_CHECKPOINT_STORAGE_KEY, JSON.stringify(payload));
};

type RuntimeStorageReadResult =
  | {
      status: 'missing';
      parsed: null;
    }
  | {
      status: 'invalid';
      parsed: null;
    }
  | {
      status: 'valid';
      parsed: RuntimeSaveState;
    };

const readRuntimeSaveFromStorage = (storageKey: string): RuntimeStorageReadResult => {
  const raw = readRuntimeStorageItem(storageKey);
  if (raw === null) {
    return { status: 'missing', parsed: null };
  }
  if (raw.length > MAX_RUNTIME_SAVE_IMPORT_BYTES) {
    removeRuntimeStorageItem(storageKey);
    return { status: 'invalid', parsed: null };
  }

  const parsed = safeParseJson(raw);
  const resolved = resolveRuntimeSavePayload(parsed);
  const validation = validateRuntimeSavePayloadForImport(parsed);
  if (validation.errors.length > 0) {
    removeRuntimeStorageItem(storageKey);
    return { status: 'invalid', parsed: null };
  }
  const normalized = resolved === null ? null : parseRuntimeSaveState(resolved);
  if (normalized === null) {
    removeRuntimeStorageItem(storageKey);
    return { status: 'invalid', parsed: null };
  }

  return { status: 'valid', parsed: normalized };
};

const resolveRuntimeSavePayload = (value: unknown): unknown | null => {
  if (isRecord(value) === false) {
    return null;
  }

  const nested = value.state;
  if (isRecord(nested) && parseRuntimeSaveState(nested) !== null) {
    return nested;
  }

  return value;
};

const getSaveSlotStorageKey = (slot: number): string => `${SAVE_SLOT_STORAGE_KEY_PREFIX}${slot}`;

const isRuntimeSaveSlotIndex = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < RUNTIME_SAVE_SLOT_COUNT;
};

const normalizeRuntimeSaveSlotIndex = (value: unknown, fallback = SAVE_SLOT_INDEX_FALLBACK): number => {
  if (!Number.isFinite(typeof value === 'number' ? value : Number.NaN)) {
    return fallback;
  }

  const normalized = Math.floor(value as number);
  return normalized < 0 ? fallback : Math.min(RUNTIME_SAVE_SLOT_COUNT - 1, normalized);
};

const readRuntimeSaveSlotMeta = (): RuntimeSaveSlotMeta[] => {
  const result: RuntimeSaveSlotMeta[] = [];
  for (let index = 0; index < RUNTIME_SAVE_SLOT_COUNT; index += 1) {
    const key = getSaveSlotStorageKey(index);
    const raw = readRuntimeStorageItem(key);
    if (raw === null) {
      result.push({ index, hasValue: false, updatedAt: null });
      continue;
    }

    const parsed = safeParseJson(raw);
    const resolved = resolveRuntimeSavePayload(parsed);
    const parsedState = resolved === null ? null : parseRuntimeSaveState(resolved);
    const hasValue = parsedState !== null;
    if (!hasValue) {
      removeRuntimeStorageItem(key);
    }

    const updatedAt = hasValue && isRecord(parsed) && typeof parsed.createdAt === 'string' && parsed.createdAt.trim().length > 0
      ? parsed.createdAt
      : null;
    result.push({
      index,
      hasValue,
      updatedAt,
    });
  }

  return result;
};

type RuntimeSaveSlotMeta = {
  index: number;
  hasValue: boolean;
  updatedAt: string | null;
};

const getEntitiesAtFromSim = (sim: Simulation, tile: Tile): RuntimeEntity[] => {
  const rawGetEntitiesAt = (sim as { getEntitiesAt?: (tile: Tile) => unknown[] }).getEntitiesAt;
  if (typeof rawGetEntitiesAt === 'function') {
    try {
      const entities = rawGetEntitiesAt.call(sim, tile);
      if (Array.isArray(entities)) {
        return entities.filter((entry): entry is RuntimeEntity => isRecord(entry) && resolveTile(entry.pos) !== null);
      }
    } catch {
      // fall back to getAllEntities if direct access throws.
    }
  }

  const rawGetAllEntities = (sim as { getAllEntities?: () => unknown[] }).getAllEntities;
  if (typeof rawGetAllEntities !== 'function') {
    return [];
  }

  const allEntities = rawGetAllEntities.call(sim);
  if (!Array.isArray(allEntities)) {
    return [];
  }

  return allEntities.filter((entry): entry is RuntimeEntity => {
    if (!isRecord(entry)) {
      return false;
    }
    const pos = resolveTile(entry.pos);
    return pos !== null && pos.x === tile.x && pos.y === tile.y;
  });
};

const getAdjacentInteractiveSnapshot = (sim: Simulation, player: Tile | null): HudState["adjacentInteractive"] => {
  if (player === null) {
    return null;
  }

  const candidates = getAdjacentInteractionTiles(player);

  for (const candidate of candidates) {
    const entities = getEntitiesAtFromSim(sim, candidate);
    if (!Array.isArray(entities)) {
      continue;
    }

    for (const rawEntity of entities) {
      if (!isRecord(rawEntity)) {
        continue;
      }

      const kind = typeof rawEntity.kind === 'string' ? rawEntity.kind : null;
      if (kind === null) {
        continue;
      }

      const pos = resolveTile(rawEntity.pos);
      if (pos === null || pos.x !== candidate.x || pos.y !== candidate.y) {
        continue;
      }

      const hostState = getEntitySnapshotState(rawEntity.state);
      if (hostState === null) {
        continue;
      }

      const canAccept = hostState.canAcceptItem;
      const acceptItem = hostState.acceptItem;
      const canProvide = hostState.canProvideItem;
      const provideItem = hostState.provideItem;
      if (
        typeof canAccept !== 'function' &&
        typeof acceptItem !== 'function' &&
        typeof canProvide !== 'function' &&
        typeof provideItem !== 'function'
      ) {
        continue;
      }

      return {
        id: typeof rawEntity.id === 'string' ? rawEntity.id : '',
        x: pos.x,
        y: pos.y,
        kind,
        ...collectRuntimeHostCapabilities(hostState),
        details: buildEntityDiagnosticLines(kind, hostState),
      };
    }
  }

  return null;
};

const KEYBOARD_SHORTCUT_HINTS: ReadonlyArray<ShortcutHelpSection> = [
  {
    heading: 'Navigation',
    items: [
      {
        keys: 'W/A/S/D',
        description: 'Move player',
      },
      {
        keys: 'Arrows',
        description: 'Move player',
      },
      {
        keys: 'K',
        description: 'Open/close shortcuts overlay',
      },
      {
        keys: 'Home / End',
        description: 'Center camera on spawn / player',
      },
      {
        keys: '[ ]',
        description: 'Zoom out / in',
      },
      {
        keys: '- / +',
        description: 'Cycle save slots',
      },
      {
        keys: 'M / Alt+M',
        description: 'Center on player / toggle auto-follow',
      },
    ],
  },
  {
    heading: 'Save slots',
    items: [
      {
        keys: 'Ctrl/Cmd+1-3',
        description: 'Select active save slot',
      },
      {
        keys: 'Ctrl/Cmd+Shift+1-3',
        description: 'Save state to slot',
      },
      {
        keys: 'Alt+1-3',
        description: 'Load state from slot',
      },
    ],
  },
  {
    heading: 'Tools',
    items: [
      {
        keys: '1-8',
        description: 'Select build tool',
      },
      {
        keys: '0 / Esc',
        description: 'Clear active tool',
      },
      {
        keys: 'R',
        description: 'Rotate tool ghost',
      },
      {
        keys: 'Tab',
        description: 'Cycle tool forward/backward',
      },
      {
        keys: 'H',
        description: 'Toggle HUD visibility',
      },
    ],
  },
  {
    heading: 'Simulation',
    items: [
      {
        keys: 'Space / P',
        description: 'Pause / resume simulation',
      },
      {
        keys: '/ / Shift+/',
        description: 'Step simulation 1 / 10 ticks',
      },
      {
        keys: 'Mouse wheel',
        description: 'Zoom camera while on canvas',
      },
    ],
  },
  {
    heading: 'Runtime actions',
    items: [
      {
        keys: 'F',
        description: 'Refuel from nearby furnace fuel',
      },
      {
        keys: 'X',
        description: 'Mine adjacent ore/coal/tree tile in front',
      },
      {
        keys: 'Q / E',
        description: 'Chest pickup / deposit',
      },
      {
        keys: 'Start Plan',
        description: 'Begin runtime plan execution',
      },
      {
        keys: 'Step Plan',
        description: 'Run one runtime plan command',
      },
      {
        keys: 'Stop Plan',
        description: 'Stop runtime plan execution',
      },
      {
        keys: 'Ctrl+Shift+C / Ctrl+Shift+V',
        description: 'Copy / paste runtime state payload',
      },
      {
        keys: 'Ctrl+Shift+B',
        description: 'Copy runtime blueprint payload',
      },
      {
        keys: 'Ctrl+Shift+U',
        description: 'Copy runtime save share link',
      },
      {
        keys: 'Ctrl+Shift+L',
        description: 'Copy runtime blueprint share link',
      },
      {
        keys: 'Ctrl+Shift+O',
        description: 'Paste runtime save share link from clipboard',
      },
      {
        keys: 'Ctrl+Shift+I',
        description: 'Paste runtime blueprint share link from clipboard',
      },
      {
        keys: 'Ctrl+Shift+P',
        description: 'Paste runtime blueprint payload',
      },
      {
        keys: 'Ctrl+Z / Ctrl+Shift+Z',
        description: 'Undo / redo placement action',
      },
      {
        keys: 'Ctrl+Y',
        description: 'Redo placement action',
      },
      {
        keys: 'T',
        description: 'Toggle reduced motion',
      },
    ],
  },
];

const KEYBOARD_SHORTCUT_ACTIONS: ReadonlyArray<ShortcutHelpAction> = [
  {
    id: 'toggle-pause',
    label: 'Pause / Resume',
    description: 'Space / P',
  },
  {
    id: 'step-1',
    label: 'Step 1 Tick',
    description: 'Advance one tick while paused.',
  },
  {
    id: 'step-10',
    label: 'Step 10 Ticks',
    description: 'Advance ten ticks while paused.',
  },
  {
    id: 'clear-tool',
    label: 'Clear Tool',
    description: 'Clear active build tool.',
  },
  {
    id: 'mine',
    label: 'Mine',
    description: 'Mine adjacent resource in front.',
  },
  {
    id: 'center-player',
    label: 'Center Player',
    description: 'Focus camera on player.',
  },
  {
    id: 'toggle-auto-follow',
    label: 'Toggle Auto-Follow',
    description: 'Follow player camera.',
  },
  {
    id: 'toggle-svgs',
    label: 'Toggle SVGs',
    description: 'Show/hide sprite rendering.',
  },
  {
    id: 'toggle-hud',
    label: 'Toggle HUD',
    description: 'Show/hide the main HUD panel.',
  },
  {
    id: 'toggle-reduced-motion',
    label: 'Toggle Reduced Motion',
    description: 'Disable animation and motion effects.',
  },
  {
    id: 'plan-start',
    label: 'Start Plan',
    description: 'Begin runtime plan execution.',
  },
  {
    id: 'plan-step',
    label: 'Step Plan',
    description: 'Run one runtime plan command.',
  },
  {
    id: 'plan-stop',
    label: 'Stop Plan',
    description: 'Stop runtime plan execution.',
  },
  {
    id: 'save-copy',
    label: 'Copy Save',
    description: 'Copy runtime state payload to clipboard.',
  },
  {
    id: 'save-paste',
    label: 'Paste Save',
    description: 'Paste runtime state payload from clipboard.',
  },
  {
    id: 'blueprint-copy',
    label: 'Copy Blueprint',
    description: 'Copy runtime blueprint payload to clipboard.',
  },
  {
    id: 'blueprint-paste',
    label: 'Paste Blueprint',
    description: 'Paste runtime blueprint payload from clipboard.',
  },
  {
    id: 'save-share-link',
    label: 'Copy Save Share Link',
    description: 'Copy runtime share link for current state.',
  },
  {
    id: 'blueprint-share-link',
    label: 'Copy Blueprint Share Link',
    description: 'Copy runtime share link for current blueprint.',
  },
  {
    id: 'save-share-link-paste',
    label: 'Paste Save Share Link',
    description: 'Load runtime save from link in clipboard.',
  },
  {
    id: 'blueprint-share-link-paste',
    label: 'Paste Blueprint Share Link',
    description: 'Load runtime blueprint from link in clipboard.',
  },
];

const getAdjacentChestSnapshot = (sim: Simulation, player: Tile | null): HudState["adjacentChest"] => {
  if (player === null) {
    return null;
  }

  const candidates = getAdjacentInteractionTiles(player);

  for (const candidate of candidates) {
    const entities = getEntitiesAtFromSim(sim, candidate);
    if (!Array.isArray(entities)) {
      continue;
    }

    for (const rawEntity of entities) {
      if (!isRecord(rawEntity)) {
        continue;
      }
      if (rawEntity.kind !== 'chest') {
        continue;
      }

      const pos = resolveTile(rawEntity.pos);
      if (pos === null) {
        continue;
      }

      if (pos.x !== candidate.x || pos.y !== candidate.y) {
        continue;
      }

      const chestSnapshot = getChestInventorySnapshotFromState(rawEntity.state);
      if (chestSnapshot === null) {
        continue;
      }

      return {
        id: typeof rawEntity.id === 'string' ? rawEntity.id : `${rawEntity.id ?? 'chest'}`,
        x: pos.x,
        y: pos.y,
        inventory: chestSnapshot,
        used: chestSnapshot.used,
        remaining: Math.max(0, chestSnapshot.capacity - chestSnapshot.used),
      };
    }
  }

  return null;
};

const isAdjacentTile = (a: Tile, b: Tile): boolean => {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return dx + dy <= 1;
};

const getEntitiesAtTile = (sim: Simulation, tile: Tile): RuntimeEntity[] => {
  const rawGetAll = (sim as { getAllEntities?: () => unknown[] }).getAllEntities;
  if (typeof rawGetAll !== 'function') {
    return [];
  }

  const entities = rawGetAll.call(sim);
  if (!Array.isArray(entities)) {
    return [];
  }

  return entities.filter((entry): entry is RuntimeEntity => {
    if (!isRecord(entry)) {
      return false;
    }
    const pos = resolveTile(entry.pos);
    return pos !== null && pos.x === tile.x && pos.y === tile.y;
  });
};

const MOVE_HOTKEY_TO_DIRECTION: Readonly<Record<string, RuntimeDirection>> = {
  KeyW: 'N',
  ArrowUp: 'N',
  KeyD: 'E',
  ArrowRight: 'E',
  KeyS: 'S',
  ArrowDown: 'S',
  KeyA: 'W',
  ArrowLeft: 'W',
};

type RuntimePlayer = {
  x: number;
  y: number;
  rot: RuntimeDirection;
  fuel: number;
  maxFuel: number;
};

function createRuntimeSimulation(): RuntimeSimulation {
  const map = createMap(WORLD_WIDTH, WORLD_HEIGHT, WORLD_SEED);
  const coreSim = createSim({
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    seed: WORLD_SEED,
    map,
  });
  const player: RuntimePlayer = {
    x: Math.floor(WORLD_WIDTH / 2),
    y: Math.floor(WORLD_HEIGHT / 2),
    rot: 'S',
    fuel: PLAYER_MAX_FUEL,
    maxFuel: PLAYER_MAX_FUEL,
  };
  const playerInventory: InventoryState = {
    ore: 0,
    plate: 0,
    gear: 0,
    coal: 0,
    wood: 0,
    used: 0,
    capacity: PLAYER_INVENTORY_CAPACITY,
  };
  let intervalId: number | null = null;
  let runtimeRenderCallback: (() => void) | null = null;
  let placementRevision = 0;

  const emitRuntimeRender = (): void => {
    if (typeof runtimeRenderCallback === 'function') {
      runtimeRenderCallback();
    }
  };

  const touchPlacementRevision = (): void => {
    placementRevision += 1;
  };

  const runSimulationTick = (): void => {
    const previousTick = coreSim.tick;
    const previousTickCount = coreSim.tickCount;
    coreSim.step(SIM_STEP_MS);
    if (coreSim.tick !== previousTick || coreSim.tickCount !== previousTickCount) {
      emitRuntimeRender();
    }
  };

  const clearSimulationInterval = (): void => {
    if (intervalId === null) {
      return;
    }
    window.clearInterval(intervalId);
    intervalId = null;
  };

  const startSimulationInterval = (): void => {
    if (intervalId !== null || coreSim.paused) {
      return;
    }
    intervalId = window.setInterval(runSimulationTick, SIM_STEP_MS);
  };

  const pauseSimulation = (): void => {
    coreSim.pause();
    clearSimulationInterval();
  };

  const resumeSimulation = (): void => {
    coreSim.resume();
    startSimulationInterval();
  };

  const toggleSimulationPause = (): void => {
    if (coreSim.paused) {
      resumeSimulation();
      emitRuntimeRender();
      return;
    }
    pauseSimulation();
    emitRuntimeRender();
  };

  const getInventoryUsed = (state: InventoryState): number => {
    return Math.max(
      0,
      Math.floor(state.ore) +
        Math.floor(state.plate) +
        Math.floor(state.gear) +
        Math.floor(state.coal) +
        Math.floor(state.wood),
    );
  };

  const normalizeInventory = (state: InventoryState): InventoryState => {
    const capacity = Number.isFinite(state.capacity) ? Math.max(1, Math.floor(state.capacity)) : PLAYER_INVENTORY_CAPACITY;
    const ore = Math.max(0, Math.floor(state.ore));
    const plate = Math.max(0, Math.floor(state.plate));
    const gear = Math.max(0, Math.floor(state.gear));
    const coal = Math.max(0, Math.floor(state.coal));
    const wood = Math.max(0, Math.floor(state.wood));
    const used = Math.max(0, Math.min(capacity, ore + plate + gear + coal + wood));
    return {
      capacity,
      ore,
      plate,
      gear,
      coal,
      wood,
      used,
    };
  };

  const hasPlayerFuel = (cost: number): boolean => {
    return PLAYER_FUEL_INFINITE || cost <= 0 || player.fuel >= cost;
  };

  const consumePlayerFuel = (cost: number): void => {
    if (!PLAYER_FUEL_INFINITE && cost > 0) {
      player.fuel = Math.max(0, player.fuel - cost);
    }
  };

  const resolveMineableItemFromTile = (tile: Tile): RuntimeItemKind | null => {
    if (!map.isOre(tile.x, tile.y) && !map.isTree(tile.x, tile.y)) {
      return null;
    }

    if (map.isCoal(tile.x, tile.y)) {
      return 'coal';
    }
    if (map.isTree(tile.x, tile.y)) {
      return 'wood';
    }

    return 'iron-ore';
  };

  const consumeMineableResourceFromTile = (tile: Tile): boolean => {
    const consumeResource = typeof map.consumeResource === 'function'
      ? map.consumeResource
      : null;
    if (consumeResource === null) {
      return true;
    }

    return consumeResource(tile.x, tile.y);
  };

  playerInventory.capacity = normalizeInventory(playerInventory).capacity;
  playerInventory.ore = normalizeInventory(playerInventory).ore;
  playerInventory.plate = normalizeInventory(playerInventory).plate;
  playerInventory.used = getInventoryUsed(playerInventory);

  const toInt = (value: unknown): number | null => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }
    const normalized = Math.floor(value);
    return normalized >= 0 ? normalized : 0;
  };

  const readChestState = (state: unknown): ChestStateLike | null => {
    if (state === null || typeof state !== 'object') {
      return null;
    }
    return state as ChestStateLike;
  };

  const getChestState = (entity: { id: string; state?: unknown }): ChestStateLike | null => {
    const direct = readChestState(entity.state);
    if (direct !== null) {
      return direct;
    }
    const core = (coreSim as { getEntityById?: (id: string) => { state?: unknown } | undefined }).getEntityById?.(entity.id);
    return core !== undefined ? readChestState(core?.state) : null;
  };

  const readEntitySnapshotState = (state: unknown): Record<string, unknown> | null => {
    return getEntitySnapshotState(state);
  };

  const getEntityHostState = (entity: { id: string; state?: unknown }): Record<string, unknown> | null => {
    const direct = readEntitySnapshotState(entity.state);
    const directHasHostMethods = direct !== null
      && (typeof direct.canAcceptItem === 'function'
        || typeof direct.canProvideItem === 'function'
        || typeof direct.acceptItem === 'function'
        || typeof direct.provideItem === 'function');
    if (directHasHostMethods) {
      return direct;
    }

    const core = (coreSim as { getEntityById?: (id: string) => { state?: unknown } | undefined }).getEntityById?.(entity.id);
    return core !== undefined ? readEntitySnapshotState(core?.state) : direct;
  };

  const getRuntimeItemHost = (entity: { id: string; kind: string; pos: Tile; state?: unknown }): RuntimeItemHost | null => {
    const hostState = getEntityHostState(entity);
    if (hostState === null) {
      return null;
    }

    const canAccept = hostState.canAcceptItem;
    const acceptItem = hostState.acceptItem;
    const canProvide = hostState.canProvideItem;
    const provideItem = hostState.provideItem;
    const hasHostMethods =
      typeof canAccept === 'function' ||
      typeof acceptItem === 'function' ||
      typeof canProvide === 'function' ||
      typeof provideItem === 'function';
    if (!hasHostMethods) {
      return null;
    }

    return {
      id: entity.id,
      kind: entity.kind,
      x: entity.pos.x,
      y: entity.pos.y,
      state: hostState,
      canAcceptItem: typeof canAccept === 'function' ? canAccept : undefined,
      acceptItem: typeof acceptItem === 'function' ? acceptItem : undefined,
      canProvideItem: typeof canProvide === 'function' ? canProvide : undefined,
      provideItem: typeof provideItem === 'function' ? provideItem : undefined,
    };
  };

  function getAdjacentItemHosts(tile: Tile): Array<RuntimeItemHost> {
    const result: Array<RuntimeItemHost> = [];
    const candidateTiles = getAdjacentInteractionTiles(tile);
    for (const candidate of candidateTiles) {
      const entities = coreSim.getEntitiesAt(candidate);
      for (const entity of entities) {
        if (typeof entity.kind !== 'string') {
          continue;
        }
        const host = getRuntimeItemHost(entity);
        if (host !== null) {
          result.push(host);
        }
      }
    }

    return result;
  }

  const getChestInventorySnapshot = (chestState: ChestStateLike): InventoryState => {
    const storedValue = chestState.stored;
    const storedRecord = isRecord(storedValue) ? storedValue : null;
    const capacity = toInt(chestState.capacity) ?? PLAYER_INVENTORY_CAPACITY;
    const ore = toInt(storedRecord?.["iron-ore"]) ?? 0;
    const plate = toInt(storedRecord?.["iron-plate"]) ?? 0;
    const gear = toInt(storedRecord?.["iron-gear"]) ?? 0;
    const coal = toInt(storedRecord?.coal) ?? 0;
    const wood = toInt(storedRecord?.wood) ?? 0;
    return normalizeInventory({
      capacity,
      ore,
      plate,
      gear,
      coal,
      wood,
      used: ore + plate + gear + coal + wood,
    });
  };

  const getPlayerInventorySnapshot = (): InventoryState => {
    return normalizeInventory({ ...playerInventory, used: getInventoryUsed(playerInventory) });
  };

  const setPlayerInventory = (next: InventoryState): void => {
    const normalized = normalizeInventory(next);
    playerInventory.ore = normalized.ore;
    playerInventory.plate = normalized.plate;
    playerInventory.gear = normalized.gear;
    playerInventory.coal = normalized.coal;
    playerInventory.wood = normalized.wood;
    playerInventory.used = normalized.used;
    playerInventory.capacity = normalized.capacity;
  };

  const interactWithAdjacentItemHost = (
    action: 'pickup' | 'deposit',
    targetId?: string,
  ): CoreActionOutcome => {
    const candidates = getAdjacentItemHosts(player);
    const filteredCandidates = typeof targetId === 'string'
      ? candidates.filter((candidate) => candidate.id === targetId)
      : candidates;

    if (typeof targetId === 'string' && filteredCandidates.length === 0) {
      return {
        ok: false,
        reasonCode: 'no_host',
        reason: 'No host nearby.',
      };
    }

    const targetCandidates = filteredCandidates;
    if (targetCandidates.length === 0) {
      return {
        ok: false,
        reasonCode: 'no_host',
        reason: 'No host nearby.',
      };
    }

    if (action === 'pickup') {
      if (playerInventory.used >= playerInventory.capacity) {
        return {
          ok: false,
          reasonCode: 'inventory_full',
          reason: 'Player inventory full.',
        };
      }

      for (const candidate of targetCandidates) {
        const provide = candidate.state.provideItem;
        if (typeof provide !== 'function') {
          continue;
        }

        const takeOrder: ReadonlyArray<RuntimeItemKind> = ['iron-ore', 'iron-plate', 'iron-gear', 'coal', 'wood'];
        for (const wanted of takeOrder) {
          const got = provide.call(candidate.state, wanted) as RuntimeItemKind | null;
        if (got === 'iron-ore' || got === 'iron-plate' || got === 'iron-gear' || got === 'coal' || got === 'wood') {
            const next = { ...playerInventory };
            if (got === 'iron-ore') {
              next.ore += 1;
            } else if (got === 'iron-plate') {
              next.plate += 1;
            } else if (got === 'iron-gear') {
              next.gear += 1;
            } else if (got === 'coal') {
              next.coal += 1;
            } else {
              next.wood += 1;
            }

            next.used = getInventoryUsed(next);
            setPlayerInventory(next);
            touchPlacementRevision();
            emitRuntimeRender();
            return {
              ok: true,
              reasonCode: 'picked',
              reason: 'Picked item.',
            };
          }
        }
      }

      return {
        ok: false,
        reasonCode: 'chest_empty',
        reason: 'Host has no retrievable items.',
      };
    }

    if (playerInventory.ore + playerInventory.plate + playerInventory.gear + playerInventory.coal + playerInventory.wood <= 0) {
      return {
        ok: false,
        reasonCode: 'nothing_to_deposit',
        reason: 'Nothing in inventory.',
      };
    }

    for (const candidate of targetCandidates) {
      const canAcceptItem = candidate.canAcceptItem;
      const acceptItem = candidate.acceptItem;
      if (typeof acceptItem !== 'function') {
        continue;
      }

      const putOrder: ReadonlyArray<RuntimeItemKind> = ['iron-ore', 'iron-plate', 'iron-gear', 'coal', 'wood'];
      for (const offered of putOrder) {
        const countAvailable = readInventoryCount(playerInventory, offered);
        if (countAvailable <= 0) {
          continue;
        }

        const canAccept = canAcceptItem === undefined ? true : canAcceptItem.call(candidate.state, offered);
        if (canAccept !== true) {
          continue;
        }

        const accepted = acceptItem.call(candidate.state, offered);
        if (accepted === true) {
          const next = { ...playerInventory };
          const nextCount = countAvailable - 1;
          if (offered === 'iron-ore') {
            next.ore = nextCount;
          } else if (offered === 'iron-plate') {
            next.plate = nextCount;
          } else if (offered === 'iron-gear') {
            next.gear = nextCount;
          } else if (offered === 'coal') {
            next.coal = nextCount;
          } else {
            next.wood = nextCount;
          }
          setPlayerInventory(next);
          touchPlacementRevision();
          emitRuntimeRender();
          return {
            ok: true,
            reasonCode: 'deposited',
            reason: 'Deposited item.',
          };
        }
      }
    }

    return {
      ok: false,
      reasonCode: 'host_full',
      reason: 'Host cannot accept items.',
    };
  };

  const inBounds = (tile: Tile): boolean =>
    tile.x >= 0 && tile.y >= 0 && tile.x < WORLD_WIDTH && tile.y < WORLD_HEIGHT;

  const getEntitiesAtSafe = (tile: Tile): RuntimeEntity[] => {
    const getEntitiesAt = coreSim.getEntitiesAt;
    if (typeof getEntitiesAt !== 'function') {
      return [];
    }

    try {
      const entities = getEntitiesAt(tile);
      return Array.isArray(entities) ? entities : [];
    } catch {
      return [];
    }
  };

  const hasEntityAt = (tile: Tile): boolean => {
    if (typeof coreSim.getEntitiesAt !== 'function') {
      return true;
    }
    return getEntitiesAtSafe(tile).length > 0;
  };

  const isMineableResourceTile = (tile: Tile): boolean => {
    return map.isOre(tile.x, tile.y) || map.isTree(tile.x, tile.y);
  };

  const canPlaceKind = (kind: EntityKind, tile: Tile): CoreActionOutcome => {
    if (!inBounds(tile)) {
      return { ok: false, reasonCode: 'out_of_bounds' };
    }
    if (player.x === tile.x && player.y === tile.y) {
      return { ok: false, reasonCode: 'occupied' };
    }
    if (!hasPlayerFuel(PLAYER_BUILD_FUEL_COST)) {
      return { ok: false, reasonCode: 'no_fuel' };
    }
    if (hasEntityAt(tile)) {
      return { ok: false, reasonCode: 'occupied' };
    }
    if (kind === 'Miner' && !map.isOre(tile.x, tile.y) && !map.isTree(tile.x, tile.y)) {
      return { ok: false, reasonCode: 'needs_resource' };
    }
    return { ok: true, reasonCode: 'ok' };
  };

  const placeEntity = (kind: EntityKind, tile: Tile, rotation: Rotation): CoreActionOutcome => {
    const canPlace = canPlaceKind(kind, tile);
    if (!canPlace.ok) {
      return canPlace;
    }

    coreSim.addEntity(RUNTIME_KIND[kind], {
      pos: { x: tile.x, y: tile.y },
      rot: ROTATION_TO_DIRECTION[rotation],
    });
    consumePlayerFuel(PLAYER_BUILD_FUEL_COST);
    touchPlacementRevision();
    emitRuntimeRender();
    return { ok: true, reasonCode: 'placed' };
  };

  const removeEntityAt = (tile: Tile): CoreActionOutcome => {
    if (!inBounds(tile)) {
      return { ok: false, reasonCode: 'out_of_bounds' };
    }
    if (typeof coreSim.getEntitiesAt !== 'function') {
      return { ok: false, reasonCode: 'blocked' };
    }

    const entities = getEntitiesAtSafe(tile);
    const firstEntity = entities[0];
    if (!firstEntity) {
      return { ok: false, reasonCode: 'no_entity' };
    }

    const removed = coreSim.removeEntity(firstEntity.id);
    if (removed) {
      touchPlacementRevision();
      emitRuntimeRender();
    }
    return removed ? { ok: true, reasonCode: 'removed' } : { ok: false, reasonCode: 'blocked' };
  };

  const movePlayer = (direction: RuntimeDirection): CoreActionOutcome => {
    if (typeof coreSim.getEntitiesAt !== 'function') {
      return { ok: false, reasonCode: 'blocked', reason: 'Movement blocked.' };
    }

    const delta = DIRECTION_TO_DELTA[direction];
    const next = {
      x: player.x + delta.x,
      y: player.y + delta.y,
    };

    if (!inBounds(next)) {
      return { ok: false, reasonCode: 'out_of_bounds' };
    }
    if (!hasPlayerFuel(PLAYER_MOVE_FUEL_COST)) {
      return { ok: false, reasonCode: 'no_fuel' };
    }

    if (isMineableResourceTile(next)) {
      return {
        ok: false,
        reasonCode: 'occupied',
        reason: 'Movement blocked: tile is mineable resource.',
      };
    }

    const blockers = getEntitiesAtSafe(next);
    if (blockers.length === 0) {
      player.x = next.x;
      player.y = next.y;
      player.rot = direction;
      consumePlayerFuel(PLAYER_MOVE_FUEL_COST);
      touchPlacementRevision();
      emitRuntimeRender();
      return { ok: true, reasonCode: 'moved' };
    }

    const blocker = blockers[0];
    const blockerKind = typeof blocker?.kind === 'string'
      ? blocker.kind
      : 'unknown';
    const blockerKindLabel = getRuntimeEntityLabel(blockerKind);
    return {
      ok: false,
      reasonCode: 'occupied',
      reason: `Movement blocked: tile occupied by ${blockerKindLabel}.`,
    };
  };

  const mineResourceAtTile = (tile: Tile): CoreActionOutcome => {
    if (!inBounds(tile)) {
      return {
        ok: false,
        reasonCode: 'out_of_bounds',
        reason: 'Target is out of bounds.',
      };
    }

    if (!isAdjacentTile(player, tile)) {
      return {
        ok: false,
        reasonCode: 'not_adjacent',
        reason: 'Move next to a resource tile first.',
      };
    }

    const minedItem = resolveMineableItemFromTile(tile);
    if (minedItem === null) {
      return {
        ok: false,
        reasonCode: 'not_mineable',
        reason: 'No mineable resource at this tile.',
      };
    }

    if (!hasPlayerFuel(PLAYER_MINE_FUEL_COST)) {
      return {
        ok: false,
        reasonCode: 'no_fuel',
        reason: 'Mining blocked: no fuel.',
      };
    }

    if (playerInventory.used >= playerInventory.capacity) {
      return {
        ok: false,
        reasonCode: 'inventory_full',
        reason: 'Player inventory full.',
      };
    }

    const consumed = consumeMineableResourceFromTile(tile);
    if (!consumed) {
      return {
        ok: false,
        reasonCode: 'not_mineable',
        reason: 'Resource is depleted.',
      };
    }

    const resourceSummary = getCursorResourceSummary(map, tile);
    const remainingText = resourceSummary === null || !resourceSummary.remainingKnown || resourceSummary.remaining < 0
      ? ''
      : ` (${resourceSummary.label} remaining ${resourceSummary.remaining})`;

    const next = { ...playerInventory };
    if (minedItem === 'iron-ore') {
      next.ore += 1;
    } else if (minedItem === 'coal') {
      next.coal += 1;
    } else if (minedItem === 'wood') {
      next.wood += 1;
    } else if (minedItem === 'iron-plate') {
      next.plate += 1;
    } else {
      next.gear += 1;
    }
    next.used = getInventoryUsed(next);
    setPlayerInventory(next);
    consumePlayerFuel(PLAYER_MINE_FUEL_COST);
    touchPlacementRevision();
    emitRuntimeRender();
    return {
      ok: true,
      reasonCode: 'mined',
      reason: `Mined ${minedItem} at (${tile.x}, ${tile.y}).${remainingText}`,
    };
  };

  const refuel = (): CoreActionOutcome => {
    if (player.fuel >= player.maxFuel) {
      return { ok: false, reasonCode: 'fuel_full' };
    }

    if (playerInventory.coal > 0) {
      const next = { ...playerInventory };
      next.coal = Math.max(0, next.coal - 1);
      next.used = Math.max(0, next.used - 1);
      setPlayerInventory(next);
      player.fuel = Math.min(player.maxFuel, player.fuel + PLAYER_REFUEL_AMOUNT);
      touchPlacementRevision();
      emitRuntimeRender();
      return { ok: true, reasonCode: 'refueled' };
    }

    if (playerInventory.wood > 0) {
      const next = { ...playerInventory };
      next.wood = Math.max(0, next.wood - 1);
      next.used = Math.max(0, next.used - 1);
      setPlayerInventory(next);
      player.fuel = Math.min(player.maxFuel, player.fuel + PLAYER_REFUEL_AMOUNT);
      touchPlacementRevision();
      emitRuntimeRender();
      return { ok: true, reasonCode: 'refueled' };
    }

    const candidateTiles: Tile[] = [
      { x: player.x, y: player.y },
      { x: player.x + 1, y: player.y },
      { x: player.x - 1, y: player.y },
      { x: player.x, y: player.y + 1 },
      { x: player.x, y: player.y - 1 },
    ].filter(inBounds);

    for (const tile of candidateTiles) {
      const entities = coreSim.getEntitiesAt(tile);
      for (const entity of entities) {
        if (entity.kind !== 'furnace') {
          continue;
        }
        const internal = coreSim.getEntityById(entity.id);
        if (!internal || typeof internal.state !== 'object' || internal.state === null) {
          continue;
        }
        const state = internal.state as {
          provideItem?: (item: string) => string | null;
        };
        if (typeof state.provideItem !== 'function') {
          continue;
        }

        const consumed = state.provideItem('coal');
        if (consumed === 'coal') {
          player.fuel = Math.min(player.maxFuel, player.fuel + PLAYER_REFUEL_AMOUNT);
          touchPlacementRevision();
          emitRuntimeRender();
          return { ok: true, reasonCode: 'refueled' };
        }

        const woodConsumed = state.provideItem('wood');
        if (woodConsumed === 'wood') {
          player.fuel = Math.min(player.maxFuel, player.fuel + PLAYER_REFUEL_AMOUNT);
          touchPlacementRevision();
          emitRuntimeRender();
          return { ok: true, reasonCode: 'refueled' };
        }
      }
    }

    return { ok: false, reasonCode: 'no_fuel_source' };
  };

  const getRuntimeEntityLabel = (kind: string): string => {
    if (kind === 'ore' || kind === 'resource') {
      return 'resource';
    }

    return RUNTIME_KIND_LABEL[kind] ?? kind;
  };

  const getPowerSnapshot = (): RuntimeSaveState['power'] => {
    const rawPowerState = (coreSim as { getPowerState?: () => { storage?: unknown; capacity?: unknown; demandThisTick?: unknown; consumedThisTick?: unknown; generatedThisTick?: unknown; shortagesThisTick?: unknown } }).getPowerState;
    const powerState = typeof rawPowerState === 'function' ? rawPowerState.call(coreSim) : null;
    if (!isRecord(powerState)) {
      return {};
    }

    return {
      storage: toInt(powerState.storage),
      capacity: toInt(powerState.capacity),
      demandThisTick: toInt(powerState.demandThisTick),
      consumedThisTick: toInt(powerState.consumedThisTick),
      generatedThisTick: toInt(powerState.generatedThisTick),
      shortagesThisTick: toInt(powerState.shortagesThisTick),
    };
  };

  const getRuntimeSnapshot = (): RuntimeSaveState => ({
    version: RUNTIME_SAVE_SCHEMA_VERSION,
    seed: WORLD_SEED,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    tick: runtime.tick,
    tickCount: runtime.tickCount,
    elapsedMs: runtime.elapsedMs,
    paused: coreSim.paused,
    player: {
      x: player.x,
      y: player.y,
      rot: player.rot,
      fuel: player.fuel,
      maxFuel: player.maxFuel,
    },
    inventory: getPlayerInventorySnapshot(),
    entities: coreSim.getAllEntities().map((entry) => ({
      kind: String(entry.kind),
      pos: {
        x: toInt(entry.pos?.x) ?? 0,
        y: toInt(entry.pos?.y) ?? 0,
      },
      rot: isRuntimeDirection(entry.rot) ? entry.rot : 'S',
      ...(entry.state === undefined ? {} : { state: cloneRuntimeState(entry.state) }),
    })),
    power: getPowerSnapshot(),
  });

  const cloneRuntimeState = (value: unknown): Record<string, unknown> | undefined => {
    if (!isRecord(value)) {
      return undefined;
    }
    const clone: Record<string, unknown> = {};
    for (const [key, nextValue] of Object.entries(value)) {
      if (isRecord(nextValue) || Array.isArray(nextValue)) {
        clone[key] = nextValue;
      } else {
        clone[key] = nextValue as unknown;
      }
    }
    return clone;
  };

  const setPlayerFromState = (next: RuntimeSavePlayer): void => {
    player.x = Math.max(0, Math.min(WORLD_WIDTH - 1, next.x));
    player.y = Math.max(0, Math.min(WORLD_HEIGHT - 1, next.y));
    player.rot = next.rot;
    player.fuel = Math.max(0, Math.min(next.maxFuel, next.fuel));
    player.maxFuel = Math.max(PLAYER_MAX_FUEL, next.maxFuel);
  };

  const restoreRuntimeState = (state: RuntimeSaveState): CoreActionOutcome => {
    try {
      setPlayerFromState(state.player);
      setPlayerInventory({
        ore: toInt(state.inventory.ore) ?? 0,
        plate: toInt(state.inventory.plate) ?? 0,
        gear: toInt(state.inventory.gear) ?? 0,
        coal: toInt(state.inventory.coal) ?? 0,
        wood: toInt(state.inventory.wood) ?? 0,
        used: toInt(state.inventory.used) ?? 0,
        capacity: toInt(state.inventory.capacity) ?? PLAYER_INVENTORY_CAPACITY,
      });

      coreSim.restoreState({
        tick: state.tick,
        tickCount: state.tickCount,
        elapsedMs: state.elapsedMs,
        paused: state.paused,
        entities: state.entities.map((entry) => ({
          kind: entry.kind,
          pos: { x: toInt(entry.pos.x) ?? 0, y: toInt(entry.pos.y) ?? 0 },
          rot: entry.rot ?? 'S',
          state: entry.state,
        })),
        power: {
          storage: state.power?.storage,
          capacity: state.power?.capacity,
          demandThisTick: state.power?.demandThisTick,
          consumedThisTick: state.power?.consumedThisTick,
          generatedThisTick: state.power?.generatedThisTick,
          shortagesThisTick: state.power?.shortagesThisTick,
        },
      });
      if (coreSim.paused) {
        clearSimulationInterval();
      } else {
        startSimulationInterval();
      }
      touchPlacementRevision();
      emitRuntimeRender();

      return { ok: true, reasonCode: 'restored', reason: 'State restored.' };
    } catch {
      return {
        ok: false,
        reasonCode: 'restore_failed',
        reason: 'Unable to restore state.',
      };
    }
  };

  const resetRuntimeState = (): void => {
    coreSim.restoreState({
      tick: 0,
      tickCount: 0,
      elapsedMs: 0,
      paused: false,
      entities: [],
      power: {},
    });
    startSimulationInterval();
    setPlayerFromState({
      x: Math.floor(WORLD_WIDTH / 2),
      y: Math.floor(WORLD_HEIGHT / 2),
      rot: 'S',
      fuel: PLAYER_MAX_FUEL,
      maxFuel: PLAYER_MAX_FUEL,
    });
    setPlayerInventory({
      ore: 0,
      plate: 0,
      gear: 0,
      coal: 0,
      wood: 0,
      used: 0,
      capacity: PLAYER_INVENTORY_CAPACITY,
    });
    touchPlacementRevision();
    emitRuntimeRender();
  };

  const interactWithItemHostAtTile = (
    tile: Tile,
    action: 'pickup' | 'deposit',
  ): CoreActionOutcome => {
    const isAdjacent = isAdjacentTile(player, tile);
    if (!isAdjacent) {
      return {
        ok: false,
        reasonCode: 'not_adjacent',
        reason: 'Move next to a host first.',
      };
    }

    const candidates = getAdjacentItemHosts(player).filter(
      (candidate) => candidate.x === tile.x && candidate.y === tile.y,
    );
    if (candidates.length === 0) {
      return {
        ok: false,
        reasonCode: 'no_host',
        reason: 'No host there.',
      };
    }

    return interactWithAdjacentItemHost(action, candidates[0].id);
  };

  const runtime: RuntimeSimulation = {
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    tileSize: TILE_SIZE,
    get tick() {
      return coreSim.tick;
    },
    get tickCount() {
      return coreSim.tickCount;
    },
    get elapsedMs() {
      return coreSim.elapsedMs;
    },

    getMap: () => map,

    getAllEntities: () => coreSim.getAllEntities() as RuntimeEntity[],

    getPlacementSnapshot() {
      return {
        tick: runtime.tick,
        tickCount: runtime.tickCount,
        elapsedMs: runtime.elapsedMs,
        entityCount: coreSim.getAllEntities().length,
        fuel: player.fuel,
        maxFuel: player.maxFuel,
        player: { x: player.x, y: player.y },
        inventory: getPlayerInventorySnapshot(),
        revision: placementRevision,
      };
    },

    getPlayerSnapshot() {
      return {
        x: player.x,
        y: player.y,
        fuel: player.fuel,
        maxFuel: player.maxFuel,
        rot: player.rot,
      };
    },

    getInventorySnapshot() {
      return getPlayerInventorySnapshot();
    },

    canRemove(tile) {
      return inBounds(tile) && coreSim.getEntitiesAt(tile).length > 0;
    },

    hasEntityAt(tile) {
      return inBounds(tile) && hasEntityAt(tile);
    },

    isResourceTile(tile) {
      return map.isOre(tile.x, tile.y) || map.isTree(tile.x, tile.y);
    },

    getPlacementOutcome(kind, tile, _rotation) {
      return canPlaceKind(kind, tile);
    },

    canPlace(kind, tile, _rotation) {
      return canPlaceKind(kind, tile).ok === true;
    },

    placeEntity(kind, tile, rotation) {
      return placeEntity(kind, tile, rotation);
    },

    addEntity(kind, tile, rotation) {
      return placeEntity(kind, tile, rotation);
    },

    mineResourceAtTile(tile) {
      return mineResourceAtTile(tile);
    },

    removeAt(tile) {
      return removeEntityAt(tile);
    },

    removeEntity(tile) {
      return removeEntityAt(tile);
    },

    togglePause() {
      toggleSimulationPause();
    },

    pause() {
      pauseSimulation();
    },

    resume() {
      resumeSimulation();
    },

    setRuntimeRenderCallback(callback) {
      runtimeRenderCallback = typeof callback === 'function' ? callback : null;
    },

    isPaused() {
      return coreSim.paused;
    },

    movePlayer(direction) {
      return movePlayer(direction);
    },

    refuel() {
      return refuel();
    },

    pickupItem() {
      return interactWithAdjacentItemHost('pickup');
    },

    depositItem() {
      return interactWithAdjacentItemHost('deposit');
    },

    saveState() {
      return getRuntimeSnapshot();
    },

    loadState(state) {
      const resolved = resolveRuntimeSavePayload(state);
      const parsed = parseRuntimeSaveState(resolved);
      if (parsed === null) {
        return {
          ok: false,
          reasonCode: 'invalid_state',
          reason: 'Invalid state payload.',
        };
      }

      const normalized = normalizeRuntimeSaveStateForRuntime(parsed);
      return restoreRuntimeState(normalized.state);
    },

    stepTicks(count) {
      const target = Number.isInteger(count) ? Math.max(0, Math.trunc(count)) : 0;
      if (target <= 0) {
        return {
          ok: false,
          reasonCode: 'invalid_count',
          reason: 'Invalid step count.',
        };
      }

      const wasPaused = coreSim.paused;
      const previousTick = runtime.tick;
      const previousTickCount = runtime.tickCount;
      if (wasPaused) {
        coreSim.resume?.();
      }
      for (let i = 0; i < target; i += 1) {
        coreSim.step(SIM_STEP_MS);
      }
      if (wasPaused) {
        coreSim.pause?.();
      }
      if (runtime.tick !== previousTick || runtime.tickCount !== previousTickCount) {
        emitRuntimeRender();
      }

      return {
        ok: true,
        reasonCode: 'stepped',
        reason: `Advanced ${target} tick${target === 1 ? '' : 's'}.`,
      };
    },

    reset() {
      resetRuntimeState();
      emitRuntimeRender();
      return;
    },

    interactWithItemHostAtTile,

    interactWithChestAtTile(tile, action) {
      return interactWithItemHostAtTile(tile, action);
    },

    destroy() {
      clearSimulationInterval();
    },
  };

  startSimulationInterval();

  return runtime;
}

function getCanRemoveOutcome(sim: Simulation, tile: Tile): boolean {
  if (typeof sim.canRemove === 'function') {
    return sim.canRemove(tile);
  }

  const hasEntityAt = (sim as { hasEntityAt?: (tile: Tile) => boolean }).hasEntityAt;
  if (typeof hasEntityAt === 'function') {
    return hasEntityAt(tile);
  }

  return false;
}

function getSimulationTick(sim: Simulation): number {
  const snapshot = (sim as { getPlacementSnapshot?: () => { tick?: number; tickCount?: number } }).getPlacementSnapshot;
  if (typeof snapshot === 'function') {
    const value = snapshot.call(sim);
    if (typeof value?.tick === 'number') {
      return value.tick;
    }
    if (typeof value?.tickCount === 'number') {
      return value.tickCount;
    }
  }

  const withTick = sim as { tick?: unknown; tickCount?: unknown };
  if (typeof withTick.tick === 'number') {
    return withTick.tick;
  }
  if (typeof withTick.tickCount === 'number') {
    return withTick.tickCount;
  }

  return 0;
}

function getSimulationPaused(sim: Simulation): boolean {
  const withMethod = sim as { isPaused?: () => boolean };
  if (typeof withMethod.isPaused === 'function') {
    return withMethod.isPaused();
  }

  const withFlag = sim as { paused?: unknown };
  return typeof withFlag.paused === 'boolean' ? withFlag.paused : false;
}

function getSimulationFuel(sim: Simulation): { fuel: number; maxFuel: number } | null {
  const snapshot = (sim as {
    getPlacementSnapshot?: () => { fuel?: number; maxFuel?: number };
  }).getPlacementSnapshot;
  if (typeof snapshot === 'function') {
    const value = snapshot.call(sim);
    if (typeof value?.fuel === 'number' && typeof value?.maxFuel === 'number') {
      return { fuel: value.fuel, maxFuel: value.maxFuel };
    }
  }
  return null;
}

function getSimulationPlayer(sim: Simulation): Tile | null {
  const snapshot = (sim as {
    getPlacementSnapshot?: () => { player?: { x?: number; y?: number } };
  }).getPlacementSnapshot;
  if (typeof snapshot === 'function') {
    const value = snapshot.call(sim);
    if (typeof value?.player?.x === 'number' && typeof value?.player?.y === 'number') {
      return { x: value.player.x, y: value.player.y };
    }
  }

  const direct = sim as { player?: { x?: unknown; y?: unknown } };
  if (typeof direct.player?.x === 'number' && typeof direct.player?.y === 'number') {
    return { x: direct.player.x, y: direct.player.y };
  }
  return null;
}

const getSimulationPlayerDirection = (sim: Simulation): RuntimeDirection | null => {
  const withPlayerSnapshot = sim as {
    getPlayerSnapshot?: () => {
      rot?: unknown;
    };
  };
  if (typeof withPlayerSnapshot.getPlayerSnapshot === 'function') {
    const value = withPlayerSnapshot.getPlayerSnapshot();
    if (isRuntimeDirection(value?.rot)) {
      return value.rot;
    }
  }

  const direct = sim as { player?: { rot?: unknown } };
  if (isRuntimeDirection(direct.player?.rot)) {
    return direct.player.rot;
  }

  return null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

type MapResourceTotals = {
  oreRemaining: number;
  coalRemaining: number;
  woodRemaining: number;
};

const EMPTY_MAP_RESOURCE_TOTALS: MapResourceTotals = {
  oreRemaining: 0,
  coalRemaining: 0,
  woodRemaining: 0,
};

const mapResourceTotalsCache = new WeakMap<object, { revision: number; totals: MapResourceTotals }>();

function getResourceTotalsFromMap(map: ReturnType<typeof createMap>): MapResourceTotals {
  if (typeof map !== 'object' || map === null) {
    return EMPTY_MAP_RESOURCE_TOTALS;
  }

  const resourceRevision = typeof map.getResourceRevision === 'function'
    ? map.getResourceRevision()
    : -1;
  const cached = mapResourceTotalsCache.get(map);
  if (cached !== undefined && cached.revision === resourceRevision) {
    return cached.totals;
  }

  let oreRemaining = 0;
  let coalRemaining = 0;
  let woodRemaining = 0;

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const tile = map.getTile(x, y);
      if (tile === 'iron-ore') {
        oreRemaining += 1;
      } else if (tile === 'coal-ore') {
        coalRemaining += 1;
      } else if (tile === 'tree') {
        woodRemaining += 1;
      }
    }
  }

  const totals: MapResourceTotals = { oreRemaining, coalRemaining, woodRemaining };
  mapResourceTotalsCache.set(map, {
    revision: resourceRevision,
    totals,
  });

  return totals;
}

function getSimulationMetrics(sim: Simulation): RuntimeMetrics | null {
  const withEntities = sim as { getAllEntities?: () => RuntimeEntity[] };
  if (typeof withEntities.getAllEntities !== 'function') {
    return null;
  }
  const withMap = sim as { getMap?: () => ReturnType<typeof createMap> };

  const entities = withEntities.getAllEntities();
  if (!Array.isArray(entities)) {
    return null;
  }

  const metrics: RuntimeMetrics = {
    ...createEmptyRuntimeMetrics(),
    entityCount: entities.length,
  };

  for (const entity of entities) {
    if (entity.kind === 'miner') {
      metrics.miners += 1;
      continue;
    }

    if (entity.kind === 'belt') {
      metrics.belts += 1;
      const beltState = isRecord(entity.state) ? entity.state : null;
      const beltItem = typeof beltState?.item === 'string' ? beltState.item : null;
      if (beltItem === 'iron-ore') {
        metrics.oreInTransit += 1;
      } else if (beltItem === 'iron-plate') {
        metrics.platesInTransit += 1;
      } else if (beltItem === 'iron-gear') {
        metrics.gearsInTransit += 1;
      } else if (beltItem === 'coal') {
        metrics.coalInTransit += 1;
      } else if (beltItem === 'wood') {
        metrics.woodInTransit += 1;
      }
      continue;
    }

    if (entity.kind === 'inserter') {
      metrics.inserters += 1;
      const inserterState = isRecord(entity.state) ? entity.state : null;
      const held = typeof inserterState?.holding === 'string' ? inserterState.holding : null;
      if (held === 'iron-ore') {
        metrics.oreInTransit += 1;
      } else if (held === 'iron-plate') {
        metrics.platesInTransit += 1;
      } else if (held === 'iron-gear') {
        metrics.gearsInTransit += 1;
      } else if (held === 'coal') {
        metrics.coalInTransit += 1;
      } else if (held === 'wood') {
        metrics.woodInTransit += 1;
      }
      continue;
    }

    if (entity.kind === 'furnace') {
      metrics.furnaces += 1;
      const furnaceState = isRecord(entity.state) ? entity.state : null;
      const output = typeof furnaceState?.output === 'string' ? furnaceState.output : null;
      const outputOccupied = furnaceState?.outputOccupied === true;
      const progress =
        typeof furnaceState?.progress01 === 'number' ? furnaceState.progress01 : null;

      if (output === 'iron-plate' || outputOccupied) {
        metrics.furnacesReady += 1;
      } else if (progress !== null && progress > 0 && progress < 1) {
        metrics.furnacesCrafting += 1;
      }
      continue;
    }

    if (entity.kind === 'chest') {
      metrics.chests += 1;
      const chestState = isRecord(entity.state) ? entity.state : null;
      const stored = isRecord(chestState?.stored) ? chestState.stored : null;
      const chestOre = toInt(stored?.['iron-ore']) ?? 0;
      const chestPlate = toInt(stored?.['iron-plate']) ?? 0;
      const chestGear = toInt(stored?.['iron-gear']) ?? 0;
      const chestCoal = toInt(stored?.coal) ?? 0;
      const chestWood = toInt(stored?.wood) ?? 0;
      metrics.chestOre += chestOre;
      metrics.chestPlates += chestPlate;
      metrics.chestGears += chestGear;
      metrics.chestCoal += chestCoal;
      metrics.chestWood += chestWood;
      continue;
    }

    if (entity.kind === 'splitter') {
      metrics.splitters += 1;
      continue;
    }

    if (entity.kind === 'assembler') {
      metrics.assemblers += 1;
      continue;
    }

    if (entity.kind === 'solar-panel') {
      metrics.solarPanels += 1;
      continue;
    }

    if (entity.kind === 'accumulator') {
      metrics.accumulators += 1;
    }
  }

  const map = typeof withMap.getMap === 'function'
    ? withMap.getMap()
    : null;
  if (map !== undefined && map !== null) {
    const resourceTotals = getResourceTotalsFromMap(map);
    metrics.oreRemaining = resourceTotals.oreRemaining;
    metrics.coalRemaining = resourceTotals.coalRemaining;
    metrics.woodRemaining = resourceTotals.woodRemaining;
  }

  const rawPowerState = (sim as { getPowerState?: () => unknown }).getPowerState;
  const powerState = typeof rawPowerState === 'function' ? rawPowerState.call(sim) : null;
  if (isRecord(powerState)) {
    metrics.powerStorage = toInt(powerState.storage) ?? metrics.powerStorage;
    metrics.powerCapacity = toInt(powerState.capacity) ?? metrics.powerCapacity;
    metrics.powerDemandThisTick = toInt(powerState.demandThisTick) ?? metrics.powerDemandThisTick;
    metrics.powerConsumedThisTick = toInt(powerState.consumedThisTick) ?? metrics.powerConsumedThisTick;
    metrics.powerGeneratedThisTick = toInt(powerState.generatedThisTick) ?? metrics.powerGeneratedThisTick;
    metrics.powerShortagesThisTick = toInt(powerState.shortagesThisTick) ?? metrics.powerShortagesThisTick;
  }

  return metrics;
}

function describeKindOrTarget(kind: EntityKind | null, tile: Tile | null): string {
  const prefix = kind === null ? 'Selection' : kind;
  const suffix = tile === null ? '' : ` at (${tile.x}, ${tile.y})`;
  return `${prefix}${suffix}`;
}

const renderInventoryPanel = (title: string, inventory: InventoryState): JSX.Element => {
  const capacity = Math.max(1, Math.floor(inventory.capacity));
  const ore = Math.max(0, Math.floor(inventory.ore));
  const plate = Math.max(0, Math.floor(inventory.plate));
  const gear = Math.max(0, Math.floor(inventory.gear));
  const coal = Math.max(0, Math.floor(inventory.coal));
  const wood = Math.max(0, Math.floor(inventory.wood));
  const used = Math.max(0, Math.floor(inventory.used));
  const fillRatio = Math.max(0, Math.min(1, capacity > 0 ? used / capacity : 0));
  const barWidth = 130;
  const oreWidth = Math.max(0, Math.min(barWidth, Math.round((ore / capacity) * barWidth)));
  const plateWidth = Math.max(
    0,
    Math.min(
      barWidth - oreWidth,
      Math.round((plate / capacity) * barWidth),
    ),
  );
  const gearWidth = Math.max(
    0,
    Math.min(
      barWidth - oreWidth - plateWidth,
      Math.round((gear / capacity) * barWidth),
    ),
  );
  const coalWidth = Math.max(
    0,
    Math.min(
      barWidth - oreWidth - plateWidth - gearWidth,
      Math.round((coal / capacity) * barWidth),
    ),
  );
  const woodWidth = Math.max(
    0,
    Math.min(
      barWidth - oreWidth - plateWidth - gearWidth - coalWidth,
      Math.round((wood / capacity) * barWidth),
    ),
  );
  const spareWidth = Math.max(0, barWidth - oreWidth - plateWidth - gearWidth - coalWidth - woodWidth);

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
        <span style={{ opacity: 0.9 }}>{title}</span>
        <span style={{ fontFamily: 'monospace' }}>
          O:{ore} P:{plate} G:{gear} C:{coal} W:{wood}
        </span>
      </div>
      <div
        style={{
          marginTop: 4,
          height: 10,
          width: barWidth,
          border: '1px solid rgba(255,255,255,0.35)',
          background: 'rgba(255,255,255,0.06)',
          display: 'flex',
          overflow: 'hidden',
        }}
        >
        <div style={{ width: oreWidth, background: '#4f86f7' }} />
        <div style={{ width: plateWidth, background: '#f7ca4f' }} />
        <div style={{ width: gearWidth, background: '#c084fc' }} />
        <div style={{ width: coalWidth, background: ITEM_COLORS.coal }} />
        <div style={{ width: woodWidth, background: ITEM_COLORS.wood }} />
        <div style={{ width: spareWidth, background: 'rgba(255,255,255,0.08)' }} />
      </div>
      <div style={{ opacity: 0.78, marginTop: 2, fontSize: 11 }}>
        Fill {Math.round(fillRatio * 100)}% ({used}/{capacity})
      </div>
    </div>
  );
};

function ensureSimulation(): RuntimeSimulation {
  if (window.__SIM__ && typeof window.__SIM__ === 'object') {
    return window.__SIM__ as RuntimeSimulation;
  }
  const created = createRuntimeSimulation();
  window.__SIM__ = created;
  return created;
}

const NOOP_SIMULATION: Simulation = {
  canPlace(_kind: EntityKind, _tile: Tile, _rotation: Rotation): boolean {
    return false;
  },
  addEntity(_kind: EntityKind, _tile: Tile, _rotation: Rotation): void {
    // no-op fallback when no simulation is attached
  },
  removeEntity(_tile: Tile): void {
    // no-op fallback when no simulation is attached
  },
  togglePause(): void {
    // no-op fallback when no simulation is attached
  },
};

function isSimulation(value: unknown): value is Simulation {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const sim = value as Partial<Simulation>;

  return (
    typeof sim.canPlace === 'function' &&
    typeof sim.addEntity === 'function' &&
    typeof sim.removeEntity === 'function'
  );
}

function getSimulation(): Simulation {
  const sim = ensureSimulation();
  return isSimulation(sim) ? sim : NOOP_SIMULATION;
}

export function pointerToTile(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  camera: CameraState = { zoom: CAMERA_DEFAULT_ZOOM, panX: 0, panY: 0 },
): Tile | null {
  const rect = canvas.getBoundingClientRect();
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;

  if (localX < 0 || localY < 0 || localX >= rect.width || localY >= rect.height) {
    return null;
  }

  const worldW = WORLD_WIDTH * TILE_SIZE;
  const worldH = WORLD_HEIGHT * TILE_SIZE;
  if (worldW <= 0 || worldH <= 0) {
    return null;
  }

  const canvasWidth = canvas.width > 0 ? canvas.width : rect.width;
  const canvasHeight = canvas.height > 0 ? canvas.height : rect.height;
  const zoom = clampCameraZoom(camera?.zoom);
  const panX = typeof camera?.panX === 'number' && Number.isFinite(camera.panX) ? camera.panX : 0;
  const panY = typeof camera?.panY === 'number' && Number.isFinite(camera.panY) ? camera.panY : 0;

  const baseScale = Math.max(0.0001, Math.min(canvasWidth / worldW, canvasHeight / worldH));
  const scale = baseScale * zoom;
  const tileSpan = TILE_SIZE * scale;
  const viewW = worldW * scale;
  const viewH = worldH * scale;
  const offsetX = Math.floor((canvasWidth - worldW * baseScale) / 2) + panX;
  const offsetY = Math.floor((canvasHeight - worldH * baseScale) / 2) + panY;

  const gridLocalX = localX - offsetX;
  const gridLocalY = localY - offsetY;
  if (gridLocalX < 0 || gridLocalY < 0 || gridLocalX >= viewW || gridLocalY >= viewH) {
    return null;
  }

  const x = Math.floor(gridLocalX / tileSpan);
  const y = Math.floor(gridLocalY / tileSpan);
  if (x < 0 || y < 0 || x >= WORLD_WIDTH || y >= WORLD_HEIGHT) {
    return null;
  }

  return {
    x,
    y,
  };
}

function tileToScreenPoint(
  tile: Tile,
  canvas: HTMLCanvasElement,
  camera: CameraState = { zoom: CAMERA_DEFAULT_ZOOM, panX: 0, panY: 0 },
): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect();
  const worldW = WORLD_WIDTH * TILE_SIZE;
  const worldH = WORLD_HEIGHT * TILE_SIZE;
  if (worldW <= 0 || worldH <= 0) {
    return null;
  }

  const canvasWidth = canvas.width > 0 ? canvas.width : rect.width;
  const canvasHeight = canvas.height > 0 ? canvas.height : rect.height;
  const zoom = clampCameraZoom(camera?.zoom);
  const panX = typeof camera?.panX === 'number' && Number.isFinite(camera.panX) ? camera.panX : 0;
  const panY = typeof camera?.panY === 'number' && Number.isFinite(camera.panY) ? camera.panY : 0;
  const baseScale = Math.max(0.0001, Math.min(canvasWidth / worldW, canvasHeight / worldH));
  const scale = baseScale * zoom;
  const tileSpan = TILE_SIZE * scale;
  const offsetX = Math.floor((canvasWidth - worldW * baseScale) / 2) + panX;
  const offsetY = Math.floor((canvasHeight - worldH * baseScale) / 2) + panY;
  if (tile.x < 0 || tile.y < 0 || tile.x >= WORLD_WIDTH || tile.y >= WORLD_HEIGHT) {
    return null;
  }

  const x = Math.round(offsetX + tile.x * tileSpan + tileSpan / 2);
  const y = Math.round(offsetY + tile.y * tileSpan + tileSpan / 2);
  if (x < 0 || y < 0 || x >= canvasWidth || y >= canvasHeight) {
    return null;
  }

  return { x, y };
}

export default function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const controllerRef = useRef<ReturnType<typeof createPlacementController> | null>(null);
  const rendererRef = useRef<RendererApi | null>(null);
  const cameraRef = useRef<CameraState>({
    zoom: CAMERA_DEFAULT_ZOOM,
    panX: 0,
    panY: 0,
  });
  const [cameraAutoFollow, setCameraAutoFollow] = useState(false);
  const cameraAutoFollowRef = useRef(false);
  const simulationRef = useRef<Simulation>(NOOP_SIMULATION);
  const minimapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const feedbackTimeoutRef = useRef<number | null>(null);
  const runtimeSaveImportInputRef = useRef<HTMLInputElement | null>(null);
  const runtimePlanImportInputRef = useRef<HTMLInputElement | null>(null);
  const runtimeBlueprintImportInputRef = useRef<HTMLInputElement | null>(null);
  const runtimePlanIntervalRef = useRef<number | null>(null);
  const runtimePlanRef = useRef<RuntimeAgentPlan | null>(null);
  const runtimePlanRunningRef = useRef(false);
  const runtimePlanCursorRef = useRef(0);
  const runtimePlanExecutionStateRef = useRef<RuntimeAgentPlanExecutionState | null>(null);
  const runtimePlanEnabledAgentsRef = useRef<RuntimeAgentPlanEnabledAgents>({});
  const runtimePlanAgentStepDelayMsRef = useRef<Record<string, number>>({});
  const runtimePlanRunnerRef = useRef<(() => void) | null>(null);
  const runtimePlanRecordingRef = useRef(false);
  const runtimePlanRecordingCommandsRef = useRef<RuntimeAgentPlanCommand[]>([]);
  const runtimePlanRecordingAgentRef = useRef(RUNTIME_AGENT_PLAN_DEFAULT_AGENT_ID);
  const inputActionEventRef = useRef<{
    time: number;
    tile: string;
    button: "primary" | "secondary";
  } | null>(null);
  const runtimeHistoryRef = useRef<RuntimeSaveState[]>([]);
  const runtimeHistoryCursorRef = useRef(-1);
  const [runtimeCheckpoints, setRuntimeCheckpoints] = useState<RuntimeNormalizedCheckpoint[]>(() => readRuntimeCheckpointsFromStorage());
  const initialHud: HudState = {
    tool: null,
    rotation: 0,
    paused: false,
    tick: 0,
    fuel: PLAYER_MAX_FUEL,
    maxFuel: PLAYER_MAX_FUEL,
    player: {
      x: Math.floor(WORLD_WIDTH / 2),
      y: Math.floor(WORLD_HEIGHT / 2),
    },
    metrics: createEmptyRuntimeMetrics(),
    inventory: {
        ore: 0,
        gear: 0,
        plate: 0,
        coal: 0,
        wood: 0,
        used: 0,
        capacity: PLAYER_INVENTORY_CAPACITY,
    },
    selectedEntity: null,
    adjacentChest: null,
    adjacentInteractive: null,
  };
  const [selectedKind, setSelectedKind] = useState(null as EntityKind | null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const initialUiSettings = readUiSettingsFromStorage();
  const [showHud, setShowHud] = useState<boolean>(initialUiSettings.showHud);
  const [hudCollapsed, setHudCollapsed] = useState<boolean>(true);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState<boolean>(true);
  const [useSvgs, setUseSvgs] = useState<boolean>(initialUiSettings.showSvgs);
  const [reducedMotionEnabled, setReducedMotionEnabled] = useState<boolean>(initialUiSettings.reducedMotion);
  const [showTutorialHints, setShowTutorialHints] = useState<boolean>(initialUiSettings.showTutorialHints);
  const [tutorialMissions, setTutorialMissions] = useState<TutorialMissionProgress[]>(() => createInitialTutorialMissionState());
  const tutorialMissionBaselineRef = useRef<TutorialMissionBaseline | null>(null);
  const tutorialMoveOriginRef = useRef<Tile | null>(null);
  const [showTouchControls, setShowTouchControls] = useState<boolean>(() => detectCoarsePointer());
  const [activeSaveSlot, setActiveSaveSlot] = useState<number>(SAVE_SLOT_INDEX_FALLBACK);
  const activeSaveSlotRef = useRef<number>(activeSaveSlot);
  const [runtimeSaveSlots, setRuntimeSaveSlots] = useState<RuntimeSaveSlotMeta[]>(() => readRuntimeSaveSlotMeta());
  const [runtimePlan, setRuntimePlan] = useState<RuntimeAgentPlan | null>(null);
  const [runtimePlanProgress, setRuntimePlanProgress] = useState(0);
  const [runtimePlanRunning, setRuntimePlanRunning] = useState(false);
  const [runtimePlanEnabledAgents, setRuntimePlanEnabledAgents] = useState<RuntimeAgentPlanEnabledAgents>({});
  const [runtimePlanName, setRuntimePlanName] = useState('No plan loaded');
  const [runtimePlanStatusMessage, setRuntimePlanStatusMessage] = useState('No plan loaded.');
  const [runtimePlanRecording, setRuntimePlanRecording] = useState(false);
  const [runtimePlanRecordingCommandCount, setRuntimePlanRecordingCommandCount] = useState(0);
  const [runtimePlanRecordingAgent, setRuntimePlanRecordingAgent] = useState(RUNTIME_AGENT_PLAN_DEFAULT_AGENT_ID);
  const [runtimePlanStepDelayMs, setRuntimePlanStepDelayMs] = useState(RUNTIME_PLAN_DEFAULT_STEP_DELAY_MS);
  const [runtimePlanLoop, setRuntimePlanLoop] = useState(initialUiSettings.runtimePlanLoop);
  const [runtimePlanExecutionLog, setRuntimePlanExecutionLog] = useState<string[]>([]);
  const [automationEnabled, setAutomationEnabled] = useState<AutomationEnabledState>(INITIAL_AUTOMATION_ENABLED_STATE);
  const [automationStatus, setAutomationStatus] = useState<AutomationStatusState>(EMPTY_AUTOMATION_STATUS_STATE);
  const [shortcutOverlayOpen, setShortcutOverlayOpen] = useState(false);
  const automationEnabledRef = useRef<AutomationEnabledState>(automationEnabled);
  const automationStatusRef = useRef<AutomationStatusState>(automationStatus);
  const automationNextRunRef = useRef<AutomationNextRunState>(EMPTY_AUTOMATION_NEXT_RUN_STATE);
  const hudRef = useRef<HudState>(initialHud);
  if (hudRef.current === null) {
    hudRef.current = initialHud;
  }
  const [hud, setHud] = useState<HudState>(initialHud);
  useEffect(() => {
    activeSaveSlotRef.current = activeSaveSlot;
  }, [activeSaveSlot]);

const setHudState = useCallback(
  (patch: Partial<HudState>): void => {
      const current = hudRef.current ?? initialHud;
      const areItemKindArraysEqual = (left: readonly string[] | undefined, right: readonly string[] | undefined): boolean => {
        if ((left?.length ?? 0) !== (right?.length ?? 0)) {
          return false;
        }

        for (let index = 0; index < (left?.length ?? 0); index += 1) {
          if (left?.[index] !== right?.[index]) {
            return false;
          }
        }

        return true;
      };

      const next: HudState = {
        tool: patch.tool === undefined ? current.tool : patch.tool,
        rotation: patch.rotation === undefined ? current.rotation : patch.rotation,
        paused: patch.paused === undefined ? current.paused : patch.paused,
        tick: patch.tick === undefined ? current.tick : patch.tick,
        fuel: patch.fuel === undefined ? current.fuel : patch.fuel,
        maxFuel: patch.maxFuel === undefined ? current.maxFuel : patch.maxFuel,
        player: patch.player === undefined ? current.player : patch.player,
        inventory: patch.inventory === undefined ? current.inventory : patch.inventory,
        metrics: patch.metrics === undefined ? current.metrics : patch.metrics,
        selectedEntity: patch.selectedEntity === undefined ? current.selectedEntity : patch.selectedEntity,
        adjacentChest: patch.adjacentChest === undefined ? current.adjacentChest : patch.adjacentChest,
        adjacentInteractive:
          patch.adjacentInteractive === undefined ? current.adjacentInteractive : patch.adjacentInteractive,
      };

      if (
        current.tool === next.tool &&
        current.rotation === next.rotation &&
        current.paused === next.paused &&
        current.tick === next.tick &&
        current.fuel === next.fuel &&
        current.maxFuel === next.maxFuel &&
        current.player.x === next.player.x &&
        current.player.y === next.player.y &&
        current.metrics.entityCount === next.metrics.entityCount &&
        current.metrics.miners === next.metrics.miners &&
        current.metrics.belts === next.metrics.belts &&
        current.metrics.inserters === next.metrics.inserters &&
        current.metrics.splitters === next.metrics.splitters &&
        current.metrics.furnaces === next.metrics.furnaces &&
        current.metrics.chests === next.metrics.chests &&
        current.metrics.assemblers === next.metrics.assemblers &&
        current.metrics.solarPanels === next.metrics.solarPanels &&
        current.metrics.accumulators === next.metrics.accumulators &&
        current.metrics.oreInTransit === next.metrics.oreInTransit &&
        current.metrics.platesInTransit === next.metrics.platesInTransit &&
        current.metrics.gearsInTransit === next.metrics.gearsInTransit &&
        current.metrics.coalInTransit === next.metrics.coalInTransit &&
        current.metrics.woodInTransit === next.metrics.woodInTransit &&
        current.metrics.chestOre === next.metrics.chestOre &&
        current.metrics.chestPlates === next.metrics.chestPlates &&
        current.metrics.chestGears === next.metrics.chestGears &&
        current.metrics.chestCoal === next.metrics.chestCoal &&
        current.metrics.chestWood === next.metrics.chestWood &&
        current.metrics.oreRemaining === next.metrics.oreRemaining &&
        current.metrics.coalRemaining === next.metrics.coalRemaining &&
        current.metrics.woodRemaining === next.metrics.woodRemaining &&
        current.metrics.furnacesCrafting === next.metrics.furnacesCrafting &&
        current.metrics.furnacesReady === next.metrics.furnacesReady &&
        current.metrics.powerStorage === next.metrics.powerStorage &&
        current.metrics.powerCapacity === next.metrics.powerCapacity &&
        current.metrics.powerDemandThisTick === next.metrics.powerDemandThisTick &&
        current.metrics.powerConsumedThisTick === next.metrics.powerConsumedThisTick &&
        current.metrics.powerGeneratedThisTick === next.metrics.powerGeneratedThisTick &&
        current.metrics.powerShortagesThisTick === next.metrics.powerShortagesThisTick &&
        current.selectedEntity?.id === next.selectedEntity?.id &&
        current.selectedEntity?.kind === next.selectedEntity?.kind &&
        current.selectedEntity?.x === next.selectedEntity?.x &&
        current.selectedEntity?.y === next.selectedEntity?.y &&
        areItemKindArraysEqual(current.selectedEntity?.canAccept, next.selectedEntity?.canAccept) &&
        areItemKindArraysEqual(current.selectedEntity?.canProvide, next.selectedEntity?.canProvide) &&
        areItemKindArraysEqual(current.selectedEntity?.details, next.selectedEntity?.details) &&
        current.adjacentChest?.id === next.adjacentChest?.id &&
        current.adjacentChest?.x === next.adjacentChest?.x &&
        current.adjacentChest?.y === next.adjacentChest?.y &&
        current.adjacentChest?.inventory.ore === next.adjacentChest?.inventory.ore &&
        current.adjacentChest?.inventory.plate === next.adjacentChest?.inventory.plate &&
        current.adjacentChest?.inventory.gear === next.adjacentChest?.inventory?.gear &&
        current.adjacentChest?.inventory.coal === next.adjacentChest?.inventory?.coal &&
        current.adjacentChest?.inventory.wood === next.adjacentChest?.inventory?.wood &&
        current.adjacentChest?.inventory.used === next.adjacentChest?.inventory.used &&
        current.adjacentChest?.inventory.capacity === next.adjacentChest?.inventory.capacity &&
        current.adjacentChest?.remaining === next.adjacentChest?.remaining &&
        current.adjacentInteractive?.id === next.adjacentInteractive?.id &&
        current.adjacentInteractive?.kind === next.adjacentInteractive?.kind &&
        current.adjacentInteractive?.x === next.adjacentInteractive?.x &&
        current.adjacentInteractive?.y === next.adjacentInteractive?.y &&
        areItemKindArraysEqual(current.adjacentInteractive?.canAccept, next.adjacentInteractive?.canAccept) &&
        areItemKindArraysEqual(current.adjacentInteractive?.canProvide, next.adjacentInteractive?.canProvide) &&
        areItemKindArraysEqual(current.adjacentInteractive?.details, next.adjacentInteractive?.details) &&
        current.inventory.ore === next.inventory.ore &&
        current.inventory.plate === next.inventory.plate &&
        current.inventory.gear === next.inventory.gear &&
        current.inventory.coal === next.inventory.coal &&
        current.inventory.wood === next.inventory.wood &&
        current.inventory.used === next.inventory.used &&
        current.inventory.capacity === next.inventory.capacity
      ) {
        return;
      }

      hudRef.current = next;
      setHud(next);
    },
    [setHud],
  );

  useEffect(() => {
    automationEnabledRef.current = automationEnabled;
  }, [automationEnabled]);

  useEffect(() => {
    cameraAutoFollowRef.current = cameraAutoFollow;
  }, [cameraAutoFollow]);

  useEffect(() => {
    automationStatusRef.current = automationStatus;
  }, [automationStatus]);

  const syncPaletteFromController = useCallback((): void => {
    const controller = controllerRef.current;
    if (!controller) {
      return;
    }

    const state = controller.getState();
    setSelectedKind(state.selectedKind);
    setHudState({
      tool: state.selectedKind,
      rotation: state.rotation,
    });
  }, [setHudState]);

  const resolveRuntimeSimulationForControls = useCallback((): Simulation => {
    if (simulationRef.current !== NOOP_SIMULATION && isSimulation(simulationRef.current)) {
      return simulationRef.current;
    }

    const runtimeFromWindow = typeof window === 'undefined'
      ? undefined
      : (window as { __SIM__?: unknown }).__SIM__;
    if (isSimulation(runtimeFromWindow)) {
      return runtimeFromWindow;
    }
    return NOOP_SIMULATION;
  }, []);

  const syncPauseHudFromSimulation = useCallback((): void => {
    const sim = resolveRuntimeSimulationForControls();
    setHudState({ paused: getSimulationPaused(sim) });
  }, [resolveRuntimeSimulationForControls, setHudState]);

  const setCamera = useCallback((next: Partial<CameraState>): void => {
    const current = cameraRef.current ?? { zoom: CAMERA_DEFAULT_ZOOM, panX: 0, panY: 0 };
    const nextZoom = clampCameraZoom(
      typeof next.zoom === 'number' && Number.isFinite(next.zoom) ? next.zoom : current.zoom,
      current.zoom,
    );
    const nextPanX = typeof next.panX === 'number' && Number.isFinite(next.panX) ? next.panX : current.panX;
    const nextPanY = typeof next.panY === 'number' && Number.isFinite(next.panY) ? next.panY : current.panY;
    const nextCamera: CameraState = {
      zoom: nextZoom,
      panX: Math.round(nextPanX),
      panY: Math.round(nextPanY),
    };
    cameraRef.current = nextCamera;
    window.__CAMERA__ = nextCamera;
    if (rendererRef.current && typeof (rendererRef.current as { setCamera?: (camera: CameraState) => void }).setCamera === 'function') {
      (rendererRef.current as { setCamera: (camera: CameraState) => void }).setCamera(nextCamera);
    }
  }, []);

  const centerCameraOnTile = useCallback((tile: Tile, zoom = cameraRef.current.zoom): void => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const canvasWidth = Math.max(1, Math.floor(canvas.width));
    const canvasHeight = Math.max(1, Math.floor(canvas.height));
    setCamera({
      ...computeCameraPanForTile({
        tile,
        zoom,
        canvasWidth,
        canvasHeight,
      }),
      zoom: clampCameraZoom(zoom, CAMERA_DEFAULT_ZOOM),
    });
  }, [setCamera]);

  const zoomCamera = useCallback((delta: number, anchor: 'player' | 'spawn' = 'player'): void => {
    const player = getSimulationPlayer(simulationRef.current);
    const target: Tile = anchor === 'player' && player !== null
      ? player
      : { x: Math.floor(WORLD_WIDTH / 2), y: Math.floor(WORLD_HEIGHT / 2) };
    const targetZoom = clampCameraZoom(cameraRef.current.zoom + delta, cameraRef.current.zoom);
    centerCameraOnTile(target, targetZoom);
  }, [centerCameraOnTile]);

  const setCameraToPlayer = useCallback((): void => {
    const player = getSimulationPlayer(simulationRef.current);
    if (player === null) {
      return;
    }
    centerCameraOnTile(player, cameraRef.current.zoom);
  }, [centerCameraOnTile]);

  const setCameraToSpawn = useCallback((): void => {
    centerCameraOnTile(
      { x: Math.floor(WORLD_WIDTH / 2), y: Math.floor(WORLD_HEIGHT / 2) },
      CAMERA_DEFAULT_ZOOM,
    );
  }, [centerCameraOnTile]);

  const syncMinimapFromSimulation = useCallback((): void => {
    const sim = simulationRef.current;
    const map = (sim as { getMap?: () => unknown }).getMap?.();
    const rawGetAllEntities = (sim as { getAllEntities?: () => unknown[] }).getAllEntities;
    const entities = typeof rawGetAllEntities === 'function' ? rawGetAllEntities.call(sim) : [];
    const minimapCanvas = minimapCanvasRef.current;
    if (!minimapCanvas) {
      return;
    }
    const ctx = minimapCanvas.getContext('2d');
    if (ctx === null) {
      return;
    }

    const minimapRect = minimapCanvas.getBoundingClientRect();
    if (!Number.isFinite(minimapRect.width) || !Number.isFinite(minimapRect.height) || minimapRect.width <= 0 || minimapRect.height <= 0) {
      return;
    }

    const devicePixelRatio = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.floor(minimapRect.width);
    const height = Math.floor(minimapRect.height);
    const backingWidth = Math.max(1, Math.floor(width * devicePixelRatio));
    const backingHeight = Math.max(1, Math.floor(height * devicePixelRatio));

    if (minimapCanvas.width !== backingWidth || minimapCanvas.height !== backingHeight) {
      minimapCanvas.width = backingWidth;
      minimapCanvas.height = backingHeight;
    }

    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const player = getSimulationPlayer(sim);
    const getTile = map === null || map === undefined
      ? undefined
      : (map as { getTile?: (x: number, y: number) => unknown }).getTile;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return;
    }

    const tileWidth = width / WORLD_WIDTH;
    const tileHeight = height / WORLD_HEIGHT;
    const playerX = player === null ? -1 : player.x;
    const playerY = player === null ? -1 : player.y;
    const visibleWidth = Math.max(1, tileWidth);
    const visibleHeight = Math.max(1, tileHeight);

    for (let y = 0; y < WORLD_HEIGHT; y += 1) {
      for (let x = 0; x < WORLD_WIDTH; x += 1) {
        let fill = MINIMAP_COLORS.empty;
        if (typeof getTile === 'function') {
          const tile = getTile(x, y);
          if (tile === 'iron-ore') {
            fill = MINIMAP_COLORS.ore;
          } else if (tile === 'coal-ore') {
            fill = MINIMAP_COLORS.coal;
          } else if (tile === 'tree') {
            fill = MINIMAP_COLORS.tree;
          }
        }

        ctx.fillStyle = fill;
        ctx.fillRect(
          Math.round(x * tileWidth),
          Math.round(y * tileHeight),
          Math.max(1, Math.round(visibleWidth)),
          Math.max(1, Math.round(visibleHeight)),
        );
      }
    }

    if (Array.isArray(entities)) {
      for (const rawEntity of entities) {
        if (!isRecord(rawEntity) || typeof rawEntity.kind !== 'string' || !isRecord(rawEntity.pos)) {
          continue;
        }
        const rawKind = rawEntity.kind;
        const rawX = toInt(rawEntity.pos.x);
        const rawY = toInt(rawEntity.pos.y);
        if (rawX === null || rawY === null) {
          continue;
        }
        if (rawX < 0 || rawY < 0 || rawX >= WORLD_WIDTH || rawY >= WORLD_HEIGHT) {
          continue;
        }
        const kind = rawKind as RuntimeEntityKind;
        const color = MINIMAP_COLORS.entities[kind] ?? '#ffffff';
        const insetX = Math.max(0.3, tileWidth * 0.22);
        const insetY = Math.max(0.3, tileHeight * 0.22);

        ctx.fillStyle = color;
        ctx.fillRect(
          Math.round(rawX * tileWidth + insetX),
          Math.round(rawY * tileHeight + insetY),
          Math.max(1, Math.round(tileWidth - insetX * 2)),
          Math.max(1, Math.round(tileHeight - insetY * 2)),
        );
      }
    }

    if (playerX >= 0 && playerY >= 0) {
      const centerX = (playerX + 0.5) * tileWidth;
      const centerY = (playerY + 0.5) * tileHeight;
      const radius = Math.max(1.1, Math.min(tileWidth, tileHeight) * 0.45);
      ctx.fillStyle = MINIMAP_COLORS.player;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1, Math.min(tileWidth, tileHeight) * 0.15);
      ctx.stroke();
    }

    const worldPixelWidth = WORLD_WIDTH * TILE_SIZE;
    const worldPixelHeight = WORLD_HEIGHT * TILE_SIZE;
    const normalizedZoom = clampCameraZoom(cameraRef.current.zoom, CAMERA_DEFAULT_ZOOM);
    const baseScale = Math.max(0.0001, Math.min(width / worldPixelWidth, height / worldPixelHeight));
    const tileSpan = TILE_SIZE * baseScale * normalizedZoom;
    const viewOffsetX = Math.floor((width - worldPixelWidth * baseScale) / 2) + cameraRef.current.panX;
    const viewOffsetY = Math.floor((height - worldPixelHeight * baseScale) / 2) + cameraRef.current.panY;

    if (tileSpan > 0) {
      const viewLeftTile = Math.max(0, Math.min(WORLD_WIDTH, -viewOffsetX / tileSpan));
      const viewRightTile = Math.max(0, Math.min(WORLD_WIDTH, (width - viewOffsetX) / tileSpan));
      const viewTopTile = Math.max(0, Math.min(WORLD_HEIGHT, -viewOffsetY / tileSpan));
      const viewBottomTile = Math.max(0, Math.min(WORLD_HEIGHT, (height - viewOffsetY) / tileSpan));

      const x = Math.floor(viewLeftTile * tileWidth);
      const y = Math.floor(viewTopTile * tileHeight);
      const w = Math.max(1, Math.floor((viewRightTile - viewLeftTile) * tileWidth));
      const h = Math.max(1, Math.floor((viewBottomTile - viewTopTile) * tileHeight));
      if (w > 0 && h > 0) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 1.25;
        ctx.strokeRect(
          Math.max(0, Math.min(width - 1, x)) + 0.5,
          Math.max(0, Math.min(height - 1, y)) + 0.5,
          Math.max(1, Math.min(width - 1, w)),
          Math.max(1, Math.min(height - 1, h)),
        );
      }
    }
  }, []);

  const markTutorialMissionComplete = useCallback((missionId: TutorialMissionId): void => {
    setTutorialMissions((current) => {
      const index = current.findIndex((mission) => mission.id === missionId);
      if (index === -1 || current[index].completed) {
        return current;
      }

      const missionIndex = TUTORIAL_MISSION_ORDER.indexOf(missionId);
      if (missionIndex < 0) {
        return current;
      }

      for (let beforeIndex = 0; beforeIndex < missionIndex; beforeIndex += 1) {
        const requiredId = TUTORIAL_MISSION_ORDER[beforeIndex];
        const requiredMission = current.find((mission) => mission.id === requiredId);
        if (requiredMission === undefined || requiredMission.completed !== true) {
          return current;
        }
      }

      const next = current.slice();
      next[index] = {
        ...next[index],
        completed: true,
        completedAtTick: hudRef.current?.tick,
      };
      return next;
    });
  }, []);

  const refreshTutorialMissionsFromState = useCallback((options?: {
    player?: Tile | null;
    metrics?: RuntimeMetrics | null;
  }): void => {
    const sim = simulationRef.current;
    const player = options?.player ?? getSimulationPlayer(sim);
    const metrics = options?.metrics ?? getSimulationMetrics(sim);
    const baseline = tutorialMissionBaselineRef.current;

    if (baseline === null && player !== null && metrics !== null) {
      tutorialMissionBaselineRef.current = {
        player: {
          x: player.x,
          y: player.y,
        },
        metrics: {
          ...metrics,
        },
      };
    }

    if (player !== null && tutorialMoveOriginRef.current === null) {
      tutorialMoveOriginRef.current = {
        x: player.x,
        y: player.y,
      };
    }

    if (player !== null && tutorialMoveOriginRef.current !== null) {
      if (player.x !== tutorialMoveOriginRef.current.x || player.y !== tutorialMoveOriginRef.current.y) {
        markTutorialMissionComplete('move-player');
      }
    }

    if (metrics !== null && baseline !== null) {
      if (metrics.miners > baseline.metrics.miners) {
        markTutorialMissionComplete('place-miner');
      }
      if (metrics.belts > baseline.metrics.belts) {
        markTutorialMissionComplete('place-belt');
      }
      if (metrics.chests > baseline.metrics.chests) {
        markTutorialMissionComplete('place-chest');
      }
      if (
        metrics.oreRemaining < baseline.metrics.oreRemaining
        || metrics.coalRemaining < baseline.metrics.coalRemaining
        || metrics.woodRemaining < baseline.metrics.woodRemaining
      ) {
        markTutorialMissionComplete('mine-resource');
      }

      if (
        metrics.solarPanels > baseline.metrics.solarPanels
        || metrics.accumulators > baseline.metrics.accumulators
      ) {
        markTutorialMissionComplete('build-power');
      }

      if (
        metrics.powerGeneratedTotal > baseline.metrics.powerGeneratedTotal
        && metrics.powerShortagesThisTick === 0
      ) {
        markTutorialMissionComplete('sustain-power');
      }
    }
  }, [markTutorialMissionComplete]);

  const syncHudFromSimulation = useCallback((options: HudSyncOptions = {}): void => {
    const sim = simulationRef.current;
    if (!sim) {
      return;
    }

    const includeMinimap = options.includeMinimap === true;
    const includeMetrics = options.includeMetrics !== false;
    const includeFuel = options.includeFuel !== false;
    const includePlayer = options.includePlayer !== false;
    const includeInventory = options.includeInventory !== false;
    const includeAdjacent = options.includeAdjacent !== false;

    const nextTick = getSimulationTick(sim);
    const nextPaused = getSimulationPaused(sim);
    const nextFuel = includeFuel ? getSimulationFuel(sim) : null;
    const nextPlayer = includePlayer ? getSimulationPlayer(sim) : null;
    const nextMetrics = includeMetrics ? getSimulationMetrics(sim) : null;
    const nextAdjacentChest = includeAdjacent ? getAdjacentChestSnapshot(sim, nextPlayer) : null;
    const nextAdjacentInteractive = includeAdjacent ? getAdjacentInteractiveSnapshot(sim, nextPlayer) : null;
    const nextSelectedEntity = refreshSelectedEntitySnapshot(sim, hudRef.current?.selectedEntity ?? null);
    const getInventory = includeInventory
      ? (sim as { getInventorySnapshot?: () => PlacementSnapshot['inventory'] }).getInventorySnapshot
      : undefined;
    const nextInventory = typeof getInventory === 'function' ? getInventory.call(sim) : null;

    const nextHudState: Partial<HudState> = {
      tick: nextTick,
      paused: nextPaused,
    };

    if (cameraAutoFollowRef.current && nextPlayer !== null) {
      centerCameraOnTile(nextPlayer, cameraRef.current.zoom);
    }

    if (nextFuel !== null) {
      nextHudState.fuel = nextFuel.fuel;
      nextHudState.maxFuel = nextFuel.maxFuel;
    }

    if (nextPlayer !== null) {
      nextHudState.player = nextPlayer;
    }

    if (nextMetrics !== null) {
      nextHudState.metrics = nextMetrics;
    }

    if (nextInventory !== null) {
      nextHudState.inventory = nextInventory;
    }

    if (includeAdjacent) {
      nextHudState.adjacentChest = nextAdjacentChest;
      nextHudState.adjacentInteractive = nextAdjacentInteractive;
    }

    if (nextSelectedEntity !== null) {
      nextHudState.selectedEntity = nextSelectedEntity;
    } else {
      nextHudState.selectedEntity = null;
    }

    if (includeMinimap) {
      syncMinimapFromSimulation();
    }

    refreshTutorialMissionsFromState({
      player: nextPlayer,
      metrics: nextMetrics,
    });
    setHudState(nextHudState);
  }, [centerCameraOnTile, refreshTutorialMissionsFromState, setHudState, syncMinimapFromSimulation]);

  const togglePauseFromControls = useCallback((): boolean => {
    const sim = resolveRuntimeSimulationForControls();
    const wasPaused = getSimulationPaused(sim);
    sim.togglePause?.();
    const nextPaused = getSimulationPaused(sim);
    setHudState({ paused: nextPaused });
    syncHudFromSimulation();
    requestAnimationFrame(() => {
      syncPauseHudFromSimulation();
      syncHudFromSimulation();
    });
    return wasPaused;
  }, [resolveRuntimeSimulationForControls, setHudState, syncHudFromSimulation, syncPauseHudFromSimulation]);

  const runAutomation = useCallback((): void => {
    if (!automationEnabledRef.current.autoRefuel && !automationEnabledRef.current.autoPickup && !automationEnabledRef.current.autoDeposit) {
      return;
    }

    const sim = simulationRef.current as RuntimeSimulation;
    if (typeof sim.refuel !== 'function' && typeof sim.pickupItem !== 'function' && typeof sim.depositItem !== 'function') {
      return;
    }

    const now = window.performance.now();
    const nextRun = { ...automationNextRunRef.current };
    const nextStatus: AutomationStatusState = { ...automationStatusRef.current };
    let changed = false;

    const updateStatus = (id: AutomationAgentId, value: string): void => {
      if (nextStatus[id] === value) {
        return;
      }
      nextStatus[id] = value;
      changed = true;
    };

    const maybeExecute = (
      agentId: AutomationAgentId,
      run: () => CoreActionOutcome | null | undefined,
      fallbackStatus = 'idle',
      guard?: () => boolean,
    ): void => {
      if (!automationEnabledRef.current[agentId]) {
        return;
      }

      if (now < (nextRun[agentId] ?? 0)) {
        return;
      }

      const agentConfig = AUTOMATION_AGENTS.find((agent) => agent.id === agentId);
      if (agentConfig === undefined) {
        return;
      }
      nextRun[agentId] = now + agentConfig.cooldownMs;

      if (typeof guard === 'function' && guard() !== true) {
        updateStatus(agentId, fallbackStatus);
        return;
      }

      const outcome = run();
      if (outcome === null || outcome === undefined || outcome.ok !== true) {
        const fallbackReason = String(outcome?.reason ?? outcome?.reasonCode ?? 'blocked');
        updateStatus(agentId, fallbackReason);
        return;
      }

      updateStatus(agentId, 'ok');
    };

    const fuelState = getSimulationFuel(sim);
    const autoRefuelReady =
      fuelState !== null && fuelState.fuel < Math.floor(fuelState.maxFuel * AUTO_REFUEL_TRIGGER_RATIO);

    maybeExecute(
      'auto-refuel',
      () => sim.refuel(),
      'need_fuel',
      () => autoRefuelReady,
    );

    maybeExecute(
      'auto-pickup',
      () => sim.pickupItem(),
      'nothing_near',
    );

    maybeExecute(
      'auto-deposit',
      () => sim.depositItem(),
      'nothing_near',
    );

    automationNextRunRef.current = nextRun;
    if (changed) {
      automationStatusRef.current = nextStatus;
      setAutomationStatus(nextStatus);
    }
  }, [setAutomationStatus]);

  const refreshRuntimeSaveSlots = useCallback((): void => {
    setRuntimeSaveSlots(readRuntimeSaveSlotMeta());
  }, []);

  const syncGhostFromController = useCallback((): void => {
    const controller = controllerRef.current;
    const renderer = rendererRef.current;

    if (!controller || !renderer) {
      return;
    }

    const ghost = controller.getGhost();
    renderer.setGhost(ghost.tile, ghost.valid);
  }, []);

  const runMinimapNavigate = useCallback((event: { clientX: number; clientY: number }): void => {
    const minimapCanvas = minimapCanvasRef.current;
    if (!minimapCanvas) {
      return;
    }

    const rect = minimapCanvas.getBoundingClientRect();
    const tile = minimapPointToTile({
      point: {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      },
      minimapWidth: rect.width,
      minimapHeight: rect.height,
      worldWidth: WORLD_WIDTH,
      worldHeight: WORLD_HEIGHT,
    });
    if (tile === null) {
      return;
    }

    centerCameraOnTile(tile, cameraRef.current.zoom);
  }, [centerCameraOnTile]);

  const setFeedbackMessage = useCallback((nextFeedback: Feedback | null): void => {
    if (feedbackTimeoutRef.current !== null) {
      window.clearTimeout(feedbackTimeoutRef.current);
      feedbackTimeoutRef.current = null;
    }

    if (nextFeedback === null) {
      setFeedback(null);
      return;
    }

    setFeedback(nextFeedback);
    feedbackTimeoutRef.current = window.setTimeout((): void => {
      setFeedback(null);
      feedbackTimeoutRef.current = null;
    }, 1400);
  }, []);

  useEffect(() => {
    writeUiSettingsToStorage({
      showHud,
      reducedMotion: reducedMotionEnabled,
      showSvgs: useSvgs,
      showTutorialHints,
      runtimePlanLoop,
    });
  }, [showHud, reducedMotionEnabled, showTutorialHints, useSvgs, runtimePlanLoop]);

  useEffect(() => {
    setShowTouchControls(detectCoarsePointer());
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const queries = [
      window.matchMedia('(pointer: coarse)'),
      window.matchMedia('(hover: none)'),
    ];
    const recompute = (): void => {
      setShowTouchControls(detectCoarsePointer());
    };

    const add = (media: MediaQueryList): void => {
      if (typeof media.addEventListener === 'function') {
        media.addEventListener('change', recompute);
        return;
      }
      if (typeof media.addListener === 'function') {
        media.addListener(recompute);
      }
    };

    const remove = (media: MediaQueryList): void => {
      if (typeof media.removeEventListener === 'function') {
        media.removeEventListener('change', recompute);
        return;
      }
      if (typeof media.removeListener === 'function') {
        media.removeListener(recompute);
      }
    };

    queries.forEach(add);

    return () => {
      queries.forEach(remove);
    };
  }, []);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (renderer === null) {
      return;
    }

    window.__USE_SVGS__ = useSvgs;
    if (useSvgs) {
      preloadRendererSvgs();
    }
    const setReducedMotion = renderer.setReducedMotionEnabled;
    if (typeof setReducedMotion === 'function') {
      setReducedMotion(reducedMotionEnabled);
    }
    if (typeof renderer.requestRender === 'function') {
      renderer.requestRender();
    }
  }, [useSvgs, reducedMotionEnabled]);

  const executeShortcutOverlayAction = (actionId: string): void => {
    const sim = simulationRef.current;
    const controller = controllerRef.current;
    if (controller === null) {
      return;
    }

    if (actionId === 'toggle-pause') {
      const wasPaused = togglePauseFromControls();
      setFeedbackMessage({
        kind: 'success',
        message: wasPaused ? 'Simulation resumed.' : 'Simulation paused.',
      });
      return;
    }

    if (actionId === 'step-1' || actionId === 'step-10') {
      const steps = actionId === 'step-1' ? 1 : 10;
      const runtime = sim as unknown as RuntimeSimulation;
      const outcome = runtime.stepTicks?.(steps);
      if (outcome?.ok) {
        setFeedbackMessage({
          kind: 'success',
          message: `Advanced ${steps} tick${steps === 1 ? '' : 's'}.`,
        });
      } else {
        setFeedbackMessage({
          kind: 'error',
          message: outcome?.reason ?? 'Unable to step simulation.',
        });
      }
      syncHudFromSimulation();
      return;
    }

    if (actionId === 'clear-tool') {
      clearSelectedTool();
      syncHudFromSimulation();
      return;
    }

    if (actionId === 'mine') {
      runMineInFrontOfPlayer();
      return;
    }

    if (actionId === 'center-player') {
      setCameraToPlayer();
      setFeedbackMessage({
        kind: 'success',
        message: 'Camera centered on player.',
      });
      return;
    }

    if (actionId === 'toggle-auto-follow') {
      const next = !cameraAutoFollowRef.current;
      cameraAutoFollowRef.current = next;
      setCameraAutoFollow(next);
      setFeedbackMessage({
        kind: 'success',
        message: next ? 'Auto-follow enabled.' : 'Auto-follow disabled.',
      });
      return;
    }

    if (actionId === 'toggle-svgs') {
      const next = !useSvgs;
      window.__USE_SVGS__ = next;
      setUseSvgs(next);
      setFeedbackMessage({
        kind: 'success',
        message: next ? 'SVG rendering enabled.' : 'SVG rendering disabled.',
      });
      return;
    }

    if (actionId === 'toggle-hud') {
      setShowHud((current) => {
        const next = !current;
        setFeedbackMessage({
          kind: 'success',
          message: next ? 'HUD shown.' : 'HUD hidden.',
        });
        return next;
      });
      return;
    }

    if (actionId === 'toggle-reduced-motion') {
      setReducedMotionEnabled((current) => {
        setFeedbackMessage({
          kind: 'success',
          message: current ? 'Reduced motion disabled.' : 'Reduced motion enabled.',
        });
        return !current;
      });
    }

    if (actionId === 'plan-start') {
      startRuntimeAgentPlan();
      return;
    }

    if (actionId === 'plan-step') {
      runRuntimeAgentPlanStep();
      return;
    }

    if (actionId === 'plan-stop') {
      stopRuntimeAgentPlan();
      return;
    }

    if (actionId === 'save-copy') {
      void copyRuntimeSaveToClipboard();
      return;
    }

    if (actionId === 'save-paste') {
      void pasteRuntimeSaveFromClipboard();
      return;
    }

    if (actionId === 'blueprint-copy') {
      void copyRuntimeBlueprintToClipboard();
      return;
    }

    if (actionId === 'blueprint-paste') {
      void pasteRuntimeBlueprintFromClipboard();
      return;
    }

    if (actionId === 'save-share-link') {
      void copyRuntimeSaveShareLink();
      return;
    }

    if (actionId === 'blueprint-share-link') {
      void copyRuntimeBlueprintShareLink();
      return;
    }

    if (actionId === 'save-share-link-paste') {
      void pasteRuntimeSaveShareLinkFromClipboard();
      return;
    }

    if (actionId === 'blueprint-share-link-paste') {
      void pasteRuntimeBlueprintShareLinkFromClipboard();
      return;
    }
  };

  const resolveRuntimePlanRecordingAgent = useCallback((): string => {
    const normalized = normalizeRuntimeAgentPlanCommandAgent(runtimePlanRecordingAgentRef.current);
    return normalized === undefined ? RUNTIME_AGENT_PLAN_DEFAULT_AGENT_ID : normalized;
  }, []);

  const appendRuntimePlanRecordingCommand = useCallback((command: RuntimeAgentPlanCommand): void => {
    if (!runtimePlanRecordingRef.current || runtimePlanRunningRef.current) {
      return;
    }

    if (runtimePlanRecordingCommandsRef.current.length >= MAX_RUNTIME_AGENT_PLAN_COMMANDS) {
      stopRuntimePlanRecording();
      setFeedbackMessage({
        kind: 'error',
        message: `Recording stopped: command limit reached (${MAX_RUNTIME_AGENT_PLAN_COMMANDS}).`,
      });
      return;
    }

    const nextCommand = (() => {
      const agent = resolveRuntimePlanRecordingAgent();
      if (agent === RUNTIME_AGENT_PLAN_DEFAULT_AGENT_ID) {
        return command;
      }

      return {
        ...command,
        agent,
      } as RuntimeAgentPlanCommand;
    })();

    runtimePlanRecordingCommandsRef.current = runtimePlanRecordingCommandsRef.current.concat(nextCommand);
    setRuntimePlanRecordingCommandCount((current) => current + 1);
  }, [resolveRuntimePlanRecordingAgent, setFeedbackMessage]);

  const handleRuntimePlanRecordingAgentChange = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    const nextAgent = normalizeRuntimeAgentPlanCommandAgent(event.target.value);
    const resolvedAgent = nextAgent === undefined ? RUNTIME_AGENT_PLAN_DEFAULT_AGENT_ID : nextAgent;
    setRuntimePlanRecordingAgent(resolvedAgent);
    runtimePlanRecordingAgentRef.current = resolvedAgent;
  }, []);

  const startRuntimePlanRecording = useCallback((): void => {
    if (runtimePlanRunningRef.current) {
      setFeedbackMessage({
        kind: 'error',
        message: 'Stop plan execution before recording.',
      });
      return;
    }

    runtimePlanRecordingAgentRef.current = resolveRuntimePlanRecordingAgent();
    setRuntimePlanRecordingAgent(runtimePlanRecordingAgentRef.current);

    runtimePlanRecordingRef.current = true;
    runtimePlanRecordingCommandsRef.current = [];
    setRuntimePlanRecordingCommandCount(0);
    setRuntimePlanRecording(true);
    setFeedbackMessage({
      kind: 'success',
      message: 'Runtime plan recording started.',
    });
  }, [resolveRuntimePlanRecordingAgent, setFeedbackMessage]);

  const stopRuntimePlanRecording = useCallback((): void => {
    if (!runtimePlanRecordingRef.current) {
      return;
    }

    runtimePlanRecordingRef.current = false;
    setRuntimePlanRecording(false);

    const commands = runtimePlanRecordingCommandsRef.current;
    const recordedPlan: RuntimeAgentPlan = {
      version: 1,
      name: `Recorded plan`,
      commands,
    };

    runtimePlanRecordingCommandsRef.current = [];
    setRuntimePlanRecordingCommandCount(0);
    const enabledAgents = createDefaultRuntimePlanEnabledAgentsState(recordedPlan);
    hydrateRuntimePlan(recordedPlan, enabledAgents);
    const saved = writeRuntimeAgentPlanStoragePayload(recordedPlan, enabledAgents);
    if (!saved) {
      setFeedbackMessage({
        kind: 'error',
        message: 'Unable to persist recorded plan.',
      });
      return;
    }

    setFeedbackMessage({
      kind: 'success',
      message: `Recorded ${commands.length} commands into runtime plan.`,
    });
  }, [setFeedbackMessage]);

  const toggleRuntimePlanRecording = useCallback((): void => {
    if (runtimePlanRecording) {
      stopRuntimePlanRecording();
      return;
    }
    startRuntimePlanRecording();
  }, [runtimePlanRecording, startRuntimePlanRecording, stopRuntimePlanRecording]);

  const rotateRuntimeTool = useCallback((): void => {
    const controller = controllerRef.current;
    if (controller === null) {
      return;
    }
    controller.rotate();
    appendRuntimePlanRecordingCommand({
      type: 'rotate',
      steps: 1,
    });
    syncPaletteFromController();
    syncGhostFromController();
  }, [appendRuntimePlanRecordingCommand, syncGhostFromController, syncPaletteFromController]);

  const movePlayerFromDirection = useCallback((direction: RuntimeDirection): void => {
    const mover = simulationRef.current as { movePlayer?: (direction: RuntimeDirection) => CoreActionOutcome };
    const movePlayerFn = mover.movePlayer;
    if (typeof movePlayerFn !== 'function') {
      return;
    }

    const outcome = movePlayerFn(direction);
    if (outcome?.ok) {
      markTutorialMissionComplete('move-player');
      syncHudFromSimulation({
        includeMinimap: false,
        includeMetrics: false,
        includeInventory: false,
        includeAdjacent: false,
      });
      appendRuntimePlanRecordingCommand({
        type: 'move',
        direction,
      });
    } else {
      const reason = String(outcome?.reason ?? outcome?.reasonCode ?? 'blocked');
      const readableReason = typeof outcome?.reason === 'string' ? outcome.reason : '';
      setFeedbackMessage({
        kind: 'error',
        message:
          reason === 'no_fuel'
            ? 'Movement blocked: no fuel.'
            : reason === 'out_of_bounds'
              ? 'Movement blocked: world edge.'
              : readableReason.startsWith('Movement blocked:')
                ? readableReason
                : reason === 'occupied'
                  ? 'Movement blocked: tile occupied.'
                  : 'Movement blocked.',
      });
    }
  }, [appendRuntimePlanRecordingCommand, markTutorialMissionComplete, setFeedbackMessage, syncHudFromSimulation]);

  const toggleToolKind = useCallback((nextKind: EntityKind, allowClear = true): void => {
    const controller = controllerRef.current;
    if (controller === null) {
      return;
    }

    const currentKind = controller.getState().selectedKind;
    const requestedKind = allowClear && currentKind === nextKind ? null : nextKind;
    controller.selectKind(requestedKind);
    syncPaletteFromController();
    syncGhostFromController();
    if (requestedKind === null) {
      setFeedbackMessage({
        kind: 'success',
        message: 'Tool cleared.',
      });
    } else {
      markTutorialMissionComplete('select-tool');
    }
  }, [markTutorialMissionComplete, setFeedbackMessage, syncGhostFromController, syncPaletteFromController]);

  const clearSelectedTool = useCallback((): void => {
    const controller = controllerRef.current;
    if (controller === null) {
      return;
    }
    controller.selectKind(null);
    syncPaletteFromController();
    syncGhostFromController();
    setFeedbackMessage({
      kind: 'success',
      message: 'Tool cleared.',
    });
  }, [setFeedbackMessage, syncGhostFromController, syncPaletteFromController]);

  const runTouchRotate = useCallback((): void => {
    rotateRuntimeTool();
  }, [rotateRuntimeTool]);

  const runTouchClear = useCallback((): void => {
    clearSelectedTool();
  }, [clearSelectedTool]);

  const runMineAtTile = useCallback((tile: Tile | null): void => {
    const sim = simulationRef.current as RuntimeSimulation;
    if (tile === null) {
      setFeedbackMessage({
        kind: 'error',
        message: 'No tile targeted for mining.',
      });
      syncPaletteFromController();
      syncGhostFromController();
      syncHudFromSimulation();
      return;
    }

    const player = getSimulationPlayer(sim);
    const isAdjacent = player ? isAdjacentTile(player, tile) : false;
    if (!isAdjacent) {
      setFeedbackMessage({
        kind: 'error',
        message: player === null
          ? 'Unable to resolve player position for mining.'
          : 'Target must be adjacent to the player.',
      });
      syncPaletteFromController();
      syncGhostFromController();
      syncHudFromSimulation();
      return;
    }

    const withMining = sim as { mineResourceAtTile?: (tile: Tile) => CoreActionOutcome };
    const mineOutcome = withMining.mineResourceAtTile?.(tile);
    if (mineOutcome?.ok) {
      const runtimeMap = typeof (sim as { getMap?: () => ReturnType<typeof createMap> }).getMap === 'function'
        ? (sim as { getMap: () => ReturnType<typeof createMap> }).getMap()
        : null;
      const minedTile = runtimeMap && typeof runtimeMap.getTile === 'function'
        ? runtimeMap.getTile(tile.x, tile.y)
        : null;
      const resourceSummary = runtimeMap === null
        ? null
        : getCursorResourceSummary(runtimeMap, tile);

      if (resourceSummary !== null || minedTile === 'iron-ore' || minedTile === 'coal-ore' || minedTile === 'tree') {
        markTutorialMissionComplete('mine-resource');
      }

      const remainingText = resourceSummary === null || !resourceSummary.remainingKnown || resourceSummary.remaining < 0
        ? ''
        : ` remaining ${resourceSummary.remaining}`;
      const minedMessage = mineOutcome.reason === undefined
        ? `Mined resource at (${tile.x}, ${tile.y}).`
        : mineOutcome.reason;
      const minedMessageHasRemaining = /\bremaining\s+\d+/i.test(minedMessage);
      const minedMessageWithRemaining = remainingText.length > 0 && !minedMessageHasRemaining
        ? `${minedMessage} (${remainingText}).`
        : minedMessage;

      appendRuntimePlanRecordingCommand({
        type: 'interact',
        action: 'pickup',
        x: tile.x,
        y: tile.y,
      });
      appendRuntimeHistorySnapshot();
      setFeedbackMessage({
        kind: 'success',
        message: minedMessageWithRemaining,
      });
      syncPaletteFromController();
      syncGhostFromController();
      syncHudFromSimulation();
      return;
    }

    if (mineOutcome !== null && mineOutcome !== undefined) {
      setFeedbackMessage({
        kind: 'error',
        message: String(mineOutcome.reason ?? mineOutcome.reasonCode ?? 'Cannot mine this tile.'),
      });
      syncPaletteFromController();
      syncGhostFromController();
      syncHudFromSimulation();
      return;
    }

    setFeedbackMessage({
      kind: 'error',
      message: 'No mineable resource here.',
    });
    syncPaletteFromController();
    syncGhostFromController();
    syncHudFromSimulation();
  }, [appendRuntimePlanRecordingCommand, markTutorialMissionComplete, syncGhostFromController, syncHudFromSimulation, syncPaletteFromController, setFeedbackMessage]);

  const runMineInFrontOfPlayer = useCallback((): void => {
    const sim = simulationRef.current as RuntimeSimulation;
    const player = getSimulationPlayer(sim);
    if (player === null) {
      setFeedbackMessage({
        kind: 'error',
        message: 'Unable to resolve player position.',
      });
      return;
    }

    const direction = getSimulationPlayerDirection(sim) ?? 'S';
    const delta = DIRECTION_TO_DELTA[direction];
    const tile: Tile = {
      x: player.x + delta.x,
      y: player.y + delta.y,
    };

    runMineAtTile(tile);
  }, [runMineAtTile, setFeedbackMessage]);

  const runTouchMine = useCallback((): void => {
    const controller = controllerRef.current;
    const tile = controller?.getState().cursor ?? null;
    if (tile === null) {
      runMineInFrontOfPlayer();
      return;
    }
    runMineAtTile(tile);
  }, [runMineAtTile, runMineInFrontOfPlayer]);

  const captureRuntimeHistorySnapshot = useCallback((): RuntimeSaveState | null => {
    const runtime = simulationRef.current as RuntimeSimulation;
    const saveState = (runtime as { saveState?: () => unknown }).saveState;
    if (typeof saveState !== 'function') {
      return null;
    }

    const snapshot = saveState.call(runtime) as unknown;
    if (!isRecord(snapshot) || !isRecord(snapshot.player) || !isRecord(snapshot.inventory) || !Array.isArray(snapshot.entities)) {
      return null;
    }

    return cloneRuntimeStateDeep(snapshot as RuntimeSaveState);
  }, []);

  const replaceHistoryWithCurrentState = useCallback((): void => {
    const snapshot = captureRuntimeHistorySnapshot();
    if (snapshot === null) {
      return;
    }

    runtimeHistoryRef.current = [snapshot];
    runtimeHistoryCursorRef.current = 0;
  }, [captureRuntimeHistorySnapshot]);

  const appendRuntimeHistorySnapshot = useCallback((): void => {
    const snapshot = captureRuntimeHistorySnapshot();
    if (snapshot === null) {
      return;
    }

    const cursor = runtimeHistoryCursorRef.current;
    const current = runtimeHistoryRef.current;
    const baseHistory = cursor >= 0 && cursor < current.length - 1
      ? current.slice(0, cursor + 1)
      : current;
    baseHistory.push(snapshot);

    const trimmedHistory = baseHistory.length > RUNTIME_HISTORY_LIMIT
      ? baseHistory.slice(baseHistory.length - RUNTIME_HISTORY_LIMIT)
      : baseHistory;
    runtimeHistoryRef.current = trimmedHistory;
    runtimeHistoryCursorRef.current = trimmedHistory.length - 1;
  }, [captureRuntimeHistorySnapshot]);

  const captureRuntimeCheckpoint = useCallback((reason: string): RuntimeNormalizedCheckpoint | null => {
    const snapshot = captureRuntimeHistorySnapshot();
    if (snapshot === null) {
      return null;
    }

    const normalizedReason = reason.trim().length > 0 ? reason.trim() : 'manual';
    return {
      tick: snapshot.tick,
      createdAt: new Date().toISOString(),
      createdAtTime: Date.now(),
      reason: normalizedReason,
      state: snapshot,
    };
  }, [captureRuntimeHistorySnapshot]);

  const addRuntimeCheckpoint = useCallback((reason: string): void => {
    const checkpoint = captureRuntimeCheckpoint(reason);
    if (checkpoint === null) {
      setFeedbackMessage({
        kind: 'error',
        message: 'Unable to capture checkpoint.',
      });
      return;
    }

    setRuntimeCheckpoints((current) => {
      const filtered = current.filter((entry) => entry.createdAt !== checkpoint.createdAt || entry.tick !== checkpoint.tick);
      const merged = [checkpoint, ...filtered].sort(compareRuntimeCheckpointsNewestFirst);
      const next = merged.slice(0, RUNTIME_CHECKPOINT_LIMIT);
      const persisted = writeRuntimeCheckpointsToStorage(next);
      if (!persisted) {
        setFeedbackMessage({
          kind: 'error',
          message: 'Unable to persist runtime checkpoint.',
        });
      } else {
        setFeedbackMessage({
          kind: 'success',
          message: `Checkpoint captured: ${checkpoint.reason}.`,
        });
      }
      return next;
    });
  }, [captureRuntimeCheckpoint, setFeedbackMessage]);

  const restoreRuntimeCheckpoint = useCallback((checkpoint: RuntimeNormalizedCheckpoint): CoreActionOutcome => {
    const runtime = simulationRef.current as RuntimeSimulation;
    const loadState = (runtime as { loadState?: (payload: unknown) => CoreActionOutcome }).loadState;
    if (typeof loadState !== 'function') {
      return {
        ok: false,
        reasonCode: 'restore_unavailable',
        reason: 'Unable to restore checkpoint.',
      };
    }

    const outcome = loadState.call(runtime, checkpoint.state);
    if (outcome?.ok !== true) {
      return {
        ok: false,
        reasonCode: typeof outcome?.reasonCode === 'string' ? outcome.reasonCode : 'restore_failed',
        reason: String(outcome?.reason ?? 'Unable to restore checkpoint.'),
      };
    }

    setTutorialMissions(createInitialTutorialMissionState());
    tutorialMissionBaselineRef.current = null;
    tutorialMoveOriginRef.current = null;
    replaceHistoryWithCurrentState();
    syncHudFromSimulation();
    syncPaletteFromController();
    syncGhostFromController();
    return {
      ok: true,
      reasonCode: 'restored',
      reason: `Restored checkpoint (${checkpoint.reason}) at tick ${checkpoint.tick}.`,
    };
  }, [
    syncGhostFromController,
    syncHudFromSimulation,
    syncPauseHudFromSimulation,
    syncPaletteFromController,
    replaceHistoryWithCurrentState,
    setTutorialMissions,
  ]);

  const clearRuntimeCheckpoints = useCallback((): void => {
    const removed = removeRuntimeStorageItem(RUNTIME_CHECKPOINT_STORAGE_KEY);
    setRuntimeCheckpoints([]);
    if (!removed) {
      setFeedbackMessage({
        kind: 'error',
        message: 'Unable to clear runtime checkpoints.',
      });
      return;
    }

    setFeedbackMessage({
      kind: 'success',
      message: 'Runtime checkpoints cleared.',
    });
  }, [setFeedbackMessage]);

  const appendRuntimePlanExecutionLog = useCallback((entry: string): void => {
    setRuntimePlanExecutionLog((current) => {
      if (entry.trim().length === 0) {
        return current;
      }

      const next = current.concat(entry);
      const maxKeep = Math.max(1, RUNTIME_PLAN_MAX_LOG_ENTRIES);
      return next.length > maxKeep ? next.slice(next.length - maxKeep) : next;
    });
  }, []);

  const clearRuntimePlanExecutionLog = useCallback((): void => {
    setRuntimePlanExecutionLog([]);
  }, []);

  const handleRuntimePlanStepDelayChange = useCallback((
    event: ChangeEvent<HTMLInputElement>,
  ): void => {
    const nextValue = Number(event.target.value);
    setRuntimePlanStepDelayMs(clampRuntimePlanStepDelayMs(nextValue));
  }, []);

  const handleRuntimePlanLoopChange = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    setRuntimePlanLoop(event.target.checked);
  }, []);

  const runPrimaryActionAtTile = useCallback((tile: Tile | null): void => {
    const sim = simulationRef.current as RuntimeSimulation;
    const controller = controllerRef.current;
    if (tile === null || controller === null) {
      setFeedbackMessage({
        kind: 'error',
        message: 'No active tile to interact.',
      });
      return;
    }
    controller.setCursor(tile);
    const controllerState = controller.getState();

    const entities = getEntitiesAtTile(sim, tile);
    const playerTile = getSimulationPlayer(sim);
    const isAdjacent = playerTile ? isAdjacentTile(playerTile, tile) : false;
    const clickedEntity = entities.length > 0 ? buildSelectedEntitySnapshot(sim, tile) : null;
    if (clickedEntity !== null) {
      setHudState({
        selectedEntity: clickedEntity,
      });
    }

    if (entities.length === 0) {
      if (controllerState.selectedKind === null) {
        runMineAtTile(tile);
        return;
      }

      const placementFeedback = controller.clickLMB();
      if (!placementFeedback.ok) {
        const normalizedReason = String(placementFeedback.reason ?? '').toLowerCase();
        setFeedbackMessage({
          kind: 'error',
          message:
            normalizedReason === 'no_fuel'
              ? 'Placement blocked: no fuel.'
              : `Placement blocked for ${describeKindOrTarget(controllerState.selectedKind, tile)}.`,
        });
        syncPaletteFromController();
        syncGhostFromController();
        syncHudFromSimulation();
        return;
      }

      appendRuntimePlanRecordingCommand({
        type: 'place',
        x: tile.x,
        y: tile.y,
        tool: controllerState.selectedKind,
        rotation: controllerState.rotation,
      });
      if (controllerState.selectedKind === 'miner') {
        markTutorialMissionComplete('place-miner');
      }
      if (controllerState.selectedKind === 'belt') {
        markTutorialMissionComplete('place-belt');
      }
      if (controllerState.selectedKind === 'chest') {
        markTutorialMissionComplete('place-chest');
      }

      setFeedbackMessage({
        kind: 'success',
        message: `Placed ${controllerState.selectedKind} at (${tile.x}, ${tile.y}).`,
      });
      appendRuntimeHistorySnapshot();
      syncPaletteFromController();
      syncGhostFromController();
      syncHudFromSimulation();
      return;
    }

    const hasTool = controllerState.selectedKind !== null;

    if (isAdjacent) {
      const simulationWithHostInteraction = sim as {
        interactWithItemHostAtTile?: (targetTile: Tile, action: 'pickup' | 'deposit') => CoreActionOutcome;
        interactWithChestAtTile?: (targetTile: Tile, action: 'pickup' | 'deposit') => CoreActionOutcome;
      };
      const interactWithTileHost = simulationWithHostInteraction.interactWithItemHostAtTile ??
        simulationWithHostInteraction.interactWithChestAtTile;

      if (typeof interactWithTileHost === 'function') {
        const depositOutcome = interactWithTileHost(tile, 'deposit');
        if (depositOutcome?.ok) {
          appendRuntimePlanRecordingCommand({
            type: 'interact',
            action: 'deposit',
            x: tile.x,
            y: tile.y,
          });
          markTutorialMissionComplete('transfer-items');
          appendRuntimeHistorySnapshot();
          setFeedbackMessage({
            kind: 'success',
            message: `Deposited item at (${tile.x}, ${tile.y}).`,
          });
          syncPaletteFromController();
          syncGhostFromController();
          syncHudFromSimulation();
          return;
        }

        const pickupOutcome = interactWithTileHost(tile, 'pickup');
        if (pickupOutcome?.ok) {
          appendRuntimePlanRecordingCommand({
            type: 'interact',
            action: 'pickup',
            x: tile.x,
            y: tile.y,
          });
          markTutorialMissionComplete('transfer-items');
          appendRuntimeHistorySnapshot();
          setFeedbackMessage({
            kind: 'success',
            message: `Picked up item from (${tile.x}, ${tile.y}).`,
          });
          syncPaletteFromController();
          syncGhostFromController();
          syncHudFromSimulation();
          return;
        }

        const normalizedDepositReason = String(depositOutcome?.reason ?? '').toLowerCase();
        const normalizedPickupReason = String(pickupOutcome?.reason ?? '').toLowerCase();
        if (
          normalizedDepositReason.includes('no ready')
          || normalizedDepositReason.includes('no retrievable')
          || normalizedDepositReason.includes('host is empty')
          || normalizedDepositReason.includes('empty')
          || normalizedPickupReason.includes('no ready')
          || normalizedPickupReason.includes('no retrievable')
          || normalizedPickupReason.includes('no items')
          || normalizedPickupReason.includes('host is empty')
          || normalizedPickupReason.includes('empty')
        ) {
          setFeedbackMessage({
            kind: 'error',
            message: 'Target has no ready items.',
          });
        } else if (depositOutcome?.reasonCode === 'no_host' || pickupOutcome?.reasonCode === 'no_host') {
          setFeedbackMessage({
            kind: 'error',
            message: 'No active tool.',
          });
        } else {
          setFeedbackMessage({
            kind: 'error',
            message: String(pickupOutcome?.reason ?? depositOutcome?.reason ?? 'Unable to interact with this nearby tile.'),
          });
        }

        syncPaletteFromController();
          syncGhostFromController();
          syncHudFromSimulation();
        return;
      }

      if (hasTool) {
        setFeedbackMessage({
          kind: 'error',
          message: 'Target has no interactive host.',
        });
        syncPaletteFromController();
        syncGhostFromController();
        syncHudFromSimulation();
        return;
      }
    }

    if (hasTool) {
      setFeedbackMessage({
        kind: 'error',
        message: isAdjacent
          ? 'Cannot place on an occupied tile.'
          : 'Target must be adjacent to the player.',
      });
      syncPaletteFromController();
      syncGhostFromController();
      syncHudFromSimulation();
      return;
    }

    setFeedbackMessage({
      kind: 'error',
      message: isAdjacent
        ? 'No active tool.'
        : 'Target must be adjacent to the player.',
    });
    syncPaletteFromController();
    syncGhostFromController();
    syncHudFromSimulation();
  }, [
    appendRuntimeHistorySnapshot,
    appendRuntimePlanRecordingCommand,
    describeKindOrTarget,
    markTutorialMissionComplete,
    setHudState,
    syncGhostFromController,
    syncHudFromSimulation,
    syncPaletteFromController,
    setFeedbackMessage,
  ]);

  const runSecondaryActionAtTile = useCallback((tile: Tile | null): void => {
    const sim = simulationRef.current as RuntimeSimulation;
    const controller = controllerRef.current;
    if (controller === null || tile === null) {
      setFeedbackMessage({
        kind: 'error',
        message: 'No tile targeted for removal.',
      });
      return;
    }

    controller.setCursor(tile);
    const clickedEntity = getEntitiesAtFromSim(sim, tile).length > 0 ? buildSelectedEntitySnapshot(sim, tile) : null;
    if (clickedEntity !== null) {
      setHudState({
        selectedEntity: clickedEntity,
      });
    }
    if (!getCanRemoveOutcome(sim, tile)) {
      setFeedbackMessage({
        kind: 'error',
        message: `Nothing to remove at (${tile.x}, ${tile.y}).`,
      });
      syncPaletteFromController();
      syncGhostFromController();
      syncHudFromSimulation();
      return;
    }

    const removalFeedback = controller.clickRMB();
    if (!removalFeedback.ok) {
      setFeedbackMessage({
        kind: 'error',
        message: `${removalFeedback.message} at (${tile.x}, ${tile.y}).`,
      });
      syncPaletteFromController();
      syncGhostFromController();
      syncHudFromSimulation();
      return;
    }

    appendRuntimePlanRecordingCommand({
      type: 'remove',
      x: tile.x,
      y: tile.y,
    });

    setFeedbackMessage({
      kind: 'success',
      message: `Removed entity at (${tile.x}, ${tile.y}).`,
    });
    appendRuntimeHistorySnapshot();
    setHudState({
      selectedEntity: null,
    });
    syncPaletteFromController();
    syncGhostFromController();
    syncHudFromSimulation();
  }, [appendRuntimeHistorySnapshot, appendRuntimePlanRecordingCommand, setHudState, syncGhostFromController, syncHudFromSimulation, syncPaletteFromController, setFeedbackMessage]);

  const runPrimaryActionInFrontOfPlayer = useCallback((): void => {
    const sim = simulationRef.current as RuntimeSimulation;
    const player = getSimulationPlayer(sim);
    if (player === null) {
      setFeedbackMessage({
        kind: 'error',
        message: 'Unable to resolve player position.',
      });
      return;
    }

    const direction = getSimulationPlayerDirection(sim) ?? 'S';
    const delta = DIRECTION_TO_DELTA[direction];
    const tile: Tile = {
      x: player.x + delta.x,
      y: player.y + delta.y,
    };

      runPrimaryActionAtTile(tile);
  }, [runPrimaryActionAtTile, setFeedbackMessage]);

  const runTouchPrimaryAction = useCallback((): void => {
    const controller = controllerRef.current;
    const tile = controller?.getState().cursor ?? null;
    if (tile === null) {
      runPrimaryActionInFrontOfPlayer();
      return;
    }
    runPrimaryActionAtTile(tile);
  }, [runPrimaryActionAtTile, runPrimaryActionInFrontOfPlayer]);

  const runTouchSecondaryAction = useCallback((): void => {
    const controller = controllerRef.current;
    const tile = controller?.getState().cursor ?? null;
    if (tile === null) {
      setFeedbackMessage({
        kind: 'error',
        message: 'No tile targeted for removal.',
      });
      return;
    }
    runSecondaryActionAtTile(tile);
  }, [runSecondaryActionAtTile, setFeedbackMessage]);

  const restoreRuntimeHistory = useCallback((target: number): boolean => {
    const snapshot = runtimeHistoryRef.current[target];
    if (!snapshot) {
      return false;
    }

    const runtime = simulationRef.current as RuntimeSimulation;
    const loadState = (runtime as { loadState?: (payload: unknown) => CoreActionOutcome }).loadState;
    if (typeof loadState !== 'function') {
      return false;
    }

    const outcome = loadState.call(runtime, cloneRuntimeStateDeep(snapshot));
    if (outcome?.ok !== true) {
      return false;
    }

    runtimeHistoryCursorRef.current = target;
    return true;
  }, []);

  const canUndoRuntimeHistory = (): boolean => runtimeHistoryCursorRef.current > 0;
  const canRedoRuntimeHistory = (): boolean => {
    const cursor = runtimeHistoryCursorRef.current;
    return cursor >= 0 && cursor < runtimeHistoryRef.current.length - 1;
  };

  const undoRuntimeHistory = useCallback((): void => {
    const target = runtimeHistoryCursorRef.current - 1;
    if (target < 0) {
      return;
    }

    if (!restoreRuntimeHistory(target)) {
      setFeedbackMessage({
        kind: 'error',
        message: 'Unable to restore undo state.',
      });
      return;
    }

    syncHudFromSimulation();
    syncPaletteFromController();
    syncGhostFromController();
    setFeedbackMessage({
      kind: 'success',
      message: 'Undo applied.',
    });
  }, [restoreRuntimeHistory, syncGhostFromController, syncHudFromSimulation, syncPaletteFromController, setFeedbackMessage]);

  const redoRuntimeHistory = useCallback((): void => {
    const target = runtimeHistoryCursorRef.current + 1;
    if (target >= runtimeHistoryRef.current.length) {
      return;
    }

    if (!restoreRuntimeHistory(target)) {
      setFeedbackMessage({
        kind: 'error',
        message: 'Unable to restore redo state.',
      });
      return;
    }

    syncHudFromSimulation();
    syncPaletteFromController();
    syncGhostFromController();
    setFeedbackMessage({
      kind: 'success',
      message: 'Redo applied.',
    });
  }, [restoreRuntimeHistory, syncGhostFromController, syncHudFromSimulation, syncPaletteFromController, setFeedbackMessage]);

  const clearRuntimeHistory = useCallback((): void => {
    const snapshot = captureRuntimeHistorySnapshot();
    if (snapshot === null) {
      runtimeHistoryRef.current = [];
      runtimeHistoryCursorRef.current = -1;
      setFeedbackMessage({
        kind: 'error',
        message: 'Unable to clear history.',
      });
      return;
    }

    runtimeHistoryRef.current = [snapshot];
    runtimeHistoryCursorRef.current = 0;
    syncHudFromSimulation();
    syncPaletteFromController();
    syncGhostFromController();
    setFeedbackMessage({
      kind: 'success',
      message: 'Action history reset.',
    });
  }, [captureRuntimeHistorySnapshot, setFeedbackMessage, syncGhostFromController, syncHudFromSimulation, syncPaletteFromController]);

  const onPaletteSelect = useCallback(
    (kind: EntityKind): void => {
      toggleToolKind(kind);
    },
    [toggleToolKind],
  );

  const captureRuntimeSaveEnvelope = useCallback((): RuntimeSaveEnvelope | null => {
    const controller = controllerRef.current;
    const runtime = simulationRef.current as RuntimeSimulation;
    const simState = typeof runtime.saveState === 'function' ? runtime.saveState() : null;
    if (simState === null) {
      return;
    }

    const controllerState = controller?.getState();
    return {
      ...simState,
      selectedKind: controllerState?.selectedKind ?? null,
      selectedRotation: controllerState?.rotation ?? 0,
      camera: {
        ...cameraRef.current,
        autoFollow: cameraAutoFollowRef.current,
      },
      createdAt: new Date().toISOString(),
    };
  }, []);

  const persistRuntimeSave = useCallback((): void => {
    const envelope = captureRuntimeSaveEnvelope();
    if (envelope === undefined || envelope === null) {
      setFeedbackMessage({
        kind: 'error',
        message: 'Runtime save failed.',
      });
      return;
    }

    const success = writeRuntimeStorageItem(SAVE_STORAGE_KEY, JSON.stringify(envelope));
    if (!success) {
      setFeedbackMessage({
        kind: 'error',
        message: 'Unable to save state.',
      });
      return;
    }

    setFeedbackMessage({
      kind: 'success',
      message: 'State saved.',
    });
  }, [captureRuntimeSaveEnvelope, setFeedbackMessage]);

  const persistRuntimeSaveToSlot = useCallback((slot: number): void => {
    if (!isRuntimeSaveSlotIndex(slot)) {
      setFeedbackMessage({
        kind: 'error',
        message: `Invalid save slot ${String(slot)}.`,
      });
      return;
    }

    const envelope = captureRuntimeSaveEnvelope();
    if (envelope === undefined || envelope === null) {
      setFeedbackMessage({
        kind: 'error',
        message: 'Runtime save failed.',
      });
      return;
    }

    const success = writeRuntimeStorageItem(getSaveSlotStorageKey(slot), JSON.stringify(envelope));
    if (!success) {
      setFeedbackMessage({
        kind: 'error',
        message: `Unable to save state to slot ${slot + 1}.`,
      });
      return;
    }

    refreshRuntimeSaveSlots();
    setFeedbackMessage({
      kind: 'success',
      message: `State saved to slot ${slot + 1}.`,
    });
  }, [captureRuntimeSaveEnvelope, refreshRuntimeSaveSlots, setFeedbackMessage]);

  const applyRuntimeSave = useCallback((payload: unknown): RuntimeSaveCompatibilitySummary | null => {
    const runtime = simulationRef.current as RuntimeSimulation;
    if (typeof runtime.loadState !== 'function') {
      return null;
    }

    const resolved = resolveRuntimeSavePayload(payload);
    if (resolved === null) {
      setFeedbackMessage({
        kind: 'error',
        message: 'Invalid save payload.',
      });
      return null;
    }

    const parsed = parseRuntimeSaveState(resolved);
    if (parsed === null) {
      setFeedbackMessage({
        kind: 'error',
        message: 'Invalid save payload.',
      });
      return null;
    }

    const normalized = normalizeRuntimeSaveStateForRuntime(parsed);
    const outcome = runtime.loadState(normalized.state);
    if (outcome?.ok !== true) {
      setFeedbackMessage({
        kind: 'error',
        message: String(outcome?.reason ?? 'Unable to load state.'),
      });
      return null;
    }

    replaceHistoryWithCurrentState();
    return normalized;
  }, [setFeedbackMessage, replaceHistoryWithCurrentState]);

  const loadRuntimeFromPayload = useCallback((payload: unknown): RuntimeSaveCompatibilityWarning[] | null => {
    const normalized = applyRuntimeSave(payload);
    if (normalized === null) {
      return null;
    }

    const controller = controllerRef.current;
    if (controller !== null && isRecord(payload)) {
      if ('selectedKind' in payload) {
        const candidate = payload.selectedKind;
        if (candidate === null || RUNTIME_TOOL_CYCLE_ORDER.includes(candidate as EntityKind)) {
          controller.selectKind(candidate as EntityKind | null);
        }
      }

      if (typeof payload.selectedRotation === 'number') {
        const rotation = Number(payload.selectedRotation);
        const normalizedRotation = Math.trunc(rotation);
        if (Number.isInteger(normalizedRotation) && normalizedRotation >= 0 && normalizedRotation <= 3) {
          controller.setRotation(normalizedRotation as Rotation);
        }
      }

      if (isRecord(payload.camera)) {
        const camera = payload.camera;
        const nextZoom = clampCameraZoom(camera.zoom, cameraRef.current.zoom);
        const nextPanX = toSignedInt(camera.panX);
        const nextPanY = toSignedInt(camera.panY);
        setCamera({
          zoom: nextZoom,
          panX: nextPanX ?? cameraRef.current.panX,
          panY: nextPanY ?? cameraRef.current.panY,
        });
        const nextAutoFollow = camera.autoFollow === true;
        cameraAutoFollowRef.current = nextAutoFollow;
        setCameraAutoFollow(nextAutoFollow);
      }
    }

    setTutorialMissions(createInitialTutorialMissionState());
    tutorialMissionBaselineRef.current = null;
    tutorialMoveOriginRef.current = null;
    syncPaletteFromController();
    syncHudFromSimulation();
    return normalized.warnings;
  }, [applyRuntimeSave, setCamera, setCameraAutoFollow, syncHudFromSimulation, syncPaletteFromController]);

  const loadRuntimeFromStorage = useCallback((): void => {
    try {
      const readResult = readRuntimeSaveFromStorage(SAVE_STORAGE_KEY);
      if (readResult.status === 'missing') {
        setFeedbackMessage({
          kind: 'error',
          message: 'No save found.',
        });
        return;
      }

      if (readResult.status === 'invalid') {
        setFeedbackMessage({
          kind: 'error',
          message: 'Save data is invalid.',
        });
        return;
      }

      const loaded = loadRuntimeFromPayload(readResult.parsed);
      if (loaded === null) {
        return;
      }

      const compatibilitySummary = describeRuntimeSaveCompatibilityWarnings(loaded);
      const stateSummary = describeRuntimeSaveStateSummary(readResult.parsed);
      setFeedbackMessage({
        kind: 'success',
        message: `Loaded state. (${stateSummary})${compatibilitySummary === '' ? '' : ` ${compatibilitySummary}`}`,
      });
    } catch {
      setFeedbackMessage({
        kind: 'error',
        message: 'Unable to load state.',
      });
    }
  }, [
    loadRuntimeFromPayload,
    setFeedbackMessage,
  ]);

  const clearRuntimeSave = useCallback((): void => {
    const removed = removeRuntimeStorageItem(SAVE_STORAGE_KEY);
    if (!removed) {
      setFeedbackMessage({
        kind: 'error',
        message: 'Unable to clear save.',
      });
      return;
    }

    setFeedbackMessage({
      kind: 'success',
      message: 'Save cleared.',
    });
  }, [setFeedbackMessage]);

  const exportRuntimeSave = useCallback((): void => {
    const envelope = captureRuntimeSaveEnvelope();
    if (envelope === undefined || envelope === null) {
      setFeedbackMessage({
        kind: 'error',
        message: 'Runtime save failed.',
      });
      return;
    }

    try {
      const payload = JSON.stringify(envelope);
      const blob = new Blob([payload], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `agents-ultra-save-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(url);
      setFeedbackMessage({
        kind: 'success',
        message: 'State export started.',
      });
    } catch {
      setFeedbackMessage({
        kind: 'error',
        message: 'Unable to export state.',
      });
    }
  }, [captureRuntimeSaveEnvelope, setFeedbackMessage]);

  const copyRuntimeSaveToClipboard = useCallback(async (): Promise<void> => {
    const envelope = captureRuntimeSaveEnvelope();
    if (envelope === undefined || envelope === null) {
      setFeedbackMessage({
        kind: 'error',
        message: 'Runtime save failed.',
      });
      return;
    }

    const clipboard = window.navigator.clipboard;
    if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
      setFeedbackMessage({
        kind: 'error',
        message: 'Clipboard write is not available in this browser.',
      });
      return;
    }

    try {
      const payload = JSON.stringify({
        kind: 'runtime-save',
        schemaVersion: RUNTIME_SHARE_SCHEMA_VERSION,
        payload: envelope,
        createdAt: new Date().toISOString(),
      });
      await clipboard.writeText(payload);
      setFeedbackMessage({
        kind: 'success',
        message: 'State copied to clipboard.',
      });
    } catch {
      setFeedbackMessage({
        kind: 'error',
        message: 'Unable to copy state to clipboard.',
      });
    }
  }, [captureRuntimeSaveEnvelope, setFeedbackMessage]);

  const copyRuntimeSaveShareLink = useCallback(async (): Promise<void> => {
    const envelope = captureRuntimeSaveEnvelope();
    if (envelope === undefined || envelope === null) {
      setFeedbackMessage({
        kind: 'error',
        message: 'Runtime save failed.',
      });
      return;
    }

    const shareLink = buildRuntimeShareLink({
      kind: 'runtime-save',
      schemaVersion: RUNTIME_SHARE_SCHEMA_VERSION,
      payload: envelope,
      createdAt: new Date().toISOString(),
    });
    if (shareLink === null) {
      setFeedbackMessage({
        kind: 'error',
        message: 'Unable to build runtime save share link.',
      });
      return;
    }

    const clipboard = window.navigator.clipboard;
    if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
      setFeedbackMessage({
        kind: 'error',
        message: 'Clipboard write is not available in this browser.',
      });
      return;
    }

    try {
      await clipboard.writeText(shareLink);
      setFeedbackMessage({
        kind: 'success',
        message: 'Runtime save share link copied to clipboard.',
      });
    } catch {
      setFeedbackMessage({
        kind: 'error',
        message: 'Unable to copy runtime save share link.',
      });
    }
  }, [captureRuntimeSaveEnvelope, setFeedbackMessage]);

  const pasteRuntimeSaveFromClipboard = useCallback(async (): Promise<void> => {
    const clipboard = window.navigator.clipboard;
    if (clipboard === undefined || typeof clipboard.readText !== 'function') {
      setFeedbackMessage({
        kind: 'error',
        message: 'Clipboard read is not available in this browser.',
      });
      return;
    }

    try {
      const payloadText = await clipboard.readText();
      if (payloadText.trim().length === 0) {
        setFeedbackMessage({
          kind: 'error',
          message: 'Clipboard is empty.',
        });
        return;
      }

      const parsed = safeParseJson(payloadText);
      if (parsed === null) {
        setFeedbackMessage({
          kind: 'error',
          message: 'Clipboard payload is invalid JSON.',
        });
        return;
      }

      const validation = validateRuntimeSharePayloadForImport(parsed);
      if (validation.errors.length > 0 || validation.savePayload === null) {
        const reason =
          validation.errors.length > 0
            ? validation.errors.join(' ')
            : 'Clipboard does not contain a runtime save payload.';
        setFeedbackMessage({
          kind: 'error',
          message: `State paste rejected: ${reason}`,
        });
        return;
      }
      if (validation.kind !== 'runtime-save') {
        setFeedbackMessage({
          kind: 'error',
          message: 'Clipboard payload is not a runtime save.',
        });
        return;
      }

      const loaded = loadRuntimeFromPayload(validation.savePayload);
      if (loaded === null) {
        return;
      }

      const stateSummary = describeRuntimeSaveStateSummary(validation.savePayload);
      const compatibilitySummary = describeRuntimeSaveCompatibilityWarnings(loaded);
      const warningParts = [...validation.warnings, ...(compatibilitySummary === '' ? [] : [compatibilitySummary])];
      setFeedbackMessage({
        kind: 'success',
        message: `State pasted from clipboard. ${stateSummary}${warningParts.length === 0 ? '' : ` ${warningParts.join(' ')}`}`,
      });
    } catch {
      setFeedbackMessage({
        kind: 'error',
        message: 'Unable to paste state from clipboard.',
      });
    }
  }, [describeRuntimeSaveCompatibilityWarnings, loadRuntimeFromPayload, setFeedbackMessage]);

  const openRuntimeSaveImportDialog = useCallback((): void => {
    const input = runtimeSaveImportInputRef.current;
    if (input === null) {
      setFeedbackMessage({
        kind: 'error',
        message: 'Import not available.',
      });
      return;
    }

    input.value = '';
    input.click();
  }, [setFeedbackMessage]);

  const importRuntimeSaveText = useCallback(
    async (rawPayload: string): Promise<void> => {
      if (rawPayload.length > MAX_RUNTIME_SAVE_IMPORT_BYTES) {
        setFeedbackMessage({
          kind: 'error',
          message: `Save import payload is too large. Maximum supported size is ${MAX_RUNTIME_SAVE_IMPORT_BYTES} bytes.`,
        });
        return;
      }

      const parsed = safeParseJson(rawPayload);
      if (parsed === null) {
        setFeedbackMessage({
          kind: 'error',
          message: 'Imported save is invalid JSON.',
        });
        return;
      }

      const validation = validateRuntimeSharePayloadForImport(parsed);
      if (validation.errors.length > 0 || validation.savePayload === null || validation.kind !== 'runtime-save') {
        const reason =
          validation.errors.length > 0
            ? validation.errors.join(' ')
            : 'Payload is not a runtime save.';
        setFeedbackMessage({
          kind: 'error',
          message: `Save import rejected: ${reason}`,
        });
        return;
      }

      const loaded = loadRuntimeFromPayload(validation.savePayload);
      if (loaded === null) {
        return;
      }

      const compatibilitySummary = describeRuntimeSaveCompatibilityWarnings(loaded);
      const stateSummary = describeRuntimeSaveStateSummary(validation.savePayload);
      const warningsSuffix = [...validation.warnings, ...(compatibilitySummary === '' ? [] : [compatibilitySummary])].join(' ');
      setFeedbackMessage({
        kind: 'success',
        message: `State imported. ${stateSummary}${warningsSuffix === '' ? '' : ` ${warningsSuffix}`}`,
      });

    },
    [describeRuntimeSaveCompatibilityWarnings, loadRuntimeFromPayload, setFeedbackMessage],
  );

  const handleRuntimeSaveImportChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
      const selectedFile = event.target.files?.[0];
      if (selectedFile === undefined) {
        return;
      }

      if (selectedFile.size > MAX_RUNTIME_SAVE_IMPORT_BYTES) {
        setFeedbackMessage({
          kind: 'error',
          message: `Save import payload is too large. Maximum supported size is ${MAX_RUNTIME_SAVE_IMPORT_BYTES} bytes.`,
        });
        return;
      }

      try {
        const payloadText = await selectedFile.text();
        await importRuntimeSaveText(payloadText);
      } catch {
        setFeedbackMessage({
          kind: 'error',
          message: 'Unable to import state.',
        });
      } finally {
        event.target.value = '';
      }
    },
    [importRuntimeSaveText, setFeedbackMessage],
  );

  const captureRuntimeBlueprint = useCallback((): RuntimeBlueprintState | null => {
    const runtime = simulationRef.current as RuntimeSimulation;
    const snapshot = runtime.saveState?.();
    const playerSnapshot = runtime.getPlayerSnapshot?.();
    if (
      snapshot === undefined ||
      snapshot === null ||
      playerSnapshot === null ||
      snapshot.entities === undefined
    ) {
      return null;
    }

    const entities = Array.isArray(snapshot.entities)
      ? snapshot.entities
        .map((entity) => {
          if (!isRecord(entity) || !isRecord(entity.pos) || typeof entity.kind !== 'string') {
            return null;
          }

          const normalizedKind = normalizeRuntimeSaveEntityKind(entity.kind);
          if (normalizedKind === null) {
            return null;
          }

          const x = toCompatInt(entity.pos.x) ?? 0;
          const y = toCompatInt(entity.pos.y) ?? 0;
          const rot = normalizeRuntimeDirection(entity.rot) ?? 'N';
          return {
            kind: normalizedKind.kind,
            pos: {
              x: x - playerSnapshot.x,
              y: y - playerSnapshot.y,
            },
            rot,
          };
        })
        .filter((entry): entry is RuntimeBlueprintEntity => entry !== null)
      : [];

    return {
      createdAt: new Date().toISOString(),
      version: RUNTIME_BLUEPRINT_SCHEMA_VERSION,
      schemaVersion: RUNTIME_BLUEPRINT_SCHEMA_VERSION,
      anchor: {
        x: playerSnapshot.x,
        y: playerSnapshot.y,
      },
      entities,
      name: `Runtime Blueprint ${new Date().toISOString().replace(/[:.]/g, '-')}`,
    };
  }, []);

  const exportRuntimeBlueprint = useCallback((): void => {
    const blueprint = captureRuntimeBlueprint();
    if (blueprint === null) {
      setFeedbackMessage({
        kind: 'error',
        message: 'Runtime blueprint export failed.',
      });
      return;
    }

    try {
      const payload = JSON.stringify({
        ...blueprint,
        createdAt: new Date().toISOString(),
        schemaVersion: blueprint.schemaVersion ?? RUNTIME_BLUEPRINT_SCHEMA_VERSION,
      });
      const blob = new Blob([payload], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `agents-ultra-blueprint-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(url);
      setFeedbackMessage({
        kind: 'success',
        message: `Blueprint exported with ${blueprint.entities.length} entity${blueprint.entities.length === 1 ? '' : 'ies'}.`,
      });
    } catch {
      setFeedbackMessage({
        kind: 'error',
        message: 'Unable to export blueprint.',
      });
    }
  }, [captureRuntimeBlueprint, setFeedbackMessage]);

  const copyRuntimeBlueprintToClipboard = useCallback(async (): Promise<void> => {
    const blueprint = captureRuntimeBlueprint();
    if (blueprint === null) {
      setFeedbackMessage({
        kind: 'error',
        message: 'Runtime blueprint export failed.',
      });
      return;
    }

    const clipboard = window.navigator.clipboard;
    if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
      setFeedbackMessage({
        kind: 'error',
        message: 'Clipboard write is not available in this browser.',
      });
      return;
    }

    try {
      const payload = JSON.stringify({
        kind: 'runtime-blueprint',
        schemaVersion: RUNTIME_SHARE_SCHEMA_VERSION,
        payload: blueprint,
        createdAt: new Date().toISOString(),
      });
      await clipboard.writeText(payload);
      setFeedbackMessage({
        kind: 'success',
        message: 'Blueprint copied to clipboard.',
      });
    } catch {
      setFeedbackMessage({
        kind: 'error',
        message: 'Unable to copy blueprint to clipboard.',
      });
    }
  }, [captureRuntimeBlueprint, setFeedbackMessage]);

  const copyRuntimeBlueprintShareLink = useCallback(async (): Promise<void> => {
    const blueprint = captureRuntimeBlueprint();
    if (blueprint === null) {
      setFeedbackMessage({
        kind: 'error',
        message: 'Runtime blueprint export failed.',
      });
      return;
    }

    const shareLink = buildRuntimeShareLink({
      kind: 'runtime-blueprint',
      schemaVersion: RUNTIME_SHARE_SCHEMA_VERSION,
      payload: blueprint,
      createdAt: new Date().toISOString(),
    });
    if (shareLink === null) {
      setFeedbackMessage({
        kind: 'error',
        message: 'Unable to build runtime blueprint share link.',
      });
      return;
    }

    const clipboard = window.navigator.clipboard;
    if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
      setFeedbackMessage({
        kind: 'error',
        message: 'Clipboard write is not available in this browser.',
      });
      return;
    }

    try {
      await clipboard.writeText(shareLink);
      setFeedbackMessage({
        kind: 'success',
        message: 'Runtime blueprint share link copied to clipboard.',
      });
    } catch {
      setFeedbackMessage({
        kind: 'error',
        message: 'Unable to copy runtime blueprint share link.',
      });
    }
  }, [captureRuntimeBlueprint, setFeedbackMessage]);

  const applyRuntimeBlueprint = useCallback((blueprint: RuntimeBlueprintState): { ok: boolean; message: string } => {
    const runtime = simulationRef.current as RuntimeSimulation;
    const playerSnapshot = runtime.getPlayerSnapshot?.();
    if (playerSnapshot === null || playerSnapshot === undefined) {
      return {
        ok: false,
        message: 'Unable to resolve player position.',
      };
    }

    const getSimulationEntities = runtime.getAllEntities;
    if (typeof getSimulationEntities !== 'function') {
      return {
        ok: false,
        message: 'Simulation is not ready for blueprint import.',
      };
    }

    const map = runtime.getMap?.();
    const getPlacementOutcome = typeof runtime.getPlacementOutcome === 'function'
      ? runtime.getPlacementOutcome.bind(runtime)
      : undefined;
    const canPlace = typeof runtime.canPlace === 'function'
      ? runtime.canPlace.bind(runtime)
      : undefined;
    const existingEntities = getSimulationEntities.call(runtime);
    const occupied = new Map<string, true>();
    for (const entity of existingEntities) {
      if (!isRecord(entity) || !isRecord(entity.pos)) {
        continue;
      }
      const rawPos = resolveTile(entity.pos);
      if (rawPos === null) {
        continue;
      }

      occupied.set(`${rawPos.x},${rawPos.y}`, true);
    }

    const mapIsOre = map === undefined || map === null || typeof map.isOre !== 'function'
      ? undefined
      : map.isOre.bind(map);
    const placementInspection = inspectRuntimeBlueprintPlacement(blueprint, {
      playerSnapshot,
      occupiedTiles: new Set(occupied.keys()),
      isOre: mapIsOre,
      canPlacePlacement: getPlacementOutcome ?? canPlace,
    });
    if (!placementInspection.ok) {
      return {
        ok: false,
        message: `Blueprint import blocked: ${describeRuntimeBlueprintPlacementBlockers(placementInspection.blockers)}.`,
      };
    }

    const planned = placementInspection.planned;
    if (planned.length === 0) {
      return {
        ok: true,
        message: 'Blueprint imported with 0 entities (no-op).',
      };
    }
    if (typeof runtime.placeEntity !== 'function' && typeof runtime.addEntity !== 'function') {
      return {
        ok: false,
        message: 'Simulation is missing placement primitives.',
      };
    }

    const snapshotBefore = runtime.saveState?.();
    for (const placement of planned) {
      const toolKind = RUNTIME_KIND_TO_TOOL_KIND[placement.kind];
      if (toolKind === undefined) {
        return {
          ok: false,
          message: `Unsupported blueprint entity '${placement.kind}'.`,
        };
      }

      const placementResult = typeof runtime.placeEntity === 'function'
        ? runtime.placeEntity(toolKind, placement.tile, placement.rotation)
        : runtime.addEntity?.(toolKind, placement.tile, placement.rotation);
      const failed = placementResult === false
        || placementResult === null
        || (isRecord(placementResult) && placementResult.ok !== true);

      if (failed) {
        const previous = typeof snapshotBefore === 'undefined' ? null : snapshotBefore;
        if (previous !== null && typeof runtime.loadState === 'function') {
          runtime.loadState(previous);
        }
        return {
          ok: false,
          message: `Blueprint import failed while placing tile (${placement.tile.x}, ${placement.tile.y}).`,
        };
      }
      occupied.set(`${placement.tile.x},${placement.tile.y}`, true);
    }

    appendRuntimeHistorySnapshot();
    syncHudFromSimulation();
    syncPaletteFromController();
    syncGhostFromController();
    const finalBoundsLeft = placementInspection.bounds?.left ?? 0;
    const finalBoundsTop = placementInspection.bounds?.top ?? 0;
    const finalBoundsRight = placementInspection.bounds?.right ?? finalBoundsLeft;
    const finalBoundsBottom = placementInspection.bounds?.bottom ?? finalBoundsTop;

    return {
      ok: true,
      message: `Blueprint imported with ${planned.length} entit${planned.length === 1 ? 'y' : 'ies'} in box (${finalBoundsLeft}, ${finalBoundsTop})-(${finalBoundsRight}, ${finalBoundsBottom}).`,
    };
  }, [
    appendRuntimeHistorySnapshot,
    syncGhostFromController,
    syncHudFromSimulation,
    syncPaletteFromController,
  ]);

  const pasteRuntimeShareFromClipboard = useCallback(async (expectedKind: RuntimeSharePayloadKind): Promise<void> => {
    const clipboard = window.navigator.clipboard;
    if (clipboard === undefined || typeof clipboard.readText !== 'function') {
      setFeedbackMessage({
        kind: 'error',
        message: 'Clipboard read is not available in this browser.',
      });
      return;
    }

    try {
      const payloadText = await clipboard.readText();
      const parsed = parseRuntimeSharePayloadFromClipboardText(payloadText);
      if (parsed === null) {
        setFeedbackMessage({
          kind: 'error',
          message: 'Clipboard is empty or missing share data.',
        });
        return;
      }

      if (parsed.errors.length > 0 || parsed.kind === null) {
        const reason = parsed.errors.length > 0
          ? parsed.errors.join(' ')
          : 'Clipboard does not contain a runtime share payload.';
        setFeedbackMessage({
          kind: 'error',
          message: `Share link paste rejected: ${reason}`,
        });
        return;
      }

      if (parsed.kind !== expectedKind) {
        setFeedbackMessage({
          kind: 'error',
          message: expectedKind === 'runtime-save'
            ? 'Clipboard share payload is not a runtime save.'
            : 'Clipboard share payload is not a runtime blueprint.',
        });
        return;
      }

      if (expectedKind === 'runtime-save' && parsed.savePayload !== null) {
        const loaded = loadRuntimeFromPayload(parsed.savePayload);
        if (loaded === null) {
          return;
        }

        const compatibilitySummary = describeRuntimeSaveCompatibilityWarnings(loaded);
        const stateSummary = describeRuntimeSaveStateSummary(parsed.savePayload);
        const warningParts = [...parsed.warnings, ...(compatibilitySummary === '' ? [] : [compatibilitySummary])];
        setFeedbackMessage({
          kind: 'success',
          message: `Share save loaded. (${stateSummary})${warningParts.length === 0 ? '' : ` ${warningParts.join(' ')}`}`,
        });
        return;
      }

      if (expectedKind === 'runtime-blueprint' && parsed.blueprintPayload !== null) {
        const outcome = applyRuntimeBlueprint(parsed.blueprintPayload);
        if (!outcome.ok) {
          setFeedbackMessage({
            kind: 'error',
            message: outcome.message,
          });
          return;
        }

        const warningSuffix = parsed.warnings.length > 0 ? ` ${parsed.warnings.join(' ')}` : '';
        setFeedbackMessage({
          kind: 'success',
          message: `${outcome.message}${warningSuffix}`.trim(),
        });
        return;
      }

      setFeedbackMessage({
        kind: 'error',
        message: 'Clipboard share payload is malformed.',
      });
    } catch {
      setFeedbackMessage({
        kind: 'error',
        message: 'Unable to paste share link from clipboard.',
      });
    }
  }, [applyRuntimeBlueprint, describeRuntimeSaveCompatibilityWarnings, describeRuntimeSaveStateSummary, loadRuntimeFromPayload, setFeedbackMessage]);

  const pasteRuntimeSaveShareLinkFromClipboard = useCallback(async (): Promise<void> => {
    await pasteRuntimeShareFromClipboard('runtime-save');
  }, [pasteRuntimeShareFromClipboard]);

  const pasteRuntimeBlueprintShareLinkFromClipboard = useCallback(async (): Promise<void> => {
    await pasteRuntimeShareFromClipboard('runtime-blueprint');
  }, [pasteRuntimeShareFromClipboard]);

  const openRuntimeBlueprintImportDialog = useCallback((): void => {
    const input = runtimeBlueprintImportInputRef.current;
    if (input === null) {
      setFeedbackMessage({
        kind: 'error',
        message: 'Blueprint import not available.',
      });
      return;
    }

    input.value = '';
    input.click();
  }, [setFeedbackMessage]);

  const importRuntimeBlueprintText = useCallback(
    async (rawPayload: string): Promise<void> => {
      if (rawPayload.length > MAX_RUNTIME_BLUEPRINT_IMPORT_BYTES) {
        setFeedbackMessage({
          kind: 'error',
          message: `Blueprint import payload is too large. Maximum supported size is ${MAX_RUNTIME_BLUEPRINT_IMPORT_BYTES} bytes.`,
        });
        return;
      }

      const parsed = safeParseJson(rawPayload);
      if (parsed === null) {
        setFeedbackMessage({
          kind: 'error',
          message: 'Imported blueprint is invalid JSON.',
        });
        return;
      }

      const validation = validateRuntimeSharePayloadForImport(parsed);
      if (
        validation.errors.length > 0
        || validation.kind !== 'runtime-blueprint'
        || validation.blueprintPayload === null
      ) {
        const reason =
          validation.errors.length > 0
            ? validation.errors.join(' ')
            : validation.kind === 'runtime-save'
              ? 'Clipboard payload is a runtime save.'
              : 'Payload is not a runtime blueprint.';
        setFeedbackMessage({
          kind: 'error',
          message: `Blueprint import rejected: ${reason}`,
        });
        return;
      }

      const outcome = applyRuntimeBlueprint(validation.blueprintPayload);
      if (!outcome.ok) {
        setFeedbackMessage({
          kind: 'error',
          message: outcome.message,
        });
        return;
      }

      const warningSuffix = validation.warnings.length > 0 ? ` ${validation.warnings.join(' ')}` : '';
      setFeedbackMessage({
        kind: 'success',
        message: `${outcome.message}${warningSuffix}`.trim(),
      });
    },
    [applyRuntimeBlueprint, setFeedbackMessage],
  );

  const loadRuntimeShareFromLocation = useCallback((searchOrUrl: string): void => {
    const validation = parseRuntimeSharePayloadFromSearchParams(searchOrUrl);
    if (validation === null) {
      return;
    }

    const clearSharedParam = (): void => {
      const cleanedUrl = clearRuntimeShareParamFromUrl(searchOrUrl);
      if (cleanedUrl === null) {
        return;
      }
      try {
        window.history.replaceState({}, '', cleanedUrl);
      } catch {
        // intentionally ignored
      }
    };

    if (validation.errors.length > 0) {
      const reason = validation.errors.join(' ');
      setFeedbackMessage({
        kind: 'error',
        message: `Runtime share import rejected: ${reason}`,
      });
      clearSharedParam();
      return;
    }

    if (validation.kind === 'runtime-save' && validation.savePayload !== null) {
      const loaded = loadRuntimeFromPayload(validation.savePayload);
      if (loaded === null) {
        return;
      }

      const stateSummary = describeRuntimeSaveStateSummary(validation.savePayload);
      const compatibilitySummary = describeRuntimeSaveCompatibilityWarnings(loaded);
      const warningParts = [...validation.warnings, ...(compatibilitySummary === '' ? [] : [compatibilitySummary])];
      setFeedbackMessage({
        kind: 'success',
        message: `Shared save loaded. (${stateSummary})${warningParts.length === 0 ? '' : ` ${warningParts.join(' ')}`}`,
      });
      clearSharedParam();
      return;
    }

    if (validation.kind === 'runtime-blueprint' && validation.blueprintPayload !== null) {
      const outcome = applyRuntimeBlueprint(validation.blueprintPayload);
      if (!outcome.ok) {
        setFeedbackMessage({
          kind: 'error',
          message: outcome.message,
        });
        clearSharedParam();
        return;
      }

      const warningSuffix = validation.warnings.length > 0 ? ` ${validation.warnings.join(' ')}` : '';
      setFeedbackMessage({
        kind: 'success',
        message: `${outcome.message}${warningSuffix}`.trim(),
      });
      clearSharedParam();
      return;
    }

    setFeedbackMessage({
      kind: 'error',
      message: 'Runtime share payload kind is unsupported.',
    });
    clearSharedParam();
  }, [applyRuntimeBlueprint, describeRuntimeSaveCompatibilityWarnings, describeRuntimeSaveStateSummary, loadRuntimeFromPayload, setFeedbackMessage]);

  const pasteRuntimeBlueprintFromClipboard = useCallback(async (): Promise<void> => {
    const clipboard = window.navigator.clipboard;
    if (clipboard === undefined || typeof clipboard.readText !== 'function') {
      setFeedbackMessage({
        kind: 'error',
        message: 'Clipboard read is not available in this browser.',
      });
      return;
    }

    try {
      const payloadText = await clipboard.readText();
      if (payloadText.trim().length === 0) {
        setFeedbackMessage({
          kind: 'error',
          message: 'Clipboard is empty.',
        });
        return;
      }

      const parsed = safeParseJson(payloadText);
      if (parsed === null) {
        setFeedbackMessage({
          kind: 'error',
          message: 'Clipboard payload is invalid JSON.',
        });
        return;
      }

      const validation = validateRuntimeSharePayloadForImport(parsed);
      if (validation.errors.length > 0 || validation.kind !== 'runtime-blueprint' || validation.blueprintPayload === null) {
        const reason =
          validation.errors.length > 0
            ? validation.errors.join(' ')
            : 'Payload is not a runtime blueprint.';
        setFeedbackMessage({
          kind: 'error',
          message: `Blueprint paste rejected: ${reason}`,
        });
        return;
      }

      const outcome = applyRuntimeBlueprint(validation.blueprintPayload);
      if (!outcome.ok) {
        setFeedbackMessage({
          kind: 'error',
          message: outcome.message,
        });
        return;
      }

      const warningSuffix = validation.warnings.length > 0 ? ` ${validation.warnings.join(' ')}` : '';
      setFeedbackMessage({
        kind: 'success',
        message: `${outcome.message}${warningSuffix}`.trim(),
      });
    } catch {
      setFeedbackMessage({
        kind: 'error',
        message: 'Unable to paste blueprint from clipboard.',
      });
    }
  }, [applyRuntimeBlueprint, setFeedbackMessage]);

  const handleRuntimeBlueprintImportChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
      const selectedFile = event.target.files?.[0];
      if (selectedFile === undefined) {
        return;
      }

      if (selectedFile.size > MAX_RUNTIME_BLUEPRINT_IMPORT_BYTES) {
        setFeedbackMessage({
          kind: 'error',
          message: `Blueprint import payload is too large. Maximum supported size is ${MAX_RUNTIME_BLUEPRINT_IMPORT_BYTES} bytes.`,
        });
        return;
      }

      try {
        const payloadText = await selectedFile.text();
        await importRuntimeBlueprintText(payloadText);
      } catch {
        setFeedbackMessage({
          kind: 'error',
          message: 'Unable to import blueprint.',
        });
      } finally {
        event.target.value = '';
      }
    },
    [importRuntimeBlueprintText, setFeedbackMessage],
  );

  const hydrateRuntimePlan = useCallback((
    plan: RuntimeAgentPlan | null,
    enabledAgents?: RuntimeAgentPlanEnabledAgents,
  ): void => {
    if (runtimePlanRecordingRef.current) {
      runtimePlanRecordingRef.current = false;
      runtimePlanRecordingCommandsRef.current = [];
      setRuntimePlanRecording(false);
      setRuntimePlanRecordingCommandCount(0);
    }
    runtimePlanRef.current = plan;
    runtimePlanCursorRef.current = 0;
    runtimePlanExecutionStateRef.current = null;
    runtimePlanAgentStepDelayMsRef.current = {};
    runtimePlanRunningRef.current = false;
    if (runtimePlanIntervalRef.current !== null) {
      window.clearInterval(runtimePlanIntervalRef.current);
      runtimePlanIntervalRef.current = null;
    }

    setRuntimePlanRunning(false);
    setRuntimePlanProgress(0);
    setRuntimePlanExecutionLog([]);
    setRuntimePlan(plan);
    const enabledAgentState = resolveRuntimePlanEnabledAgentsFromStorage(plan, enabledAgents);
    runtimePlanEnabledAgentsRef.current = enabledAgentState;
    setRuntimePlanEnabledAgents(enabledAgentState);

    if (plan === null) {
      setRuntimePlanName('No plan loaded');
      setRuntimePlanStatusMessage('No plan loaded.');
      return;
    }

    setRuntimePlanName(plan.name ?? 'Unnamed plan');
    setRuntimePlanStatusMessage(`Loaded ${plan.commands.length} commands.`);
  }, []);

  const importRuntimePlanText = useCallback(
    async (rawPayload: string): Promise<void> => {
      if (rawPayload.length > MAX_RUNTIME_PLAN_IMPORT_BYTES) {
        setFeedbackMessage({
          kind: 'error',
          message: `Plan import payload is too large. Maximum supported size is ${MAX_RUNTIME_PLAN_IMPORT_BYTES} bytes.`,
        });
        return;
      }

      const parsed = safeParseJson(rawPayload);
      if (parsed === null) {
        setFeedbackMessage({
          kind: 'error',
          message: 'Imported plan is invalid JSON.',
        });
        return;
      }

      const validation = resolveRuntimeAgentPlanImportPayload(parsed);
      if (validation.errors.length > 0 || validation.plan === null) {
        setFeedbackMessage({
          kind: 'error',
          message: validation.errors.length > 0
            ? `Plan import rejected: ${validation.errors.join(' ')}`
            : `Plan import payload is invalid.${formatRuntimeAgentPlanWarnings(validation.warnings)}`,
        });
        return;
      }

      const enabledAgents = validation.enabledAgents ?? createDefaultRuntimePlanEnabledAgentsState(validation.plan);
      const saved = writeRuntimeAgentPlanStoragePayload(validation.plan, enabledAgents);
      if (!saved) {
        setFeedbackMessage({
          kind: 'error',
          message: 'Unable to store imported plan.',
        });
        return;
      }

      hydrateRuntimePlan(validation.plan, enabledAgents);
      setFeedbackMessage({
        kind: 'success',
        message: `Plan imported. (${validation.plan.commands.length} commands).${formatRuntimeAgentPlanWarnings(validation.warnings)}`,
      });
    },
    [hydrateRuntimePlan, setFeedbackMessage],
  );

  const handleRuntimePlanImportChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
      const selectedFile = event.target.files?.[0];
      if (selectedFile === undefined) {
        return;
      }

      if (selectedFile.size > MAX_RUNTIME_PLAN_IMPORT_BYTES) {
        setFeedbackMessage({
          kind: 'error',
          message: `Plan import payload is too large. Maximum supported size is ${MAX_RUNTIME_PLAN_IMPORT_BYTES} bytes.`,
        });
        return;
      }

      try {
        const payloadText = await selectedFile.text();
        await importRuntimePlanText(payloadText);
      } catch {
        setFeedbackMessage({
          kind: 'error',
          message: 'Unable to import plan.',
        });
      } finally {
        event.target.value = '';
      }
    },
    [importRuntimePlanText, setFeedbackMessage],
  );

  const openRuntimePlanImportDialog = useCallback((): void => {
    const input = runtimePlanImportInputRef.current;
    if (input === null) {
      setFeedbackMessage({
        kind: 'error',
        message: 'Plan import not available.',
      });
      return;
    }

    input.value = '';
    input.click();
  }, [setFeedbackMessage]);

  const exportRuntimeAgentPlan = useCallback((): void => {
    if (runtimePlan === null) {
      setFeedbackMessage({
        kind: 'error',
        message: 'No plan loaded.',
      });
      return;
    }

    try {
      const payload = JSON.stringify({
        schemaVersion: RUNTIME_AGENT_PLAN_STORAGE_SCHEMA_VERSION,
        plan: runtimePlan,
        enabledAgents: runtimePlanEnabledAgentsRef.current,
        createdAt: new Date().toISOString(),
      });
      const blob = new Blob([payload], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `agents-ultra-agent-plan-${runtimePlanName.replace(/\W+/g, '-')}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(url);
      setFeedbackMessage({
        kind: 'success',
        message: 'Plan export started.',
      });
    } catch {
      setFeedbackMessage({
        kind: 'error',
        message: 'Unable to export plan.',
      });
    }
  }, [runtimePlan, runtimePlanName, setFeedbackMessage]);

  const copyRuntimeAgentPlanToClipboard = useCallback(async (): Promise<void> => {
    if (runtimePlan === null) {
      setFeedbackMessage({
        kind: 'error',
        message: 'No plan loaded.',
      });
      return;
    }

    const clipboard = window.navigator.clipboard;
    if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
      setFeedbackMessage({
        kind: 'error',
        message: 'Clipboard write is not available in this browser.',
      });
      return;
    }

    try {
      const payload = JSON.stringify({
        schemaVersion: RUNTIME_AGENT_PLAN_STORAGE_SCHEMA_VERSION,
        plan: runtimePlan,
        enabledAgents: runtimePlanEnabledAgentsRef.current,
        createdAt: new Date().toISOString(),
      });
      await clipboard.writeText(payload);
      setFeedbackMessage({
        kind: 'success',
        message: 'Plan copied to clipboard.',
      });
    } catch {
      setFeedbackMessage({
        kind: 'error',
        message: 'Unable to copy plan to clipboard.',
      });
    }
  }, [runtimePlan, setFeedbackMessage]);

  const importRuntimePlanFromClipboard = useCallback(async (): Promise<void> => {
    const clipboard = window.navigator.clipboard;
    if (clipboard === undefined || typeof clipboard.readText !== 'function') {
      setFeedbackMessage({
        kind: 'error',
        message: 'Clipboard read is not available in this browser.',
      });
      return;
    }

    try {
      const payloadText = await clipboard.readText();
      if (payloadText.trim().length === 0) {
        setFeedbackMessage({
          kind: 'error',
          message: 'Clipboard is empty.',
        });
        return;
      }

      await importRuntimePlanText(payloadText);
    } catch {
      setFeedbackMessage({
        kind: 'error',
        message: 'Unable to read plan from clipboard.',
      });
    }
  }, [importRuntimePlanText, setFeedbackMessage]);

  const loadRuntimePlanFromStorage = useCallback((): void => {
    try {
      const readResult = readRuntimeAgentPlanPayloadFromStorage(RUNTIME_AGENT_PLAN_STORAGE_KEY);
      const warningSuffix = formatRuntimeAgentPlanWarnings(readResult.warnings);
      if (readResult.status === 'missing') {
        hydrateRuntimePlan(null);
        return;
      }

      if (readResult.status === 'invalid') {
        hydrateRuntimePlan(null);
        setFeedbackMessage({
          kind: 'error',
          message: `Plan data is invalid.${warningSuffix}`,
        });
        return;
      }

      hydrateRuntimePlan(readResult.plan, readResult.enabledAgents);
      setFeedbackMessage({
        kind: 'success',
        message: `Loaded stored plan.${warningSuffix}`,
      });
    } catch {
      hydrateRuntimePlan(null);
      setFeedbackMessage({
        kind: 'error',
        message: 'Unable to load stored plan.',
      });
    }
  }, [hydrateRuntimePlan, setFeedbackMessage]);

  const restartRuntimePlanRunner = useCallback((nextDelayMs: number): void => {
    if (!runtimePlanRunningRef.current) {
      return;
    }

    if (runtimePlanIntervalRef.current !== null) {
      window.clearInterval(runtimePlanIntervalRef.current);
      runtimePlanIntervalRef.current = null;
    }

    const runner = runtimePlanRunnerRef.current;
    if (runner === null) {
      return;
    }

    runtimePlanIntervalRef.current = window.setInterval(() => {
      const activeRunner = runtimePlanRunnerRef.current;
      if (activeRunner !== null) {
        activeRunner();
      }
    }, clampRuntimePlanStepDelayMs(nextDelayMs));
  }, []);

  const resolveRuntimePlanStepDelayMsForAgent = useCallback((agent: string | undefined): number => {
    if (agent !== undefined && agent.trim().length > 0) {
      const delayMs = runtimePlanAgentStepDelayMsRef.current[agent];
      if (typeof delayMs === 'number' && delayMs > 0) {
        return delayMs;
      }
    }
    return runtimePlanStepDelayMs;
  }, [runtimePlanStepDelayMs]);

  const runRuntimeAgentPlanCommand = useCallback((command: RuntimeAgentPlanCommand): { ok: boolean; message: string } => {
    const sim = simulationRef.current;
    const controller = controllerRef.current;

    if (sim === null || sim === undefined || controller === null) {
      return {
        ok: false,
        message: 'Runtime not ready.',
      };
    }

    if (command.type === 'select') {
      const nextKind = command.tool === 'none' ? null : command.tool;
      controller.selectKind(nextKind as EntityKind | null);
      return {
        ok: true,
        message: nextKind === null ? 'selection cleared' : `selected ${nextKind}`,
      };
    }

    if (command.type === 'rotate') {
      const normalizedSteps = ((command.steps % 4) + 4) % 4;
      if (normalizedSteps === 0) {
        return {
          ok: true,
          message: 'no rotation change',
        };
      }
      for (let index = 0; index < normalizedSteps; index += 1) {
        controller.rotate();
      }
      return {
        ok: true,
        message: `rotated ${command.steps} step(s)`,
      };
    }

    if (command.type === 'set-rotation') {
      controller.setRotation(command.rotation);
      return {
        ok: true,
        message: `rotation set to ${ROTATION_TO_DIRECTION[command.rotation]}`,
      };
    }

    if (command.type === 'place' || command.type === 'remove') {
      if (command.tool !== undefined && command.tool !== null && command.type === 'place') {
        controller.selectKind(command.tool);
      }
      if (command.rotation !== undefined) {
        controller.setRotation(command.rotation);
      }

      const tile = {
        x: command.x,
        y: command.y,
      };
      controller.setCursor(tile);
      const outcome = command.type === 'place'
        ? controller.clickLMB()
        : controller.clickRMB();

      if (outcome.ok) {
        return {
          ok: true,
          message: command.type === 'place' ? 'placed entity' : 'removed entity',
        };
      }

      return {
        ok: false,
        message: outcome.message,
      };
    }

    if (command.type === 'move') {
      const runtime = sim as { movePlayer?: (direction: RuntimeDirection) => CoreActionOutcome };
      if (typeof runtime.movePlayer !== 'function') {
        return {
          ok: false,
          message: 'move command unavailable',
        };
      }

      const outcome = runtime.movePlayer(command.direction);
      if (outcome?.ok !== true) {
        return {
          ok: false,
          message: String(outcome?.reason ?? outcome?.reasonCode ?? 'blocked'),
        };
      }

      return {
        ok: true,
        message: `moved ${command.direction}`,
      };
    }

    if (command.type === 'step') {
      const runtime = sim as RuntimeSimulation;
      if (typeof runtime.stepTicks !== 'function') {
        return {
          ok: false,
          message: 'step command unavailable',
        };
      }

      const outcome = runtime.stepTicks(command.ticks);
      if (outcome?.ok !== true) {
        return {
          ok: false,
          message: String(outcome?.reason ?? 'step failed'),
        };
      }

      return {
        ok: true,
        message: `advanced ${command.ticks} tick(s)`,
      };
    }

    if (command.type === 'interact') {
      if (command.action === 'refuel') {
        const withRefuel = sim as { refuel?: () => CoreActionOutcome };
        if (typeof withRefuel.refuel !== 'function') {
          return {
            ok: false,
            message: 'refuel action unavailable',
          };
        }

        const outcome = withRefuel.refuel();
        if (outcome?.ok !== true) {
          return {
            ok: false,
            message: String(outcome?.reason ?? outcome?.reasonCode ?? 'refuel failed'),
          };
        }

        return {
          ok: true,
          message: 'refueled',
        };
      }

      if (command.x === undefined || command.y === undefined) {
        const genericOutcome = command.action === 'pickup'
          ? (sim as { pickupItem?: () => CoreActionOutcome }).pickupItem
          : (sim as { depositItem?: () => CoreActionOutcome }).depositItem;

        if (typeof genericOutcome !== 'function') {
          return {
            ok: false,
            message: `${command.action} action unavailable`,
          };
        }

        const outcome = genericOutcome();
        if (outcome?.ok !== true) {
          return {
            ok: false,
            message: String(outcome?.reason ?? outcome?.reasonCode ?? `${command.action} failed`),
          };
        }

        return {
          ok: true,
          message: `${command.action} done`,
        };
      }

      const withTileInteraction = (
        (sim as {
          interactWithItemHostAtTile?: (tile: Tile, action: 'pickup' | 'deposit') => CoreActionOutcome;
          interactWithChestAtTile?: (tile: Tile, action: 'pickup' | 'deposit') => CoreActionOutcome;
        }).interactWithItemHostAtTile
        ?? (sim as { interactWithChestAtTile?: (tile: Tile, action: 'pickup' | 'deposit') => CoreActionOutcome }).interactWithChestAtTile
      );
      if (typeof withTileInteraction !== 'function') {
        return {
          ok: false,
          message: 'tile interaction unavailable',
        };
      }

      const outcome = withTileInteraction(
        {
          x: command.x,
          y: command.y,
        },
        command.action,
      );
      if (outcome?.ok !== true) {
        return {
          ok: false,
          message: String(outcome?.reason ?? outcome?.reasonCode ?? `${command.action} failed`),
        };
      }

      return {
        ok: true,
        message: `${command.action} done at (${command.x}, ${command.y})`,
      };
    }

    if (command.type === 'pause' || command.type === 'resume' || command.type === 'toggle-pause') {
      if (typeof sim.togglePause !== 'function') {
        return {
          ok: false,
          message: 'pause command unavailable',
        };
      }

      const paused = getSimulationPaused(sim);
      if (command.type === 'pause' && paused) {
        return {
          ok: true,
          message: 'already paused',
        };
      }

      if (command.type === 'resume' && !paused) {
        return {
          ok: true,
          message: 'already running',
        };
      }

      sim.togglePause();
      return {
        ok: true,
        message: command.type,
      };
    }

    if (command.type === 'enable-agent' || command.type === 'disable-agent') {
      const targetAgent = command.targetAgent.trim();
      if (targetAgent.length === 0) {
        return {
          ok: false,
          message: 'Target agent is missing.',
        };
      }

      const nextEnabledAgents = {
        ...runtimePlanEnabledAgentsRef.current,
        [targetAgent]: command.type === 'enable-agent',
      };
      runtimePlanEnabledAgentsRef.current = nextEnabledAgents;
      setRuntimePlanEnabledAgents(nextEnabledAgents);

      const plan = runtimePlanRef.current;
      if (plan !== null) {
        writeRuntimeAgentPlanStoragePayload(plan, nextEnabledAgents);
      }

      return {
        ok: true,
        message: `${targetAgent} ${command.type === 'enable-agent' ? 'enabled' : 'disabled'} in plan execution.`,
      };
    }

    if (command.type === 'set-plan-speed') {
      const nextDelay = clampRuntimePlanStepDelayMs(command.delayMs);
      setRuntimePlanStepDelayMs(nextDelay);
      restartRuntimePlanRunner(nextDelay);
      return {
        ok: true,
        message: `plan speed set to ${nextDelay}ms`,
      };
    }

    if (command.type === 'set-agent-speed') {
      const executionState = runtimePlanExecutionStateRef.current;
      if (executionState === null) {
        return {
          ok: false,
          message: 'Plan execution state unavailable.',
        };
      }

      if (executionState.commandIndexesByAgent[command.targetAgent] === undefined) {
        return {
          ok: false,
          message: `Cannot set speed: no runtime plan commands for agent ${command.targetAgent}.`,
        };
      }

      runtimePlanAgentStepDelayMsRef.current = {
        ...runtimePlanAgentStepDelayMsRef.current,
        [command.targetAgent]: command.delayMs,
      };

      return {
        ok: true,
        message: `${command.targetAgent} speed set to ${command.delayMs}ms`,
      };
    }

    if (command.type === 'set-agent-order') {
      const executionState = runtimePlanExecutionStateRef.current;
      if (executionState === null) {
        return {
          ok: false,
          message: 'Plan execution state unavailable.',
        };
      }

      const nextAgentOrder: string[] = [];
      for (const candidate of command.order) {
        if (executionState.commandIndexesByAgent[candidate] !== undefined) {
          nextAgentOrder.push(candidate);
        }
      }

      if (nextAgentOrder.length === 0) {
        return {
          ok: false,
          message: 'No matching runtime plan agents for order update.',
        };
      }

      runtimePlanExecutionStateRef.current = {
        ...cloneRuntimeAgentPlanExecutionState(executionState),
        agentOrder: nextAgentOrder,
        nextAgentCursor: 0,
      };

      return {
        ok: true,
        message: `agent order set to ${nextAgentOrder.join(', ')}`,
      };
    }

    if (command.type === 'enable-automation' || command.type === 'disable-automation') {
      const nextAutomation = {
        ...automationEnabledRef.current,
        [command.automationAgent]: command.type === 'enable-automation',
      };
      automationEnabledRef.current = nextAutomation;
      setAutomationEnabled(nextAutomation);

      if (command.type === 'disable-automation') {
        const nextStatus = {
          ...automationStatusRef.current,
          [command.automationAgent]: 'idle',
        };
        automationStatusRef.current = nextStatus;
        setAutomationStatus(nextStatus);
      }

      return {
        ok: true,
        message: `${command.automationAgent} ${command.type === 'enable-automation' ? 'enabled' : 'disabled'} in plan execution.`,
      };
    }

    return {
      ok: false,
      message: `Unsupported command ${String(command.type)}`,
    };
  }, [
    restartRuntimePlanRunner,
    setAutomationEnabled,
    setAutomationStatus,
    setRuntimePlanEnabledAgents,
    setRuntimePlanStepDelayMs,
  ]);

  const stopRuntimeAgentPlan = useCallback((): void => {
    const wasRunning = runtimePlanRunningRef.current;
    const totalCommands = runtimePlanRef.current?.commands.length ?? 0;
    if (runtimePlanIntervalRef.current !== null) {
      window.clearInterval(runtimePlanIntervalRef.current);
      runtimePlanIntervalRef.current = null;
    }

    runtimePlanRunningRef.current = false;
    setRuntimePlanRunning(false);
    if (wasRunning) {
      if (runtimePlanProgress >= totalCommands) {
        appendRuntimePlanExecutionLog('Plan reached completion boundary.');
      } else {
        appendRuntimePlanExecutionLog(`Stopped at command ${runtimePlanProgress}/${totalCommands}.`);
      }
    }
  }, [appendRuntimePlanExecutionLog, runtimePlanProgress]);

  const restartRuntimeAgentPlanLoopIfEnabled = useCallback((): boolean => {
    if (!runtimePlanLoop) {
      return false;
    }

    const plan = runtimePlanRef.current;
    if (plan === null || plan.commands.length === 0) {
      return false;
    }

    const enabledAgents = resolveEnabledRuntimePlanAgents(plan, runtimePlanEnabledAgentsRef.current);
    if (enabledAgents.size === 0) {
      stopRuntimeAgentPlan();
      setRuntimePlanStatusMessage('No enabled runtime plan agents.');
      appendRuntimePlanExecutionLog('Plan loop stopped: no enabled runtime plan agents.');
      return false;
    }

    const executionState = createRuntimeAgentPlanExecutionState(plan);
    runtimePlanExecutionStateRef.current = executionState;
    runtimePlanCursorRef.current = 0;
    setRuntimePlanProgress(0);

    const nextRuntimeCommand = peekNextRuntimeAgentPlanCommand(plan, executionState, {
      enabledAgents,
    });
    if (nextRuntimeCommand === null) {
      stopRuntimeAgentPlan();
      setRuntimePlanStatusMessage('No executable runtime plan commands for enabled agents.');
      appendRuntimePlanExecutionLog('Plan loop stopped: no executable runtime plan commands for enabled agents.');
      return false;
    }

    appendRuntimePlanExecutionLog(`Looping ${plan.name ?? 'plan'} from start.`);
    setRuntimePlanStatusMessage(`Looping ${plan.name ?? 'plan'}.`);

    if (runtimePlanRunningRef.current) {
      const nextAgentDelay = resolveRuntimePlanStepDelayMsForAgent(nextRuntimeCommand.agent);
      restartRuntimePlanRunner(nextAgentDelay);
    }

    return true;
  }, [
    appendRuntimePlanExecutionLog,
    restartRuntimePlanRunner,
    resolveRuntimePlanStepDelayMsForAgent,
    runtimePlanLoop,
    stopRuntimeAgentPlan,
  ]);

  const runRuntimeAgentPlanStep = useCallback((): void => {
    const plan = runtimePlanRef.current;
    const cursor = runtimePlanCursorRef.current;
    const executionState = runtimePlanExecutionStateRef.current;

    if (plan === null || plan.commands.length === 0) {
      stopRuntimeAgentPlan();
      setRuntimePlanStatusMessage('No plan loaded.');
      setRuntimePlanProgress(0);
      return;
    }

    if (cursor >= plan.commands.length) {
      setRuntimePlanProgress(plan.commands.length);
      const didLoop = restartRuntimeAgentPlanLoopIfEnabled();
      if (!didLoop) {
        stopRuntimeAgentPlan();
        setRuntimePlanStatusMessage('Plan complete.');
      }
      if (didLoop) {
        return;
      }
      return;
    }

    if (executionState === null) {
      runtimePlanExecutionStateRef.current = createRuntimeAgentPlanExecutionState(plan);
    }

    const resolvedExecutionState = runtimePlanExecutionStateRef.current;
    if (resolvedExecutionState === null) {
      stopRuntimeAgentPlan();
      setRuntimePlanStatusMessage('Plan execution failed.');
      setRuntimePlanProgress(0);
      return;
    }

    const enabledAgents = resolveEnabledRuntimePlanAgents(plan, runtimePlanEnabledAgentsRef.current);
    if (enabledAgents.size === 0) {
      stopRuntimeAgentPlan();
      setRuntimePlanStatusMessage('No enabled runtime plan agents.');
      return;
    }

    const nextRuntimeCommand = pickNextRuntimeAgentPlanCommand(plan, resolvedExecutionState, {
      enabledAgents,
    });
    if (nextRuntimeCommand === null) {
      runtimePlanCursorRef.current = Math.min(cursor, plan.commands.length);
      setRuntimePlanProgress(plan.commands.length);
      const didLoop = restartRuntimeAgentPlanLoopIfEnabled();
      if (!didLoop) {
        stopRuntimeAgentPlan();
        setRuntimePlanStatusMessage('Plan complete.');
      }
      return;
    }

    const { command, commandIndex, agent } = nextRuntimeCommand;
    const outcome = runRuntimeAgentPlanCommand(command);
    const nextCursor = cursor + 1;
    runtimePlanCursorRef.current = nextCursor;
    setRuntimePlanProgress(nextCursor);
    const commandLabel = describeRuntimeAgentPlanCommandForLog(command);
    appendRuntimePlanExecutionLog(`${nextCursor}/${plan.commands.length} ${commandLabel} -> ${outcome.message}`);

    if (outcome.ok) {
      setRuntimePlanStatusMessage(`Command ${nextCursor}/${plan.commands.length} (${agent}): ${outcome.message}`);
      if (isRuntimeAgentPlanCommandStateMutating(command)) {
        appendRuntimeHistorySnapshot();
      }
      syncHudFromSimulation();
      syncPaletteFromController();
      syncGhostFromController();

      if (nextCursor >= plan.commands.length) {
        const didLoop = restartRuntimeAgentPlanLoopIfEnabled();
        if (!didLoop) {
          stopRuntimeAgentPlan();
          setRuntimePlanStatusMessage('Plan complete.');
        }
        return;
      }

      if (commandIndex >= plan.commands.length) {
        const didLoop = restartRuntimeAgentPlanLoopIfEnabled();
        if (!didLoop) {
          stopRuntimeAgentPlan();
          setRuntimePlanStatusMessage('Plan complete.');
        }
        return;
      }

      const upcoming = peekNextRuntimeAgentPlanCommand(plan, resolvedExecutionState, {
        enabledAgents,
      });
      if (upcoming !== null) {
        const nextAgentDelay = resolveRuntimePlanStepDelayMsForAgent(upcoming.agent);
        restartRuntimePlanRunner(nextAgentDelay);
      }
      return;
    }

    stopRuntimeAgentPlan();
    appendRuntimePlanExecutionLog(`failed at ${nextCursor}/${plan.commands.length} (${agent}): ${outcome.message}`);
    setRuntimePlanStatusMessage(
      `Plan failed at ${nextCursor}/${plan.commands.length} (${agent}): ${outcome.message} (${commandIndex})`,
    );
    setFeedbackMessage({
      kind: 'error',
      message: `Plan failed at step ${nextCursor}: ${outcome.message}`,
    });
  }, [
    runRuntimeAgentPlanCommand,
    appendRuntimeHistorySnapshot,
    syncGhostFromController,
    syncHudFromSimulation,
    syncPaletteFromController,
    appendRuntimePlanExecutionLog,
    stopRuntimeAgentPlan,
    restartRuntimeAgentPlanLoopIfEnabled,
    setFeedbackMessage,
    resolveRuntimePlanStepDelayMsForAgent,
    restartRuntimePlanRunner,
  ]);

  runtimePlanRunnerRef.current = runRuntimeAgentPlanStep;

  const startRuntimeAgentPlan = useCallback((): void => {
    const plan = runtimePlanRef.current;
    if (plan === null) {
      setFeedbackMessage({
        kind: 'error',
        message: 'No plan loaded.',
      });
      return;
    }

    if (plan.commands.length === 0) {
      setFeedbackMessage({
        kind: 'error',
        message: 'Plan has no commands.',
      });
      return;
    }

    if (runtimePlanExecutionStateRef.current === null) {
      runtimePlanExecutionStateRef.current = createRuntimeAgentPlanExecutionState(plan);
    }

    const enabledAgents = resolveEnabledRuntimePlanAgents(plan, runtimePlanEnabledAgentsRef.current);
    if (enabledAgents.size === 0) {
      setFeedbackMessage({
        kind: 'error',
        message: 'No enabled runtime plan agents.',
      });
      return;
    }

    if (runtimePlanCursorRef.current >= plan.commands.length) {
      runtimePlanCursorRef.current = 0;
      runtimePlanExecutionStateRef.current = createRuntimeAgentPlanExecutionState(plan);
      setRuntimePlanProgress(0);
      clearRuntimePlanExecutionLog();
      setRuntimePlanStatusMessage('Starting fresh plan execution...');
    }

    if (runtimePlanCursorRef.current === 0 && (runtimePlanExecutionStateRef.current === null || runtimePlanProgress === 0)) {
      clearRuntimePlanExecutionLog();
    }

    if (runtimePlanRunningRef.current) {
      return;
    }

    runtimePlanRunningRef.current = true;
    setRuntimePlanRunning(true);
    setRuntimePlanStatusMessage(`Starting ${plan.name ?? 'plan'} at ${runtimePlanStepDelayMs}ms/command.`);

    if (runtimePlanIntervalRef.current !== null) {
      window.clearInterval(runtimePlanIntervalRef.current);
      runtimePlanIntervalRef.current = null;
    }

    restartRuntimePlanRunner(runtimePlanStepDelayMs);
    appendRuntimePlanExecutionLog(`Starting ${plan.name ?? 'plan'} at ${runtimePlanStepDelayMs}ms/command.`);
  }, [
    appendRuntimePlanExecutionLog,
    clearRuntimePlanExecutionLog,
    restartRuntimePlanRunner,
    runRuntimeAgentPlanStep,
    runtimePlanProgress,
    runtimePlanStepDelayMs,
    setFeedbackMessage,
  ]);

  const clearRuntimePlan = useCallback((): void => {
    hydrateRuntimePlan(null);
    clearRuntimePlanExecutionLog();
    setFeedbackMessage({
      kind: 'success',
      message: 'Plan cleared.',
    });

    const removed = removeRuntimeStorageItem(RUNTIME_AGENT_PLAN_STORAGE_KEY);
    if (!removed) {
      setFeedbackMessage({
        kind: 'error',
        message: 'Unable to clear stored plan.',
      });
    }
  }, [clearRuntimePlanExecutionLog, setFeedbackMessage, hydrateRuntimePlan]);

  const handleRuntimePlanEnabledAgentChange = useCallback((agent: string, checked: boolean): void => {
    setRuntimePlanEnabledAgents((current) => {
      const next = {
        ...current,
        [agent]: checked,
      };
      runtimePlanEnabledAgentsRef.current = next;
      const plan = runtimePlanRef.current;
      if (plan !== null) {
        writeRuntimeAgentPlanStoragePayload(plan, next);
      }
      return next;
    });
  }, []);

  const setAllRuntimePlanEnabledAgents = useCallback((checked: boolean): void => {
    const plan = runtimePlanRef.current;
    if (plan === null) {
      return;
    }

    const executionState = runtimePlanExecutionStateRef.current ?? createRuntimeAgentPlanExecutionState(plan);
    const next = executionState.agentOrder.reduce<RuntimeAgentPlanEnabledAgents>((accumulator, agent) => {
      accumulator[agent] = checked;
      return accumulator;
    }, {});
    runtimePlanEnabledAgentsRef.current = next;
    setRuntimePlanEnabledAgents(next);
    const selectedPlan = plan;
    if (selectedPlan !== null) {
      writeRuntimeAgentPlanStoragePayload(selectedPlan, next);
    }
  }, []);

  const loadRuntimeFromSlot = useCallback((slot: number): void => {
    if (!isRuntimeSaveSlotIndex(slot)) {
      setFeedbackMessage({
        kind: 'error',
        message: `Invalid save slot ${String(slot)}.`,
      });
      return;
    }

    try {
      const readResult = readRuntimeSaveFromStorage(getSaveSlotStorageKey(slot));
      if (readResult.status === 'missing') {
        refreshRuntimeSaveSlots();
        setFeedbackMessage({
          kind: 'error',
          message: `No save found in slot ${slot + 1}.`,
        });
        return;
      }

      if (readResult.status === 'invalid') {
        refreshRuntimeSaveSlots();
        setFeedbackMessage({
          kind: 'error',
          message: `Invalid state in slot ${slot + 1}.`,
        });
        return;
      }

      const loaded = loadRuntimeFromPayload(readResult.parsed);
      if (loaded === null) {
        return;
      }

      setActiveSaveSlot(slot);
      const compatibilitySummary = describeRuntimeSaveCompatibilityWarnings(loaded);
      const stateSummary = describeRuntimeSaveStateSummary(readResult.parsed);
      const suffix = compatibilitySummary === '' ? '' : ` ${compatibilitySummary}`;
      setFeedbackMessage({
        kind: 'success',
        message: `Loaded slot ${slot + 1}. (${stateSummary})${suffix}`,
      });
    } catch {
      setFeedbackMessage({
        kind: 'error',
        message: `Unable to load slot ${slot + 1}.`,
      });
    }
  }, [loadRuntimeFromPayload, refreshRuntimeSaveSlots, setActiveSaveSlot, setFeedbackMessage]);

  const clearRuntimeSaveSlot = useCallback((slot: number): void => {
    if (!isRuntimeSaveSlotIndex(slot)) {
      setFeedbackMessage({
        kind: 'error',
        message: `Invalid save slot ${String(slot)}.`,
      });
      return;
    }

    const removed = removeRuntimeStorageItem(getSaveSlotStorageKey(slot));
    if (!removed) {
      setFeedbackMessage({
        kind: 'error',
        message: `Unable to clear slot ${slot + 1}.`,
      });
      return;
    }

    refreshRuntimeSaveSlots();
    setFeedbackMessage({
      kind: 'success',
      message: `Cleared slot ${slot + 1}.`,
    });
  }, [refreshRuntimeSaveSlots, setFeedbackMessage]);

  const cycleSaveSlot = useCallback(
    (delta: number): number => {
      const current = normalizeRuntimeSaveSlotIndex(activeSaveSlotRef.current, SAVE_SLOT_INDEX_FALLBACK);
      const next = (current + delta) % RUNTIME_SAVE_SLOT_COUNT;
      const nextSlot = next < 0 ? next + RUNTIME_SAVE_SLOT_COUNT : next;
      activeSaveSlotRef.current = nextSlot;
      setActiveSaveSlot(nextSlot);
      return nextSlot;
    },
    [setActiveSaveSlot],
  );

  const resetRuntime = useCallback((): void => {
    const runtime = simulationRef.current as RuntimeSimulation;
    if (typeof runtime.reset === 'function') {
      runtime.reset();
    }

    setTutorialMissions(createInitialTutorialMissionState());
    tutorialMissionBaselineRef.current = null;
    tutorialMoveOriginRef.current = null;
    replaceHistoryWithCurrentState();
    syncHudFromSimulation();
    setFeedbackMessage({
      kind: 'success',
      message: 'Runtime reset.',
    });
  }, [setFeedbackMessage, syncHudFromSimulation, replaceHistoryWithCurrentState]);

  useEffect(() => {
    loadRuntimePlanFromStorage();
  }, [loadRuntimePlanFromStorage]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;

    if (!container || !canvas) {
      return;
    }

    const sim = getSimulation();
    const controller = createPlacementController(sim);
    window.__USE_SVGS__ = useSvgs;
    if (useSvgs) {
      preloadRendererSvgs();
    }
    const renderer = createRenderer(canvas) as unknown as RendererApi;

    simulationRef.current = sim;
    controllerRef.current = controller;
    rendererRef.current = renderer;
    const runtimeWithRenderHook = sim as {
      setRuntimeRenderCallback?: (callback: (() => void) | null) => void;
    };
    const requestSimulationRender = (): void => {
      syncPauseHudFromSimulation();
      renderer.requestRender?.();
    };
    runtimeWithRenderHook.setRuntimeRenderCallback?.(requestSimulationRender);

    const initialKind = ALL_ENTITY_KINDS[0];
    if (initialKind !== undefined) {
      controller.selectKind(initialKind);
    }

    const syncFromController = (): void => {
      syncPaletteFromController();
      syncGhostFromController();
      syncHudFromSimulation();
    };

    const tileToCanvas = (tile: Tile): { x: number; y: number } | null => {
      return tileToScreenPoint(tile, canvas, cameraRef.current);
    };
    (sim as {
      getTileScreenPoint?: (tile: Tile) => { x: number; y: number } | null;
      getTileCanvasPoint?: (tile: Tile) => { x: number; y: number } | null;
    }).getTileScreenPoint = tileToCanvas;
    (sim as {
      getTileScreenPoint?: (tile: Tile) => { x: number; y: number } | null;
      getTileCanvasPoint?: (tile: Tile) => { x: number; y: number } | null;
    }).getTileCanvasPoint = tileToCanvas;

    const resizeCanvas = (): void => {
      const width = Math.max(1, Math.floor(container.clientWidth));
      const height = Math.max(1, Math.floor(container.clientHeight));

      if (canvas.width !== width) {
        canvas.width = width;
      }
      if (canvas.height !== height) {
        canvas.height = height;
      }

      renderer.resize?.(width, height);
      syncGhostFromController();
    };

    const onPointerMove = (event: PointerEvent): void => {
      controller.setCursor(pointerToTile(event, canvas, cameraRef.current));
      syncGhostFromController();
    };

    const onPointerLeave = (): void => {
      controller.setCursor(null);
      syncGhostFromController();
    };

    const resolveTileFromPointerEvent = (event: { clientX: number; clientY: number }): Tile | null => {
      return pointerToTile(event as PointerEvent, canvas, cameraRef.current);
    };

    const runCanvasPrimaryAction = (event: {
      clientX: number;
      clientY: number;
      timeStamp?: number;
    }): void => {
      const tile = resolveTileFromPointerEvent(event);
      const now = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
      const tileKey = tile === null ? "null" : `${tile.x},${tile.y}`;
      const previous = inputActionEventRef.current;
      if (
        previous !== null &&
        previous.button === "primary" &&
        previous.tile === tileKey &&
        now - previous.time < 75
      ) {
        return;
      }
      inputActionEventRef.current = {
        time: now,
        tile: tileKey,
        button: "primary",
      };
      runPrimaryActionAtTile(tile);
    };

    const runCanvasSecondaryAction = (event: {
      clientX: number;
      clientY: number;
      timeStamp?: number;
    }): void => {
      const tile = resolveTileFromPointerEvent(event);
      const now = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
      const tileKey = tile === null ? "null" : `${tile.x},${tile.y}`;
      const previous = inputActionEventRef.current;
      if (
        previous !== null &&
        previous.button === "secondary" &&
        previous.tile === tileKey &&
        now - previous.time < 75
      ) {
        return;
      }
      inputActionEventRef.current = {
        time: now,
        tile: tileKey,
        button: "secondary",
      };
      runSecondaryActionAtTile(tile);
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button === 0) {
        event.preventDefault();
        runCanvasPrimaryAction(event);
        return;
      }

      if (event.button === 2) {
        event.preventDefault();
        runCanvasSecondaryAction(event);
      }
    };

    const onMouseDown = (event: MouseEvent): void => {
      if (event.button === 0) {
        event.preventDefault();
        runCanvasPrimaryAction(event);
        return;
      }

      if (event.button === 2) {
        event.preventDefault();
        runCanvasSecondaryAction(event);
      }
    };

    const shouldUsePointerEvents = typeof window.PointerEvent !== 'undefined';

    const onContextMenu = (event: MouseEvent): void => {
      event.preventDefault();
    };

    const syncToolCycle = (direction: number, options?: { announce?: boolean }): void => {
      const controllerState = controller.getState();
      const currentKind = controllerState.selectedKind;
      const currentIndex = currentKind === null ? -1 : RUNTIME_TOOL_CYCLE_ORDER.indexOf(currentKind);
      const toolCount = RUNTIME_TOOL_CYCLE_ORDER.length;
      if (toolCount === 0) {
        return;
      }

      const directionStep = direction >= 0 ? 1 : -1;
      const currentSafeIndex = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex = (currentSafeIndex + directionStep + toolCount) % toolCount;
      const nextKind = RUNTIME_TOOL_CYCLE_ORDER[nextIndex];
      const safeKind = nextKind ?? RUNTIME_TOOL_CYCLE_ORDER[0];

      controller.selectKind(safeKind);
      markTutorialMissionComplete('select-tool');
      const selectedIndex = RUNTIME_TOOL_CYCLE_ORDER.indexOf(safeKind) + 1;
      if (options?.announce !== false) {
        setFeedbackMessage({
          kind: 'success',
          message: `Selected ${safeKind} (tool ${selectedIndex}/${toolCount})`,
        });
      }
      syncFromController();
    };

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      if (event.deltaY === 0) {
        return;
      }
      zoomCamera(event.deltaY < 0 ? CAMERA_ZOOM_STEP : -CAMERA_ZOOM_STEP, 'player');
    };

    const resolveRuntimeSaveSlotFromCode = (code: string): number | null => {
      if (code.startsWith('Digit')) {
        const value = Number(code.slice(5));
        if (Number.isInteger(value) && value >= 1 && value <= RUNTIME_SAVE_SLOT_COUNT) {
          return value - 1;
        }
      }

      if (code.startsWith('Numpad')) {
        const value = Number(code.slice(6));
        if (Number.isInteger(value) && value >= 1 && value <= RUNTIME_SAVE_SLOT_COUNT) {
          return value - 1;
        }
      }

      return null;
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable) {
        return;
      }

      const controlLike = event.ctrlKey || event.metaKey;
      if (controlLike && event.code === 'KeyZ') {
        if (event.shiftKey) {
          redoRuntimeHistory();
        } else {
          undoRuntimeHistory();
        }
        event.preventDefault();
        return;
      }

      if (controlLike && event.code === 'KeyY') {
        redoRuntimeHistory();
        event.preventDefault();
        return;
      }

      if (event.ctrlKey && event.shiftKey && event.code === 'KeyC') {
        void copyRuntimeSaveToClipboard();
        event.preventDefault();
        return;
      }

      if (event.ctrlKey && event.shiftKey && event.code === 'KeyV') {
        void pasteRuntimeSaveFromClipboard();
        event.preventDefault();
        return;
      }

      if (event.ctrlKey && event.shiftKey && event.code === 'KeyB') {
        void copyRuntimeBlueprintToClipboard();
        event.preventDefault();
        return;
      }

      if (event.ctrlKey && event.shiftKey && event.code === 'KeyU') {
        void copyRuntimeSaveShareLink();
        event.preventDefault();
        return;
      }

      if (event.ctrlKey && event.shiftKey && event.code === 'KeyL') {
        void copyRuntimeBlueprintShareLink();
        event.preventDefault();
        return;
      }

      if (event.ctrlKey && event.shiftKey && event.code === 'KeyO') {
        void pasteRuntimeSaveShareLinkFromClipboard();
        event.preventDefault();
        return;
      }

      if (event.ctrlKey && event.shiftKey && event.code === 'KeyI') {
        void pasteRuntimeBlueprintShareLinkFromClipboard();
        event.preventDefault();
        return;
      }

      if (event.ctrlKey && event.shiftKey && event.code === 'KeyP') {
        void pasteRuntimeBlueprintFromClipboard();
        event.preventDefault();
        return;
      }

      if (event.code === 'Digit0' || event.code === 'Numpad0' || event.code === 'Escape') {
        if (event.code === 'Escape' && shortcutOverlayOpen) {
          setShortcutOverlayOpen(false);
          event.preventDefault();
          return;
        }
        clearSelectedTool();
        event.preventDefault();
        return;
      }

      const saveSlotIndex = resolveRuntimeSaveSlotFromCode(event.code);
      if (saveSlotIndex !== null) {
        if (event.ctrlKey || event.metaKey) {
          if (event.shiftKey) {
            persistRuntimeSaveToSlot(saveSlotIndex);
          } else {
            activeSaveSlotRef.current = saveSlotIndex;
            setActiveSaveSlot(saveSlotIndex);
            setFeedbackMessage({
              kind: 'success',
              message: `Active save slot: ${saveSlotIndex + 1}.`,
            });
          }
          event.preventDefault();
          return;
        }

        if (event.altKey) {
          loadRuntimeFromSlot(saveSlotIndex);
          event.preventDefault();
          return;
        }
      }

      if (event.code in HOTKEY_TO_KIND) {
        const hotkey = event.code as keyof typeof HOTKEY_TO_KIND;
        toggleToolKind(HOTKEY_TO_KIND[hotkey], false);
        syncFromController();
        event.preventDefault();
        return;
      }

      if (event.code === 'KeyR') {
        rotateRuntimeTool();
        event.preventDefault();
        return;
      }

      if (event.code === 'KeyH') {
        setShowHud((current) => {
          const next = !current;
          setFeedbackMessage({
            kind: 'success',
            message: next ? 'HUD shown.' : 'HUD hidden.',
          });
          return next;
        });
        event.preventDefault();
        return;
      }

      if (event.code === 'KeyT') {
        setReducedMotionEnabled((current) => {
          const next = !current;
          setFeedbackMessage({
            kind: 'success',
            message: next ? 'Reduced motion enabled.' : 'Reduced motion disabled.',
          });
          return next;
        });
        event.preventDefault();
        return;
      }

      if (event.code === 'Space') {
        togglePauseFromControls();
        event.preventDefault();
        return;
      }

      if (event.code === 'KeyP') {
        togglePauseFromControls();
        event.preventDefault();
        return;
      }

      if (event.code === 'KeyM') {
        if (event.altKey) {
          const next = !cameraAutoFollowRef.current;
          cameraAutoFollowRef.current = next;
          setCameraAutoFollow(next);
          setFeedbackMessage({
            kind: 'success',
            message: next ? 'Auto-follow enabled.' : 'Auto-follow disabled.',
          });
        } else {
          setCameraToPlayer();
          setFeedbackMessage({
            kind: 'success',
            message: 'Camera centered on player.',
          });
        }
        syncHudFromSimulation();
        event.preventDefault();
        return;
      }

      if (event.code === 'Home') {
        setCameraToSpawn();
        setFeedbackMessage({
          kind: 'success',
          message: 'Camera centered on spawn.',
        });
        event.preventDefault();
        return;
      }

      if (event.code === 'Minus' || event.code === 'NumpadSubtract') {
        const nextSlot = cycleSaveSlot(-1);
        setFeedbackMessage({
          kind: 'success',
          message: `Active save slot: ${nextSlot + 1}.`,
        });
        event.preventDefault();
        return;
      }

      if (event.code === 'Equal' || event.code === 'NumpadAdd') {
        const nextSlot = cycleSaveSlot(1);
        setFeedbackMessage({
          kind: 'success',
          message: `Active save slot: ${nextSlot + 1}.`,
        });
        event.preventDefault();
        return;
      }

      if (event.code === 'End') {
        setCameraToPlayer();
        setFeedbackMessage({
          kind: 'success',
          message: 'Camera centered on player.',
        });
        event.preventDefault();
        return;
      }

      if (event.code === 'KeyK' && !event.ctrlKey && !event.metaKey) {
        const next = !shortcutOverlayOpen;
        setShortcutOverlayOpen(next);
        setFeedbackMessage({
          kind: 'success',
          message: next ? 'Shortcut overlay open.' : 'Shortcut overlay closed.',
        });
        event.preventDefault();
        return;
      }

      if (event.code === 'BracketLeft' || event.code === 'BracketRight') {
        if (event.ctrlKey || event.metaKey || event.altKey) {
          const delta = event.code === 'BracketLeft' ? -CAMERA_ZOOM_STEP : CAMERA_ZOOM_STEP;
          zoomCamera(delta, 'player');
          setFeedbackMessage({
            kind: 'success',
            message: event.code === 'BracketLeft' ? 'Zoomed out.' : 'Zoomed in.',
          });
          syncHudFromSimulation();
        } else {
          syncToolCycle(event.code === 'BracketRight' ? 1 : -1);
        }
        event.preventDefault();
        return;
      }

      if (event.code === 'Tab') {
        const direction = event.shiftKey ? -1 : 1;
        syncToolCycle(direction);
        event.preventDefault();
        return;
      }

      if (event.code === 'Slash' || event.code === 'Period') {
        const runtime = sim as unknown as RuntimeSimulation;
        const steps = event.shiftKey ? 10 : 1;
        const outcome = runtime.stepTicks?.(steps);
        if (outcome?.ok) {
          setFeedbackMessage({
            kind: 'success',
            message: steps === 1 ? 'Advanced 1 tick.' : 'Advanced 10 ticks.',
          });
        } else {
          setFeedbackMessage({
            kind: 'error',
            message: outcome?.reason === undefined ? 'Unable to advance simulation.' : outcome.reason,
          });
        }
        syncHudFromSimulation();
        event.preventDefault();
        return;
      }

      if (event.code in MOVE_HOTKEY_TO_DIRECTION) {
        const direction = MOVE_HOTKEY_TO_DIRECTION[event.code];
        if (!direction) {
          return;
        }
        movePlayerFromDirection(direction);
        event.preventDefault();
        return;
      }

      if (event.code === 'KeyF') {
        const withRefuel = sim as { refuel?: () => CoreActionOutcome };
      if (typeof withRefuel.refuel === 'function') {
          const outcome = withRefuel.refuel();
          if (outcome?.ok) {
            appendRuntimePlanRecordingCommand({
              type: 'interact',
              action: 'refuel',
            });
            markTutorialMissionComplete('refuel');
            appendRuntimeHistorySnapshot();
            setFeedbackMessage({
              kind: 'success',
              message: `Refueled +${PLAYER_REFUEL_AMOUNT} from nearby coal.`,
            });
          } else {
            const reason = String(outcome?.reasonCode ?? 'blocked');
            const message =
              reason === 'fuel_full'
                ? 'Fuel already full.'
                : reason === 'no_fuel_source'
                  ? 'No coal in inventory or adjacent furnace fuel source.'
                  : 'Refuel failed.';
            setFeedbackMessage({
              kind: 'error',
              message,
            });
          }
          syncHudFromSimulation();
          event.preventDefault();
        }
      }

      if (event.code === 'KeyE') {
        const withDeposit = sim as { depositItem?: () => CoreActionOutcome };
      if (typeof withDeposit.depositItem === 'function') {
        const outcome = withDeposit.depositItem();
        if (outcome?.ok) {
          appendRuntimePlanRecordingCommand({
            type: 'interact',
            action: 'deposit',
          });
          markTutorialMissionComplete('transfer-items');
          appendRuntimeHistorySnapshot();
        }
        setFeedbackMessage({
          kind: outcome?.ok === true ? 'success' : 'error',
          message:
              outcome?.reason === undefined || outcome?.reason === null
                ? outcome?.ok === true
                  ? 'Deposited from inventory.'
                  : 'Deposit failed.'
                : outcome.reason,
          });
          syncHudFromSimulation();
          event.preventDefault();
        }
      }

      if (event.code === 'KeyQ') {
        const withPickup = sim as { pickupItem?: () => CoreActionOutcome };
      if (typeof withPickup.pickupItem === 'function') {
        const outcome = withPickup.pickupItem();
        if (outcome?.ok) {
          appendRuntimePlanRecordingCommand({
            type: 'interact',
            action: 'pickup',
          });
          markTutorialMissionComplete('transfer-items');
          appendRuntimeHistorySnapshot();
        }
        setFeedbackMessage({
          kind: outcome?.ok === true ? 'success' : 'error',
          message:
              outcome?.reason === undefined || outcome?.reason === null
                ? outcome?.ok === true
                  ? 'Picked up from chest.'
                  : 'Pickup failed.'
                : outcome.reason,
          });
          syncHudFromSimulation();
          event.preventDefault();
        }
      }

      if (event.code === 'KeyX') {
        runMineInFrontOfPlayer();
        event.preventDefault();
      }
    };

    const hudIntervalId = window.setInterval((): void => {
      const sim = simulationRef.current;
      if (getSimulationPaused(sim)) {
        return;
      }

      syncHudFromSimulation();
      runAutomation();
    }, 250);

    resizeCanvas();
    syncFromController();
    replaceHistoryWithCurrentState();
    refreshRuntimeSaveSlots();
    if (window.location.search.length > 0) {
      loadRuntimeShareFromLocation(window.location.href);
    }

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);
    if (shouldUsePointerEvents) {
      canvas.addEventListener('pointerdown', onPointerDown);
    } else {
      canvas.addEventListener('mousedown', onMouseDown);
    }
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', resizeCanvas);

    return () => {
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      if (shouldUsePointerEvents) {
        canvas.removeEventListener('pointerdown', onPointerDown);
      } else {
        canvas.removeEventListener('mousedown', onMouseDown);
      }
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', resizeCanvas);

      window.clearInterval(hudIntervalId);
      renderer.destroy();
      rendererRef.current = null;
      controllerRef.current = null;
      simulationRef.current = NOOP_SIMULATION;
      runtimeWithRenderHook.setRuntimeRenderCallback?.(null);

      const maybeRuntime = window.__SIM__;
      if (
        maybeRuntime &&
        typeof maybeRuntime === 'object' &&
        'destroy' in maybeRuntime &&
        typeof (maybeRuntime as { destroy?: unknown }).destroy === 'function'
      ) {
        (maybeRuntime as { destroy: () => void }).destroy();
      }
      if (feedbackTimeoutRef.current !== null) {
        window.clearTimeout(feedbackTimeoutRef.current);
        feedbackTimeoutRef.current = null;
      }

      if (runtimePlanIntervalRef.current !== null) {
        window.clearInterval(runtimePlanIntervalRef.current);
        runtimePlanIntervalRef.current = null;
      }

      runtimePlanRunningRef.current = false;

      delete window.__SIM__;
    };
  }, [
    setCameraAutoFollow,
    setCameraToPlayer,
    setCameraToSpawn,
    setFeedbackMessage,
    setHudState,
    runPrimaryActionAtTile,
    runSecondaryActionAtTile,
    zoomCamera,
    syncGhostFromController,
    syncHudFromSimulation,
    syncPauseHudFromSimulation,
    syncPaletteFromController,
    markTutorialMissionComplete,
    runAutomation,
    replaceHistoryWithCurrentState,
    refreshRuntimeSaveSlots,
    loadRuntimeShareFromLocation,
  ]);

  const hudToolValue = hud.tool ?? 'None';
  const hudRotationValue = ROTATION_TO_DIRECTION[hud.rotation];
  const hudPauseValue = hud.paused ? 'Paused' : 'Running';
  const hudPanelBottomOffset = showTouchControls ? 136 : 12;
  const rightSidebarStyle = rightSidebarCollapsed
    ? ({
      position: 'absolute',
      right: 12,
      bottom: 12,
      zIndex: 8,
    } as const)
    : ({
      position: 'absolute',
      top: 12,
      right: 12,
      bottom: MINIMAP_HEIGHT + 28,
      zIndex: 8,
      overflowY: 'visible',
      overscrollBehavior: 'contain',
    } as const);
  const tutorialMissionCompletedCount = tutorialMissions.filter((mission) => mission.completed).length;
  const tutorialMissionTotal = tutorialMissions.length;
  const nextTutorialMission = tutorialMissions.find((mission) => !mission.completed) ?? null;
  const canUndoHistory = canUndoRuntimeHistory();
  const canRedoHistory = canRedoRuntimeHistory();
  const runtimeCheckpointCount = runtimeCheckpoints.length;
  const runtimeCheckpointLabel = runtimeCheckpointCount === 1
    ? '1 checkpoint'
    : `${runtimeCheckpointCount} checkpoints`;
  const activeSaveSlotMeta = runtimeSaveSlots.find((entry) => entry.index === activeSaveSlot)
    ?? {
      index: normalizeRuntimeSaveSlotIndex(activeSaveSlot, SAVE_SLOT_INDEX_FALLBACK),
      hasValue: false,
      updatedAt: null,
    };
  const activeSaveSlotHasValue = activeSaveSlotMeta.hasValue;
  const activeSaveSlotLabel = showTutorialHints
    ? `slot ${activeSaveSlotMeta.index + 1}/${RUNTIME_SAVE_SLOT_COUNT}`
    : `S${activeSaveSlotMeta.index + 1}`;
  const activeSaveSlotUpdatedAt = activeSaveSlotMeta.updatedAt;
  const activeSaveSlotUpdatedLabel = activeSaveSlotHasValue
    ? activeSaveSlotUpdatedAt === null
      ? (showTutorialHints ? 'slot has no timestamp' : 'saved')
      : (showTutorialHints ? `saved ${activeSaveSlotUpdatedAt}` : 'saved')
    : (showTutorialHints ? 'slot empty' : 'empty');
  const runtimePlanTotalCommands = runtimePlan?.commands.length ?? 0;
  const runtimePlanProgressLabel = `${runtimePlanProgress}/${runtimePlanTotalCommands}`;
  const runtimePlanCanRun = runtimePlan !== null
    && !runtimePlanRunning
    && !runtimePlanRecording
    && hasEnabledRuntimePlanAgents(runtimePlanEnabledAgents);
  const runtimePlanAgentSummaries = summarizeRuntimePlanAgents(
    runtimePlan,
    runtimePlanExecutionStateRef.current,
    runtimePlanEnabledAgents,
  );
  const runtimePlanNextCommand = (() => {
    if (runtimePlan === null || runtimePlan.commands.length === 0 || runtimePlanCursorRef.current >= runtimePlan.commands.length) {
      return null;
    }

    const executionState = runtimePlanExecutionStateRef.current
      ?? createRuntimeAgentPlanExecutionState(runtimePlan);
    const enabledAgents = resolveEnabledRuntimePlanAgents(runtimePlan, runtimePlanEnabledAgents);
    return peekNextRuntimeAgentPlanCommand(runtimePlan, executionState, {
      enabledAgents,
    });
  })();
  const runtimePlanNextCommandLabel = describeNextRuntimeAgentPlanCommand(runtimePlanNextCommand);
  const runtimePlanAllAgentsEnabled = hasEnabledRuntimePlanAgents(runtimePlanEnabledAgents)
    && runtimePlanAgentSummaries.every((summary) => summary.enabled);
  const hudChestInventory = hud.adjacentChest?.inventory ?? {
    ore: 0,
    plate: 0,
    gear: 0,
    coal: 0,
    wood: 0,
    used: 0,
    capacity: 1,
  };
  const touchControlButtonStyle = {
    width: 38,
    height: 38,
    borderRadius: 6,
    border: 'none',
    background: 'rgba(24, 24, 24, 0.85)',
    color: 'white',
    fontSize: 20,
    lineHeight: 1,
    cursor: 'pointer',
    userSelect: 'none',
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  };
  const touchControlWideButtonStyle = {
    padding: '8px 10px',
    borderRadius: 6,
    border: 'none',
    background: 'rgba(24, 24, 24, 0.85)',
    color: 'white',
    fontSize: 11,
    fontWeight: 'bold',
    cursor: 'pointer',
    userSelect: 'none',
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  };
  if (simulationRef.current === NOOP_SIMULATION) {
    simulationRef.current = getSimulation();
  }
  const sim = simulationRef.current;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
      }}
    >
      <canvas
        ref={canvasRef}
        data-testid={WORLD_CANVAS_TEST_ID}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
        }}
      />
      <canvas
        ref={minimapCanvasRef}
        data-testid="world-minimap"
        aria-label="World minimap"
        title="Click to center camera on this tile"
        width={MINIMAP_WIDTH}
        height={MINIMAP_HEIGHT}
        onPointerDown={(event): void => {
          if (event.pointerType === 'mouse' && event.button !== 0) {
            return;
          }
          event.preventDefault();
          runMinimapNavigate(event);
        }}
        onContextMenu={(event): void => {
          event.preventDefault();
        }}
        style={{
          position: 'absolute',
          right: 12,
          bottom: 12,
          zIndex: 4,
          width: MINIMAP_WIDTH,
          height: MINIMAP_HEIGHT,
          background: '#111',
          border: '1px solid rgba(255,255,255,0.35)',
          borderRadius: 4,
          cursor: 'crosshair',
          imageRendering: 'pixelated',
        }}
      />

      <div
        style={{
          position: 'absolute',
          top: 12,
          left: TOOL_PANEL_LEFT,
          zIndex: 4,
        }}
      >
          <button
            type="button"
            onClick={() => {
              clearSelectedTool();
          }}
          style={{
            marginBottom: 6,
            display: 'block',
            padding: '6px 10px',
            borderRadius: 8,
            border: 'none',
            background: selectedKind === null ? '#4a90e2' : '#444',
            color: 'white',
            cursor: 'pointer',
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            fontSize: 12,
            fontWeight: 'bold',
          }}
          >
            Hand (0/Esc)
          </button>
        <PaletteView selectedKind={selectedKind} onSelectKind={onPaletteSelect} />
      </div>
      <div
        style={rightSidebarStyle}
      >
        <button
          data-testid="control-sidebar-toggle"
          type="button"
          onClick={() => {
            setRightSidebarCollapsed((current) => !current);
          }}
          style={{
            marginBottom: rightSidebarCollapsed ? 0 : 6,
            padding: '6px 10px',
            borderRadius: 6,
            border: 'none',
            background: rightSidebarCollapsed ? '#4a90e2' : '#4a90e2',
            color: 'white',
            cursor: 'pointer',
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            fontSize: 11,
            fontWeight: 'bold',
            width: rightSidebarCollapsed ? 'auto' : '100%',
          }}
        >
          {rightSidebarCollapsed ? 'Expand Controls' : 'Collapse Controls'}
        </button>
        <div
          style={{
            display: rightSidebarCollapsed ? 'none' : 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
        <button
          onClick={() => {
            const current = !!window.__USE_SVGS__;
            window.__USE_SVGS__ = !current;
            setUseSvgs(!current);
          }}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: 'none',
            background: useSvgs ? '#228B22' : '#444',
            color: 'white',
            cursor: 'pointer',
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            fontSize: 14,
            fontWeight: 'bold',
            boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
          }}
        >
          {useSvgs ? 'SVGs Enabled' : 'Enable SVGs'}
        </button>
        <button
          onClick={() => {
            setShowTutorialHints((current) => !current);
          }}
          style={{
            marginTop: 6,
            padding: '6px 12px',
            borderRadius: 8,
            border: 'none',
            background: showTutorialHints ? '#f39c12' : '#444',
            color: 'white',
            cursor: 'pointer',
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            fontSize: 12,
            fontWeight: 'bold',
          }}
        >
          {showTutorialHints ? 'Tutorial Mode: On' : 'Tutorial Mode: Off'}
        </button>
        <div
          style={{
            marginTop: 8,
            display: 'grid',
            gridTemplateColumns: '1fr',
            gap: 6,
          }}
        >
        <button
            data-testid="control-toggle-pause"
            type="button"
            aria-label="Toggle pause"
            title="Pause or resume simulation"
            onClick={() => {
              const wasPaused = togglePauseFromControls();
              setFeedbackMessage({
                kind: 'success',
                message: wasPaused ? 'Simulation resumed.' : 'Simulation paused.',
              });
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: 'linear-gradient(90deg, #3d5afe, #00bcd4)',
              color: 'white',
              cursor: 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Toggle Pause
          </button>
          <button
            data-testid="control-step-tick"
            type="button"
            aria-label="Step simulation by one tick"
            title="Advance simulation by 1 tick"
            onClick={() => {
              const runtime = sim as unknown as RuntimeSimulation;
              const outcome = runtime.stepTicks?.(1);
              if (outcome?.ok) {
                setFeedbackMessage({
                  kind: 'success',
                  message: 'Advanced 1 tick.',
                });
              } else {
                setFeedbackMessage({
                  kind: 'error',
                  message: outcome?.reason === undefined ? 'Unable to step.' : outcome.reason,
                });
              }
              syncHudFromSimulation();
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#444',
              color: 'white',
              cursor: 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Step 1
          </button>
          <button
            data-testid="control-step-tick-10"
            type="button"
            aria-label="Step simulation by ten ticks"
            title="Advance simulation by 10 ticks"
            onClick={() => {
              const runtime = sim as unknown as RuntimeSimulation;
              const outcome = runtime.stepTicks?.(10);
              if (outcome?.ok) {
                setFeedbackMessage({
                  kind: 'success',
                  message: 'Advanced 10 ticks.',
                });
              } else {
                setFeedbackMessage({
                  kind: 'error',
                  message: outcome?.reason === undefined ? 'Unable to step.' : outcome.reason,
                });
              }
              syncHudFromSimulation();
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#444',
              color: 'white',
              cursor: 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Step 10
          </button>
          <button
            data-testid="control-slot-prev"
            type="button"
            aria-label="Select previous save slot"
            title="Go to previous save slot"
            onClick={() => {
              cycleSaveSlot(-1);
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#444',
              color: 'white',
              cursor: 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Slot -
          </button>
          <div
            data-testid="control-slot-active"
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#2f2f2f',
              color: '#d2d2d2',
              cursor: 'default',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 10,
              fontWeight: 'bold',
            }}
          >
            {activeSaveSlotLabel}
          </div>
          <div
            data-testid="control-slot-updated-at"
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#1f1f1f',
              color: activeSaveSlotHasValue ? '#9fe1ff' : '#8f8f8f',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 10,
              fontWeight: 'bold',
              whiteSpace: 'nowrap',
            }}
          >
            {activeSaveSlotUpdatedLabel}
          </div>
          <button
            data-testid="control-slot-next"
            type="button"
            aria-label="Select next save slot"
            title="Go to next save slot"
            onClick={() => {
              cycleSaveSlot(1);
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#444',
              color: 'white',
              cursor: 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Slot +
          </button>
          <button
            data-testid="control-slot-save"
            type="button"
            aria-label="Save current state to active slot"
            title="Save current state to active slot"
            onClick={() => {
              persistRuntimeSaveToSlot(activeSaveSlot);
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#444',
              color: 'white',
              cursor: 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, ' +
                'Liberation Mono, "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Save Slot
          </button>
          <button
            data-testid="control-slot-load"
            type="button"
            disabled={!activeSaveSlotHasValue}
            aria-label="Load active save slot"
            title="Load state from active save slot"
            onClick={() => {
              loadRuntimeFromSlot(activeSaveSlot);
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: activeSaveSlotHasValue ? '#444' : '#2b2b2b',
              color: activeSaveSlotHasValue ? 'white' : 'rgba(255,255,255,0.45)',
              cursor: activeSaveSlotHasValue ? 'pointer' : 'not-allowed',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Load Slot
          </button>
          <button
            data-testid="control-slot-clear"
            type="button"
            disabled={!activeSaveSlotHasValue}
            aria-label="Clear active save slot"
            title="Clear active save slot"
            onClick={() => {
              clearRuntimeSaveSlot(activeSaveSlot);
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: activeSaveSlotHasValue ? '#444' : '#2b2b2b',
              color: activeSaveSlotHasValue ? 'white' : 'rgba(255,255,255,0.45)',
              cursor: activeSaveSlotHasValue ? 'pointer' : 'not-allowed',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, ' +
                  'Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Clear Slot
          </button>
          <button
            data-testid="control-undo"
            type="button"
            disabled={!canUndoHistory}
            aria-label="Undo last action"
            title="Undo last action"
            onClick={() => {
              undoRuntimeHistory();
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: canUndoHistory ? '#444' : '#2b2b2b',
              color: canUndoHistory ? 'white' : 'rgba(255,255,255,0.45)',
              cursor: canUndoHistory ? 'pointer' : 'not-allowed',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Undo
          </button>
          <button
            data-testid="control-redo"
            type="button"
            disabled={!canRedoHistory}
            aria-label="Redo last undone action"
            title="Redo last undone action"
            onClick={() => {
              redoRuntimeHistory();
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: canRedoHistory ? '#444' : '#2b2b2b',
              color: canRedoHistory ? 'white' : 'rgba(255,255,255,0.45)',
              cursor: canRedoHistory ? 'pointer' : 'not-allowed',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Redo
          </button>
          <button
            data-testid="control-clear-history"
            type="button"
            aria-label="Clear action history"
            title="Clear undo/redo action history"
            onClick={() => {
              clearRuntimeHistory();
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#444',
              color: 'white',
              cursor: 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Clear History
          </button>
          <div
            data-testid="control-checkpoints"
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr',
              gap: 6,
              marginBottom: 4,
              color: '#d2d2d2',
              borderTop: '1px solid rgba(255,255,255,0.15)',
              paddingTop: 6,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 'bold', opacity: 0.95 }}>
              Runtime Checkpoints ({runtimeCheckpointLabel})
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 }}>
              <button
                data-testid="control-checkpoint-capture"
                type="button"
                aria-label="Capture runtime checkpoint"
                title="Capture current runtime state as a checkpoint"
                onClick={() => {
                  addRuntimeCheckpoint('manual');
                }}
                style={{
                  padding: '6px 10px',
                  borderRadius: 6,
                  border: 'none',
                  background: '#4f46e5',
                  color: 'white',
                  cursor: 'pointer',
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, "Courier New", monospace',
                  fontSize: 11,
                  fontWeight: 'bold',
                }}
              >
                Capture Checkpoint
              </button>
              <button
                data-testid="control-checkpoints-clear"
                type="button"
                aria-label="Clear runtime checkpoints"
                title="Clear all saved checkpoints"
                onClick={() => {
                  clearRuntimeCheckpoints();
                }}
                style={{
                  padding: '6px 10px',
                  borderRadius: 6,
                  border: 'none',
                  background: runtimeCheckpointCount > 0 ? '#444' : '#2b2b2b',
                  color: runtimeCheckpointCount > 0 ? 'white' : 'rgba(255,255,255,0.45)',
                  cursor: runtimeCheckpointCount > 0 ? 'pointer' : 'not-allowed',
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, "Courier New", monospace',
                  fontSize: 11,
                  fontWeight: 'bold',
                }}
                disabled={runtimeCheckpointCount === 0}
              >
                Clear
              </button>
            </div>
            <div
              data-testid="control-checkpoint-list"
              style={{
                display: 'grid',
                gap: 4,
                maxHeight: 150,
                overflowY: 'auto',
              }}
            >
              {runtimeCheckpoints.length === 0 ? (
                <div data-testid="control-checkpoint-empty" style={{ color: '#9ea3aa', fontSize: 10 }}>
                  No checkpoints captured.
                </div>
              ) : (
                runtimeCheckpoints.map((checkpoint, index) => (
                  <div
                    key={`${checkpoint.createdAt}-${checkpoint.tick}-${index}`}
                    data-testid={`control-checkpoint-item-${index}`}
                    style={{
                      border: '1px solid rgba(255,255,255,0.18)',
                      borderRadius: 6,
                      padding: '5px 6px',
                      display: 'grid',
                      gap: 4,
                      gridTemplateColumns: '1fr auto',
                      alignItems: 'start',
                    }}
                  >
                    <div>
                      <div data-testid={`control-checkpoint-label-${index}`} style={{ fontSize: 10, opacity: 0.95 }}>
                        {checkpoint.reason} · tick {checkpoint.tick}
                      </div>
                      <div style={{ fontSize: 10, opacity: 0.75 }}>
                        {checkpoint.createdAt}
                      </div>
                    </div>
                      <button
                        data-testid={`control-checkpoint-restore-${index}`}
                        type="button"
                        aria-label={`Restore checkpoint ${index + 1}`}
                        title={`Restore checkpoint captured at ${checkpoint.createdAt}`}
                        onClick={() => {
                          const outcome = restoreRuntimeCheckpoint(checkpoint);
                          const isRestored = outcome.ok === true;
                          setFeedbackMessage({
                            kind: isRestored ? 'success' : 'error',
                            message: String(
                              isRestored
                                ? outcome.reason ?? `Restored checkpoint (${checkpoint.reason}) at tick ${checkpoint.tick}.`
                                : outcome.reason ?? 'Unable to restore checkpoint.',
                            ),
                          });
                        }}
                        style={{
                          padding: '4px 7px',
                          borderRadius: 5,
                          border: 'none',
                        background: '#4caf50',
                        color: 'white',
                        cursor: 'pointer',
                        fontFamily:
                          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, "Courier New", monospace',
                        fontSize: 10,
                        fontWeight: 'bold',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Restore
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
          <input
            ref={runtimeSaveImportInputRef}
            data-testid="control-import-state-input"
            type="file"
            accept=".json,application/json"
            aria-label="Select save file to import"
            title="Select a JSON save file"
            style={{ display: 'none' }}
            onChange={handleRuntimeSaveImportChange}
          />
          <button
            data-testid="control-save-state"
            type="button"
            aria-label="Save State"
            title="Save current world state"
            onClick={() => {
              persistRuntimeSave();
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#444',
              color: 'white',
              cursor: 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Save State
          </button>
          <button
            data-testid="control-export-state"
            type="button"
            aria-label="Export current state"
            title="Export current world state as JSON"
            onClick={() => {
              exportRuntimeSave();
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#444',
              color: 'white',
              cursor: 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Export State
          </button>
          <button
            data-testid="control-save-copy"
            type="button"
            aria-label="Copy state to clipboard"
            title="Copy runtime state payload to clipboard"
            onClick={() => {
              void copyRuntimeSaveToClipboard();
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#444',
              color: 'white',
              cursor: 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Copy State
          </button>
          <button
            data-testid="control-save-share-link"
            type="button"
            aria-label="Copy save share link"
            title="Copy runtime save share link"
            onClick={() => {
              void copyRuntimeSaveShareLink();
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#444',
              color: 'white',
              cursor: 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, ' +
                  'Liberation Mono, "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Copy Save Link
          </button>
          <button
            data-testid="control-save-share-link-paste"
            type="button"
            aria-label="Paste save share link"
            title="Paste runtime save from share link"
            onClick={() => {
              void pasteRuntimeSaveShareLinkFromClipboard();
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#444',
              color: 'white',
              cursor: 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, ' +
                  'Liberation Mono, "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Paste Save Link
          </button>
          <button
            data-testid="control-save-paste"
            type="button"
            aria-label="Paste state from clipboard"
            title="Paste runtime state payload from clipboard"
            onClick={() => {
              void pasteRuntimeSaveFromClipboard();
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#444',
              color: 'white',
              cursor: 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Paste State
          </button>
          <button
            data-testid="control-import-state"
            type="button"
            aria-label="Import state from file"
            title="Open save import file picker"
            onClick={() => {
              openRuntimeSaveImportDialog();
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#444',
              color: 'white',
              cursor: 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Import State
          </button>
          <input
            ref={runtimeBlueprintImportInputRef}
            data-testid="control-blueprint-import-input"
            type="file"
            accept=".json,application/json"
            aria-label="Select blueprint file to import"
            title="Select a JSON blueprint file"
            style={{ display: 'none' }}
            onChange={handleRuntimeBlueprintImportChange}
          />
          <button
            data-testid="control-blueprint-export"
            type="button"
            aria-label="Export blueprint"
            title="Export current layout as blueprint JSON"
            onClick={() => {
              exportRuntimeBlueprint();
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#444',
              color: 'white',
              cursor: 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Export Blueprint
          </button>
          <button
            data-testid="control-blueprint-copy"
            type="button"
            aria-label="Copy blueprint to clipboard"
            title="Copy runtime blueprint payload to clipboard"
            onClick={() => {
              void copyRuntimeBlueprintToClipboard();
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#444',
              color: 'white',
              cursor: 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, ' +
                  'Liberation Mono, "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Copy Blueprint
          </button>
          <button
            data-testid="control-blueprint-share-link"
            type="button"
            aria-label="Copy blueprint share link"
            title="Copy runtime blueprint share link"
            onClick={() => {
              void copyRuntimeBlueprintShareLink();
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#444',
              color: 'white',
              cursor: 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, ' +
                  'Consolas, Liberation Mono, "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Copy Blueprint Link
          </button>
          <button
            data-testid="control-blueprint-share-link-paste"
            type="button"
            aria-label="Paste blueprint share link"
            title="Paste runtime blueprint from share link"
            onClick={() => {
              void pasteRuntimeBlueprintShareLinkFromClipboard();
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#444',
              color: 'white',
              cursor: 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, ' +
                  'Liberation Mono, "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Paste Blueprint Link
          </button>
          <button
            data-testid="control-blueprint-import"
            type="button"
            aria-label="Import blueprint from file"
            title="Open blueprint import file picker"
            onClick={() => {
              openRuntimeBlueprintImportDialog();
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#444',
              color: 'white',
              cursor: 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, ' +
                  'Liberation Mono, "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Import Blueprint
          </button>
          <button
            data-testid="control-blueprint-paste"
            type="button"
            aria-label="Paste blueprint from clipboard"
            title="Paste runtime blueprint payload from clipboard"
            onClick={() => {
              void pasteRuntimeBlueprintFromClipboard();
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#444',
              color: 'white',
              cursor: 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, ' +
                  'Liberation Mono, "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Paste Blueprint
          </button>
          <button
            data-testid="control-load-state"
            type="button"
            aria-label="Load State"
            title="Load saved state from storage"
            onClick={() => {
              loadRuntimeFromStorage();
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#444',
              color: 'white',
              cursor: 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Load State
          </button>
          <input
            ref={runtimePlanImportInputRef}
            data-testid="control-plan-import-input"
            type="file"
            accept=".json,application/json"
            aria-label="Select plan file to import"
            title="Select a JSON plan file"
            style={{ display: 'none' }}
            onChange={handleRuntimePlanImportChange}
          />
          <button
            data-testid="control-plan-import"
            type="button"
            aria-label="Import agent plan"
            title="Import runtime plan from file"
            onClick={() => {
              openRuntimePlanImportDialog();
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#444',
              color: 'white',
              cursor: 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, ' +
                'Liberation Mono, "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Import Plan
          </button>
          <button
            data-testid="control-plan-export"
            type="button"
            aria-label="Export active agent plan"
            title="Export runtime plan as JSON"
            onClick={() => {
              exportRuntimeAgentPlan();
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: runtimePlan === null ? '#2b2b2b' : '#444',
              color: runtimePlan === null ? 'rgba(255,255,255,0.45)' : 'white',
              cursor: runtimePlan === null ? 'not-allowed' : 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
            disabled={runtimePlan === null}
          >
            Export Plan
          </button>
          <button
            data-testid="control-plan-copy"
            type="button"
            aria-label="Copy active agent plan"
            title="Copy runtime plan JSON to clipboard"
            onClick={() => {
              void copyRuntimeAgentPlanToClipboard();
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: runtimePlan === null ? '#2b2b2b' : '#444',
              color: runtimePlan === null ? 'rgba(255,255,255,0.45)' : 'white',
              cursor: runtimePlan === null ? 'not-allowed' : 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, ' +
                'Liberation Mono, "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
            disabled={runtimePlan === null}
          >
            Copy Plan
          </button>
          <button
            data-testid="control-plan-paste"
            type="button"
            aria-label="Paste agent plan"
            title="Paste runtime plan JSON from clipboard"
            onClick={() => {
              void importRuntimePlanFromClipboard();
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#444',
              color: 'white',
              cursor: 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, ' +
                'Liberation Mono, "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Paste Plan
          </button>
          <label
            htmlFor="runtime-plan-step-delay"
            style={{
              display: 'none',
            }}
          >
            Plan command delay (ms)
          </label>
          <input
            id="runtime-plan-step-delay"
            data-testid="control-plan-speed"
            type="range"
            min={RUNTIME_PLAN_MIN_STEP_DELAY_MS}
            max={RUNTIME_PLAN_MAX_STEP_DELAY_MS}
            step="20"
            value={runtimePlanStepDelayMs}
            disabled={runtimePlanRunning}
            onChange={handleRuntimePlanStepDelayChange}
            title={`Plan execution delay: ${runtimePlanStepDelayMs}ms/command`}
            style={{
              width: 110,
              accentColor: runtimePlanRunning ? '#2b2b2b' : '#4f46e5',
            }}
          />
          <span
            data-testid="control-plan-speed-value"
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: runtimePlanRunning ? '1px solid #444' : '1px solid #334155',
              background: '#1f1f1f',
              color: runtimePlanRunning ? 'rgba(255,255,255,0.45)' : '#d2d2d2',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, ' +
                  'Liberation Mono, "Courier New", monospace',
              fontSize: 10,
              fontWeight: 'bold',
              minWidth: 66,
            }}
          >
            {runtimePlanStepDelayMs}ms
          </span>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 0',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, ' +
                  'Liberation Mono, "Courier New", monospace',
              fontSize: 10,
              fontWeight: 'bold',
              color: runtimePlanRunning ? 'rgba(255,255,255,0.45)' : '#d2d2d2',
            }}
          >
            <input
              data-testid="control-plan-loop"
              type="checkbox"
              checked={runtimePlanLoop}
              disabled={runtimePlanRunning}
              onChange={handleRuntimePlanLoopChange}
            />
            Loop plan
          </label>
          <label
            htmlFor="runtime-plan-record-agent"
            style={{
              display: 'none',
            }}
          >
            Record agent
          </label>
          <input
            id="runtime-plan-record-agent"
            data-testid="control-plan-record-agent"
            type="text"
            value={runtimePlanRecordingAgent}
            onChange={handleRuntimePlanRecordingAgentChange}
            disabled={runtimePlanRunning}
            title="Agent label assigned to all recorded plan commands"
            aria-label="Runtime plan recording agent"
            style={{
              width: 100,
              padding: '6px 8px',
              borderRadius: 6,
              border: '1px solid #334155',
              background: runtimePlanRunning ? '#2b2b2b' : '#1f2937',
              color: runtimePlanRunning ? 'rgba(255,255,255,0.45)' : 'white',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
              outline: 'none',
              marginRight: 6,
            }}
          />
          <button
            data-testid="control-plan-record"
            type="button"
            aria-label={runtimePlanRecording ? 'Stop recording runtime plan' : 'Start recording runtime plan'}
            title={runtimePlanRecording ? 'Stop recording and load plan' : 'Record live actions into a runtime plan'}
            onClick={() => {
              toggleRuntimePlanRecording();
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: runtimePlanRunning ? '#2b2b2b' : runtimePlanRecording ? '#dc2626' : '#16a34a',
              color: runtimePlanRunning ? 'rgba(255,255,255,0.45)' : 'white',
              cursor: runtimePlanRunning ? 'not-allowed' : 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, ' +
                'Liberation Mono, "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
            disabled={runtimePlanRunning}
          >
            {runtimePlanRecording
              ? `Stop Recording (${runtimePlanRecordingCommandCount})`
              : 'Record Plan'}
          </button>
          <button
            data-testid="control-plan-start"
            type="button"
            aria-label="Start runtime plan"
            title="Start executing current plan"
            onClick={() => {
              startRuntimeAgentPlan();
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: runtimePlanCanRun ? '#444' : '#2b2b2b',
              color: runtimePlanCanRun ? 'white' : 'rgba(255,255,255,0.45)',
              cursor: runtimePlanCanRun ? 'pointer' : 'not-allowed',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, ' +
                'Liberation Mono, "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
            disabled={!runtimePlanCanRun}
          >
            Start Plan
          </button>
          <button
            data-testid="control-plan-step"
            type="button"
            aria-label="Run next runtime plan command"
            title="Run one plan command"
            onClick={() => {
              runRuntimeAgentPlanStep();
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: runtimePlanCanRun ? '#444' : '#2b2b2b',
              color: runtimePlanCanRun ? 'white' : 'rgba(255,255,255,0.45)',
              cursor: runtimePlanCanRun ? 'pointer' : 'not-allowed',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, ' +
                  'Liberation Mono, "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
            disabled={!runtimePlanCanRun}
          >
            Step Plan
          </button>
          {runtimePlanAgentSummaries.length > 0 ? (
            <div
              data-testid="control-plan-agent-toggle-list"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                margin: runtimePlan === null ? '0 0 0 0' : '0 8px 0 0',
                alignItems: 'center',
              }}
            >
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 11,
                  marginRight: 2,
                }}
              >
                <div style={{ opacity: 0.8 }}>Agents:</div>
                <button
                  type="button"
                  aria-label="Toggle all plan agents"
                  data-testid="control-plan-agent-toggle-all"
                  onClick={() => {
                    setAllRuntimePlanEnabledAgents(!runtimePlanAllAgentsEnabled);
                  }}
                  disabled={runtimePlanRunning}
                  style={{
                    padding: '4px 8px',
                    borderRadius: 6,
                    border: '1px solid #475569',
                    background: runtimePlanRunning ? '#2b2b2b' : '#334155',
                    color: 'white',
                    cursor: runtimePlanRunning ? 'not-allowed' : 'pointer',
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                    fontSize: 10,
                    fontWeight: 'bold',
                  }}
                >
                  {runtimePlanAllAgentsEnabled ? 'Disable All' : 'Enable All'}
                </button>
              </div>
              {runtimePlanAgentSummaries.map((summary) => {
                const percent =
                  summary.totalCommands === 0
                    ? 0
                    : (summary.completedCommands / summary.totalCommands) * 100;

                return (
                  <label
                    key={summary.agent}
                    style={{
                      display: 'inline-flex',
                      flexDirection: 'column',
                      gap: 4,
                      padding: '2px 6px',
                      border: '1px solid rgba(255,255,255,0.2)',
                      borderRadius: 6,
                      opacity: summary.enabled ? 1 : 0.7,
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                      <input
                        data-testid={`control-plan-agent-${summary.agent}`}
                        type="checkbox"
                        checked={summary.enabled}
                        disabled={runtimePlanRunning}
                        onChange={(event) => {
                          handleRuntimePlanEnabledAgentChange(summary.agent, event.target.checked);
                        }}
                      />
                      <span>{summary.agent}</span>
                      <span style={{ opacity: 0.8 }}>
                        {summary.completedCommands}/{summary.totalCommands}
                      </span>
                    </span>
                    <span
                      style={{
                        width: 72,
                        height: 4,
                        background: 'rgba(255,255,255,0.18)',
                        borderRadius: 999,
                        overflow: 'hidden',
                      }}
                    >
                      <span
                        style={{
                          display: 'block',
                          height: '100%',
                          width: `${percent}%`,
                          background: summary.enabled ? '#22c55e' : '#64748b',
                        }}
                      />
                    </span>
                  </label>
                );
              })}
            </div>
          ) : null}
          <button
            data-testid="control-plan-stop"
            type="button"
            aria-label="Stop runtime plan"
            title="Stop executing current plan"
            onClick={() => {
              stopRuntimeAgentPlan();
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: runtimePlanRunning ? '#444' : '#2b2b2b',
              color: runtimePlanRunning ? 'white' : 'rgba(255,255,255,0.45)',
              cursor: runtimePlanRunning ? 'pointer' : 'not-allowed',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, ' +
                'Liberation Mono, "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
            disabled={!runtimePlanRunning}
          >
            Stop Plan
          </button>
          <button
            data-testid="control-plan-clear"
            type="button"
            aria-label="Clear runtime plan"
            title="Clear active runtime plan"
            onClick={() => {
              clearRuntimePlan();
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: runtimePlan === null ? '#2b2b2b' : '#444',
              color: runtimePlan === null ? 'rgba(255,255,255,0.45)' : 'white',
              cursor: runtimePlan === null ? 'not-allowed' : 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
            disabled={runtimePlan === null}
          >
            Clear Plan
          </button>
          <div
            data-testid="control-plan-name"
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#1f1f1f',
              color: '#d2d2d2',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 10,
              fontWeight: 'bold',
            }}
          >
            Plan: {runtimePlanName}
          </div>
          <div
            data-testid="control-plan-progress"
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#1f1f1f',
              color: '#d2d2d2',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 10,
              fontWeight: 'bold',
            }}
          >
            Progress: {runtimePlanProgressLabel}
          </div>
          <div
            data-testid="control-plan-status"
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#111',
              color: '#d2d2d2',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 10,
              fontWeight: 'bold',
              minHeight: '2.2em',
              lineHeight: 1.15,
              whiteSpace: 'pre-wrap',
            }}
          >
            {runtimePlanStatusMessage}
          </div>
          <div
            data-testid="control-plan-next-command"
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#1f1f1f',
              color: '#d2d2d2',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 10,
              fontWeight: 'bold',
              whiteSpace: 'pre-wrap',
            }}
          >
            Next: {runtimePlanNextCommandLabel}
          </div>
          <div
            data-testid="control-plan-log"
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#111',
              color: '#d2d2d2',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 10,
              fontWeight: 'bold',
              minHeight: '3.6em',
              lineHeight: 1.15,
              whiteSpace: 'pre-wrap',
              maxHeight: '4.4em',
              overflowY: 'auto',
            }}
          >
            {runtimePlanExecutionLog.length === 0
              ? 'No execution history yet.'
              : runtimePlanExecutionLog.map((entry, index) => (
                  <div key={`${entry}-${index}`} data-testid="control-plan-log-entry">
                    {entry}
                  </div>
                ))
            }
          </div>
          <button
            data-testid="control-clear-save"
            type="button"
            aria-label="Clear saved state"
            title="Clear saved state from storage"
            onClick={() => {
              clearRuntimeSave();
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#444',
              color: 'white',
              cursor: 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Clear Save
          </button>
          <button
            data-testid="control-reset"
            type="button"
            aria-label="Reset world"
            title="Reset runtime to initial state"
            onClick={() => {
              resetRuntime();
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#444',
              color: 'white',
              cursor: 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Reset
          </button>
          <button
            data-testid="control-shortcuts"
            type="button"
            aria-label="Toggle keyboard shortcuts overlay"
            title="Open/close keyboard shortcuts"
            aria-expanded={shortcutOverlayOpen}
            aria-controls="keyboard-shortcuts-overlay"
            onClick={() => {
              setShortcutOverlayOpen((current) => !current);
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#7e57c2',
              color: 'white',
              cursor: 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Shortcuts
          </button>
          <button
            data-testid="control-camera-player"
            type="button"
            aria-label="Center camera on player"
            title="Center camera on player"
            onClick={() => {
              setCameraToPlayer();
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#444',
              color: 'white',
              cursor: 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Center Player
          </button>
          <button
            data-testid="control-camera-spawn"
            type="button"
            aria-label="Center camera on spawn"
            title="Center camera on spawn"
            onClick={() => {
              setCameraToSpawn();
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
                  border: 'none',
              background: '#444',
              color: 'white',
              cursor: 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Center Spawn
          </button>
          <button
            data-testid="control-camera-zoom-in"
            type="button"
            aria-label="Zoom camera in"
            title="Zoom camera in"
            onClick={() => {
              zoomCamera(CAMERA_ZOOM_STEP, 'player');
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#444',
              color: 'white',
              cursor: 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Zoom In
          </button>
          <button
            data-testid="control-camera-zoom-out"
            type="button"
            aria-label="Zoom camera out"
            title="Zoom camera out"
            onClick={() => {
              zoomCamera(-CAMERA_ZOOM_STEP, 'player');
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              background: '#444',
              color: 'white',
              cursor: 'pointer',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            Zoom Out
          </button>
          </div>
          </div>
        </div>
      {shortcutOverlayOpen ? (
        <div
          data-testid="keyboard-shortcuts-overlay-backdrop"
          onClick={() => {
            setShortcutOverlayOpen(false);
          }}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 2,
            background: 'rgba(0, 0, 0, 0.25)',
          }}
        >
          <div
            data-testid="keyboard-shortcuts-overlay"
            role="dialog"
            aria-label="Keyboard shortcuts"
            onClick={(event) => {
              event.stopPropagation();
            }}
            style={{
              position: 'absolute',
              top: 80,
              right: 12,
              maxWidth: 360,
              maxHeight: 380,
              padding: '10px',
              overflow: 'auto',
              borderRadius: 8,
              background: 'rgba(12, 12, 12, 0.98)',
              color: 'white',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 11,
              lineHeight: 1.25,
              boxShadow: '0 8px 20px rgba(0,0,0,0.45)',
              border: '1px solid rgba(255,255,255,0.2)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontWeight: 'bold' }}>Keyboard Shortcuts</div>
              <button
                data-testid="control-shortcuts-close"
                type="button"
                aria-label="Close keyboard shortcuts overlay"
                onClick={() => {
                  setShortcutOverlayOpen(false);
                }}
                style={{
                  padding: '4px 8px',
                  borderRadius: 4,
                  border: 'none',
                  background: '#444',
                  color: 'white',
                  cursor: 'pointer',
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                  fontSize: 10,
                  fontWeight: 'bold',
                }}
              >
                Close
              </button>
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ opacity: 0.8, fontWeight: 'bold', marginBottom: 6 }}>Quick actions</div>
              {KEYBOARD_SHORTCUT_ACTIONS.map((action) => {
                const normalizedLabel = action.id === 'toggle-pause' && hud.paused ? 'Resume' : action.label;

                return (
                  <div
                    key={action.id}
                    style={{ marginBottom: 8, display: 'grid', gridTemplateColumns: '90px 1fr', gap: 6, alignItems: 'center' }}
                  >
                    <button
                      data-testid={`control-shortcuts-action-${action.id}`}
                      type="button"
                      onClick={() => {
                        executeShortcutOverlayAction(action.id);
                      }}
                      style={{
                        borderRadius: 4,
                        border: 'none',
                        padding: '4px 6px',
                        background: '#4f46e5',
                        color: 'white',
                        fontFamily:
                          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                        fontSize: 10,
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {normalizedLabel}
                    </button>
                    <span style={{ opacity: 0.9 }}>{action.description}</span>
                  </div>
                );
              })}
            </div>
            {KEYBOARD_SHORTCUT_HINTS.map((section) => (
              <div key={section.heading} style={{ marginBottom: 8 }}>
                <div style={{ opacity: 0.8, fontWeight: 'bold', marginBottom: 4 }}>{section.heading}</div>
                <div>
                  {section.items.map((entry) => (
                    <div
                      key={`${section.heading}-${entry.keys}`}
                      style={{ marginBottom: 3, display: 'grid', gridTemplateColumns: '84px 1fr' }}
                    >
                      <span style={{ opacity: 0.75 }}>{entry.keys}</span>
                      <span>{entry.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {showTouchControls ? (
        <div
          data-testid="touch-controls"
          style={{
            position: 'absolute',
            left: 12,
            bottom: 12,
            zIndex: 2,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 10,
            width: 'min(72vw, 360px)',
            userSelect: 'none',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '38px 38px 38px',
              gridTemplateRows: '38px 38px 38px',
              gap: 6,
              justifyContent: 'center',
            }}
          >
            <span />
            <button
              type="button"
              aria-label="Move up"
              onClick={() => {
                movePlayerFromDirection('N');
              }}
              style={touchControlButtonStyle}
            >
              ↑
            </button>
            <span />
            <button
              type="button"
              aria-label="Move left"
              onClick={() => {
                movePlayerFromDirection('W');
              }}
              style={touchControlButtonStyle}
            >
              ←
            </button>
            <button
              type="button"
              aria-label="Move down"
              onClick={() => {
                movePlayerFromDirection('S');
              }}
              style={touchControlButtonStyle}
            >
              ↓
            </button>
            <button
              type="button"
              aria-label="Move right"
              onClick={() => {
                movePlayerFromDirection('E');
              }}
              style={touchControlButtonStyle}
            >
              →
            </button>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 6,
              alignContent: 'start',
            }}
          >
            <button
              type="button"
              data-testid="touch-action-primary"
              aria-label="Primary action"
              onClick={runTouchPrimaryAction}
              style={touchControlWideButtonStyle}
            >
              Use / Place
            </button>
            <button
              type="button"
              data-testid="touch-action-secondary"
              aria-label="Secondary action"
              onClick={runTouchSecondaryAction}
              style={touchControlWideButtonStyle}
            >
              Remove
            </button>
            <button
              type="button"
              data-testid="touch-action-mine"
              aria-label="Mine resource"
              onClick={runTouchMine}
              style={touchControlWideButtonStyle}
            >
              Mine
            </button>
            <button
              type="button"
              data-testid="touch-action-rotate"
              aria-label="Rotate tool"
              onClick={runTouchRotate}
              style={touchControlWideButtonStyle}
            >
              Rotate
            </button>
            <button
              type="button"
              data-testid="touch-action-clear"
              aria-label="Clear tool"
              onClick={runTouchClear}
              style={touchControlWideButtonStyle}
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}
      {showHud ? (
        <div
          data-testid="hud"
          style={{
            position: 'absolute',
            left: HUD_LEFT,
            bottom: hudPanelBottomOffset,
            zIndex: 1,
            width: 'min(340px, calc(100vw - 24px))',
            maxWidth: '340px',
            boxSizing: 'border-box',
            padding: '8px 10px',
            borderRadius: 8,
            background: 'rgba(20, 20, 20, 0.75)',
            color: 'white',
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            fontSize: 12,
            lineHeight: 1.35,
            userSelect: 'none',
            maxHeight: 'min(58vh, calc(100vh - 24px))',
            overflowY: 'auto',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              pointerEvents: 'auto',
            }}
          >
            <div style={{ opacity: 0.9, whiteSpace: 'nowrap' }}>HUD</div>
            <button
              type="button"
              onClick={() => {
                setHudCollapsed((current) => !current);
              }}
              style={{
                minWidth: 84,
                fontSize: 11,
                padding: '2px 8px',
                background: 'rgba(255, 255, 255, 0.18)',
                border: '1px solid rgba(255, 255, 255, 0.35)',
                borderRadius: 6,
                color: 'white',
                cursor: 'pointer',
              }}
            >
              {hudCollapsed ? 'Expand' : 'Collapse'}
            </button>
          </div>
          <div style={{ pointerEvents: 'none' }}>
            <div data-testid="hud-tool">
              <span>Tool:</span>{' '}
              <span data-testid="hud-tool-value" data-value={hudToolValue}>
                {hudToolValue}
              </span>
            </div>
            <div data-testid="hud-rotation">
              <span>Rotation:</span>{' '}
              <span data-testid="hud-rotation-value" data-value={hudRotationValue}>
                {hudRotationValue}
              </span>
            </div>
            <div data-testid="hud-pause">
              <span>Pause:</span>{' '}
              <span data-testid="hud-pause-value" data-value={hudPauseValue.toLowerCase()}>
                {hudPauseValue}
              </span>
            </div>
            <div data-testid="hud-tick">
              <span>Tick:</span>{' '}
              <span data-testid="hud-tick-value" data-value={String(hud.tick)}>
                {hud.tick}
              </span>
            </div>
            {hudCollapsed ? null : (
              <>
                <div data-testid="hud-selected-entity">
                  <span>Selected:</span>{' '}
                  <span
                    data-testid="hud-selected-entity-value"
                    data-value={formatSelectedEntityValue(hud.selectedEntity)}
                  >
                    {formatSelectedEntityValue(hud.selectedEntity)}
                  </span>
                </div>
                <div
                  data-testid="hud-selected-entity-details"
                  style={{ opacity: hud.selectedEntity === null ? 0.8 : 0.95 }}
                >
                  {formatSelectedEntityDetails(hud.selectedEntity)}
                </div>
                <div data-testid="hud-player">
                  <span>Player:</span>{' '}
                  <span data-testid="hud-player-value" data-value={`${hud.player.x},${hud.player.y}`}>
                    ({hud.player.x}, {hud.player.y})
                  </span>
                </div>
                <div data-testid="hud-fuel">
                  <span>Fuel:</span>{' '}
                  <span data-testid="hud-fuel-value" data-value={`${hud.fuel}/${hud.maxFuel}`}>
                    {hud.fuel}/{hud.maxFuel}
                  </span>
                </div>
                <div data-testid="hud-entities">
                  <span>Entities:</span>{' '}
                  <span
                    data-testid="hud-entities-value"
                    data-value={`${hud.metrics.entityCount}`}
                  >
                    {hud.metrics.entityCount}
                  </span>{' '}
                  <span style={{ opacity: 0.75 }}>
                    (M{hud.metrics.miners}/B{hud.metrics.belts}/Sp{hud.metrics.splitters}/I{hud.metrics.inserters}/F{hud.metrics.furnaces}/Asm{hud.metrics.assemblers}/P{hud.metrics.solarPanels}/Ac{hud.metrics.accumulators})
                  </span>
                </div>
                <div data-testid="hud-flow">
                  <span>Transit:</span>{' '}
                  <span
                    data-testid="hud-flow-value"
                    data-value={`${hud.metrics.oreInTransit}/${hud.metrics.platesInTransit}/${hud.metrics.gearsInTransit}/${hud.metrics.coalInTransit}/${hud.metrics.woodInTransit}`}
                  >
                    O:{hud.metrics.oreInTransit} · P:{hud.metrics.platesInTransit} · G:{hud.metrics.gearsInTransit} · C:{hud.metrics.coalInTransit} · W:{hud.metrics.woodInTransit}
                  </span>
                </div>
                <div data-testid="hud-resource-remain">
                  <span>Resources:</span>{' '}
                  <span
                    data-value={`${hud.metrics.oreRemaining}/${hud.metrics.coalRemaining}/${hud.metrics.woodRemaining}`}
                  >
                    O:{hud.metrics.oreRemaining} · C:{hud.metrics.coalRemaining} · W:{hud.metrics.woodRemaining}
                  </span>
                </div>
                <div data-testid="hud-chests">
                  <span>Chests:</span>{' '}
                  <span
                    data-testid="hud-chests-value"
                    data-value={`${hud.metrics.chests}`}
                  >
                    {hud.metrics.chests}
                  </span>{' '}
                  <span style={{ opacity: 0.75 }}>
                    O:{hud.metrics.chestOre} · P:{hud.metrics.chestPlates} · G:{hud.metrics.chestGears} · C:{hud.metrics.chestCoal} · W:{hud.metrics.chestWood}
                  </span>
                </div>
                <div data-testid="hud-inventory">
                  <span>Inv:</span>{' '}
                  <span
                    data-testid="hud-inventory-value"
                    data-value={`${hud.inventory.ore}/${hud.inventory.plate}/${hud.inventory.gear}/${hud.inventory.coal}/${hud.inventory.wood}/${hud.inventory.used}/${hud.inventory.capacity}`}
                  >
                    O:{hud.inventory.ore} P:{hud.inventory.plate} G:{hud.inventory.gear} C:{hud.inventory.coal} W:{hud.inventory.wood} ({hud.inventory.used}/{hud.inventory.capacity})
                  </span>
                </div>
                {renderInventoryPanel('Inventory', hud.inventory)}
                <div data-testid="hud-adjacent-interactive">
                  <span>Interactive:</span>{' '}
                  <span
                    data-testid="hud-adjacent-interactive-value"
                    data-value={formatAdjacentInteractiveValue(hud.adjacentInteractive)}
                    style={{ opacity: hud.adjacentInteractive === null ? 0.8 : 1 }}
                  >
                    {formatAdjacentInteractiveValue(hud.adjacentInteractive)}
                  </span>
                </div>
                <div data-testid="hud-adjacent-interactive-details" style={{ opacity: hud.adjacentInteractive === null ? 0.8 : 0.95 }}>
                  {hud.adjacentInteractive === null
                    ? 'none'
                    : hud.adjacentInteractive.details.length === 0
                      ? 'idle'
                      : hud.adjacentInteractive.details.join(' · ')}
                </div>
                <div data-testid="hud-adjacent-chest">
                  <span>Chest:</span>{' '}
                  <span
                    data-testid="hud-adjacent-chest-value"
                    data-value={hud.adjacentChest === null ? 'none' : `${hud.adjacentChest.id}`}
                    style={{ opacity: hud.adjacentChest === null ? 0.8 : 1 }}
                  >
                    {hud.adjacentChest === null
                      ? 'none'
                      : `(${hud.adjacentChest.x}, ${hud.adjacentChest.y}) O:${hud.adjacentChest.inventory.ore} P:${hud.adjacentChest.inventory.plate} G:${hud.adjacentChest.inventory.gear} C:${hud.adjacentChest.inventory.coal} W:${hud.adjacentChest.inventory.wood}`}
                  </span>
                </div>
                {hud.adjacentChest === null ? (
                  <div style={{ marginBottom: 8, opacity: 0.9 }}>
                    <div style={{ opacity: 0.9 }}>Chest (nearby)</div>
                    <div style={{ marginTop: 4, height: 10, width: 130, border: '1px dashed rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.04)' }}>
                      no nearby chest
                    </div>
                  </div>
                ) : (
                  renderInventoryPanel(
                    `Chest @ (${hud.adjacentChest.x}, ${hud.adjacentChest.y})`,
                    hudChestInventory,
                  )
                )}
                <div data-testid="hud-furnace">
                  <span>Furnaces:</span>{' '}
                  <span
                    data-testid="hud-furnace-value"
                    data-value={`${hud.metrics.furnacesCrafting}/${hud.metrics.furnacesReady}`}
                  >
                    crafting {hud.metrics.furnacesCrafting} · ready {hud.metrics.furnacesReady}
                  </span>
                </div>
                <div data-testid="hud-power">
                  <span>Power:</span>{' '}
                  <span data-testid="hud-power-value" data-value={`${hud.metrics.powerStorage}/${hud.metrics.powerCapacity}`}>
                    {hud.metrics.powerStorage}/{hud.metrics.powerCapacity}
                  </span>
                  <span style={{ marginLeft: 8, opacity: 0.75 }}>
                    D:{hud.metrics.powerDemandThisTick} C:{hud.metrics.powerConsumedThisTick} G:{hud.metrics.powerGeneratedThisTick} S:{hud.metrics.powerShortagesThisTick}
                  </span>
                </div>
                {showTutorialHints ? (
                  <div data-testid="hud-tutorial-next" style={{ marginBottom: 8 }}>
                    <div style={{ fontWeight: 'bold', marginBottom: 4 }}>
                      Next Mission
                    </div>
                    <div data-testid="hud-tutorial-next-text" style={{ fontSize: 11 }}>
                      {nextTutorialMission === null
                        ? 'All tutorial missions complete.'
                        : `${nextTutorialMission.title}: ${nextTutorialMission.hint}`}
                    </div>
                  </div>
                ) : null}
                {showTutorialHints ? (
                  <div data-testid="hud-tutorial-missions" style={{ marginTop: 8 }}>
                    <div style={{ fontWeight: 'bold', marginBottom: 4 }}>
                      Tutorial ({tutorialMissionCompletedCount}/{tutorialMissionTotal})
                    </div>
                    <div style={{ display: 'grid', gap: 4 }}>
                      {tutorialMissions.map((mission) => (
                        <div
                          key={mission.id}
                          data-testid={`hud-tutorial-mission-${mission.id}`}
                          style={{
                            opacity: mission.completed ? 0.75 : 1,
                          }}
                        >
                          <div>
                            <span style={{ marginRight: 6 }}>
                              {mission.completed ? '✓' : '▢'}
                            </span>
                            <span>{mission.title}</span>
                          </div>
                          {!mission.completed ? (
                            <div style={{ marginLeft: 20, fontSize: 11, opacity: 0.85 }}>
                              {mission.hint}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {showTutorialHints ? (
                  <div data-testid="hud-controls-note" style={{ pointerEvents: 'none' }}>
                    <span>Move:</span> WASD / Arrows · <span>Mode:</span> 0/Esc clear / Tab to cycle tools · <span>History:</span> Ctrl/Cmd+Z, Ctrl/Cmd+Y / Shift+Ctrl+Cmd+Z · <span>Slots:</span> Slot +/- and save-slot controls, Ctrl/Cmd+1-3 select, Ctrl/Cmd+Shift+1-3 save, Alt+1-3 load · <span>Pause:</span> Space / P · <span>Step:</span> / or Shift+/ · <span>Refuel:</span> F · <span>Chest:</span> Q pickup · E deposit · <span>Camera:</span> M / Home / End / Alt+M auto-follow / mouse wheel or [ ] zoom · <span>Shortcuts:</span> K or Shortcuts button
                  </div>
                ) : null}
                <div style={{ marginTop: 10 }}>
                  <div style={{ pointerEvents: 'auto' }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={cameraAutoFollow}
                        onChange={(event) => {
                          const next = event.target.checked;
                          cameraAutoFollowRef.current = next;
                          setCameraAutoFollow(next);
                        }}
                      />
                      <span>Auto-follow player camera</span>
                    </label>
                  </div>
                </div>
                <div data-testid="hud-automation" style={{ pointerEvents: 'auto' }}>
                  {AUTOMATION_AGENTS.map((agent) => {
                    const enabled = automationEnabled[agent.id];
                    const status = automationStatus[agent.id];
                    return (
                      <div key={agent.id} style={{ marginTop: 6 }}>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <input
                            type="checkbox"
                            checked={enabled}
                            onChange={(event) => {
                              const next = {
                                ...automationEnabledRef.current,
                                [agent.id]: event.target.checked,
                              };
                              automationEnabledRef.current = next;
                              if (event.target.checked === false) {
                                const nextStatus = {
                                  ...automationStatusRef.current,
                                  [agent.id]: 'idle',
                                };
                                automationStatusRef.current = nextStatus;
                                setAutomationStatus(nextStatus);
                              }
                              setAutomationEnabled(next);
                            }}
                          />
                          <span>
                            {agent.label} - {agent.description}
                          </span>
                        </label>
                        <div style={{ marginLeft: 20, opacity: 0.7, fontSize: 11 }}>
                          {status}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
      {feedback === null ? null : (
        <div
          style={{
            position: 'absolute',
            top: 60,
            right: 12,
            zIndex: 1,
            maxWidth: 260,
            padding: '8px 10px',
            borderRadius: 8,
            background: feedback.kind === 'success' ? 'rgba(34, 139, 34, 0.85)' : 'rgba(139, 0, 0, 0.85)',
            color: 'white',
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            fontSize: 12,
            lineHeight: 1.25,
            userSelect: 'none',
          }}
          role="status"
          aria-live="polite"
        >
          {feedback.message}
        </div>
      )}
    </div>
  );
}

declare global {
  interface Window {
    __SIM__?: unknown;
    __USE_SVGS__?: boolean;
    __CAMERA__?: CameraState;
  }
}
