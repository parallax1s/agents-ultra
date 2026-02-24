import { describe, expect, it } from 'vitest';

import {
  clampRuntimePlanStepDelayMs,
  createRuntimeAgentPlanExecutionState,
  cloneRuntimeAgentPlanExecutionState,
  formatRuntimeAgentPlanWarnings,
  isRuntimeAgentPlanCommandStateMutating,
  describeNextRuntimeAgentPlanCommand,
  describeRuntimeAgentPlanCommand,
  describeRuntimeAgentPlanCommandForLog,
  peekNextRuntimeAgentPlanCommand,
  resolveRuntimeAgentPlanImportPayload,
  pickNextRuntimeAgentPlanCommand,
  summarizeRuntimePlanAgents,
  validateRuntimeAgentPlanPayloadForImport,
} from '../src/ui/App';

describe('runtime agent plan execution scheduling', () => {
  it('executes legacy plan commands in flat sequence when no agent is provided', () => {
    const plan = {
      version: 1,
      commands: [
        {
          type: 'rotate',
          steps: 1,
        },
        {
          type: 'set-rotation',
          rotation: 2,
        },
        {
          type: 'step',
          ticks: 3,
        },
      ],
    };

    const normalizedPlan = plan as Parameters<typeof createRuntimeAgentPlanExecutionState>[0];
    const state = createRuntimeAgentPlanExecutionState(normalizedPlan);
    expect(state.agentOrder).toEqual(['agent-default']);

    const executionOrder: number[] = [];
    while (true) {
      const next = pickNextRuntimeAgentPlanCommand(normalizedPlan, state);
      if (next === null) {
        break;
      }
      executionOrder.push(next.commandIndex);
      expect(next.agent).toBe('agent-default');
    }

    expect(executionOrder).toEqual([0, 1, 2]);
    expect(pickNextRuntimeAgentPlanCommand(normalizedPlan, state)).toBeNull();
  });

  it('interleaves commands across agents using round-robin execution by agent order', () => {
    const plan = {
      version: 1,
      commands: [
        {
          type: 'select',
          tool: 'belt',
          agent: 'planner',
        },
        {
          type: 'select',
          tool: 'furnace',
          agent: 'builder',
        },
        {
          type: 'select',
          tool: 'belt',
          agent: 'planner',
        },
        {
          type: 'select',
          tool: 'chest',
          agent: 'builder',
        },
      ],
    };

    const normalizedPlan = plan as Parameters<typeof createRuntimeAgentPlanExecutionState>[0];
    const state = createRuntimeAgentPlanExecutionState(normalizedPlan);
    expect(state.agentOrder).toEqual(['planner', 'builder']);

    const executionOrder: Array<{ agent: string; index: number }> = [];
    while (true) {
      const next = pickNextRuntimeAgentPlanCommand(normalizedPlan, state);
      if (next === null) {
        break;
      }

      executionOrder.push({ agent: next.agent, index: next.commandIndex });
    }

    expect(executionOrder).toEqual([
      { agent: 'planner', index: 0 },
      { agent: 'builder', index: 1 },
      { agent: 'planner', index: 2 },
      { agent: 'builder', index: 3 },
    ]);
    expect(pickNextRuntimeAgentPlanCommand(normalizedPlan, state)).toBeNull();
  });

  it('supports filtering enabled agents during selection', () => {
    const plan = {
      version: 1,
      commands: [
        {
          type: 'select',
          tool: 'belt',
          agent: 'planner',
        },
        {
          type: 'select',
          tool: 'furnace',
          agent: 'builder',
        },
        {
          type: 'select',
          tool: 'assembler',
          agent: 'planner',
        },
        {
          type: 'select',
          tool: 'chest',
          agent: 'builder',
        },
      ],
    };

    const normalizedPlan = plan as Parameters<typeof createRuntimeAgentPlanExecutionState>[0];
    const state = createRuntimeAgentPlanExecutionState(normalizedPlan);
    const enabled = new Set(['builder']);
    const executionOrder: Array<{ agent: string; index: number }> = [];
    while (true) {
      const next = pickNextRuntimeAgentPlanCommand(normalizedPlan, state, {
        enabledAgents: enabled,
      });
      if (next === null) {
        break;
      }
      executionOrder.push({ agent: next.agent, index: next.commandIndex });
    }

    expect(executionOrder).toEqual([
      { agent: 'builder', index: 1 },
      { agent: 'builder', index: 3 },
    ]);
    expect(pickNextRuntimeAgentPlanCommand(normalizedPlan, state, {
      enabledAgents: enabled,
    })).toBeNull();
  });

  it('summarizes per-agent progress and enabled state', () => {
    const plan = {
      version: 1,
      commands: [
        {
          type: 'select',
          tool: 'belt',
          agent: 'planner',
        },
        {
          type: 'select',
          tool: 'furnace',
          agent: 'planner',
        },
        {
          type: 'select',
          tool: 'chest',
          agent: 'builder',
        },
      ],
    };

    const normalizedPlan = plan as Parameters<typeof createRuntimeAgentPlanExecutionState>[0];
    const state = createRuntimeAgentPlanExecutionState(normalizedPlan);

    expect(pickNextRuntimeAgentPlanCommand(normalizedPlan, state)).not.toBeNull();
    expect(pickNextRuntimeAgentPlanCommand(normalizedPlan, state)).not.toBeNull();

    const summaries = summarizeRuntimePlanAgents(
      normalizedPlan,
      state,
      {
        planner: false,
        builder: true,
      },
    );

    expect(summaries).toEqual([
      {
        agent: 'planner',
        totalCommands: 2,
        completedCommands: 1,
        enabled: false,
      },
      {
        agent: 'builder',
        totalCommands: 1,
        completedCommands: 1,
        enabled: true,
      },
    ]);
  });

  it('classifies state-mutating runtime plan commands', () => {
    const mutating = [
      { type: 'place', x: 1, y: 2 },
      { type: 'remove', x: 1, y: 2 },
      { type: 'move', direction: 'N' },
      { type: 'step', ticks: 5 },
      { type: 'pause' },
      { type: 'resume' },
      { type: 'toggle-pause' },
      { type: 'interact', action: 'refuel' },
      { type: 'interact', action: 'pickup' },
      { type: 'interact', action: 'deposit', x: 1, y: 2 },
    ] as const;

    for (const command of mutating) {
      expect(isRuntimeAgentPlanCommandStateMutating(command)).toBe(true);
    }
  });

  it('does not snapshot non-simulation runtime plan commands', () => {
    const nonMutating = [
      { type: 'select', tool: 'belt' },
      { type: 'rotate', steps: 1 },
      { type: 'set-rotation', rotation: 2 },
      { type: 'enable-agent', targetAgent: 'builder' },
      { type: 'disable-agent', targetAgent: 'builder' },
      { type: 'set-plan-speed', delayMs: 120 },
      { type: 'set-agent-speed', targetAgent: 'planner', delayMs: 140 },
      { type: 'set-agent-order', order: ['planner', 'builder'] },
      { type: 'enable-automation', automationAgent: 'auto-refuel' },
      { type: 'disable-automation', automationAgent: 'auto-refuel' },
    ] as const;

    for (const command of nonMutating) {
      expect(isRuntimeAgentPlanCommandStateMutating(command)).toBe(false);
    }
  });

  it('parses plan commands that enable and disable agents', () => {
    const plan = {
      version: 1,
      commands: [
        {
          type: 'disable-agent',
          targetAgent: 'builder',
        },
        {
          type: 'enable-agent',
          target: 'planner',
        },
      ],
    };

    const validation = resolveRuntimeAgentPlanImportPayload(plan);
    expect(validation.errors).toEqual([]);
    expect(validation.plan).not.toBeNull();
    expect(validation.plan).toMatchObject({
      commands: [
        {
          type: 'disable-agent',
          targetAgent: 'builder',
        },
        {
          type: 'enable-agent',
          targetAgent: 'planner',
        },
      ],
    });
  });

  it('describes agent toggle plan commands for logs', () => {
    const disableCommand = {
      type: 'disable-agent',
      targetAgent: 'builder',
    } as const;
    const enableCommand = {
      type: 'enable-agent',
      targetAgent: 'planner',
    } as const;

    expect(describeRuntimeAgentPlanCommand(disableCommand)).toEqual({
      label: 'disable agent',
      details: 'builder',
    });
    expect(describeRuntimeAgentPlanCommand(enableCommand)).toEqual({
      label: 'enable agent',
      details: 'planner',
    });
  });

  it('describes agent speed plan commands for logs', () => {
    const command = {
      type: 'set-agent-speed',
      targetAgent: 'planner',
      delayMs: 140,
    } as const;

    expect(describeRuntimeAgentPlanCommand(command)).toEqual({
      label: 'set agent speed',
      details: 'planner -> 140ms',
    });
  });

  it('parses and normalizes automation control plan commands', () => {
    const validation = resolveRuntimeAgentPlanImportPayload({
      version: 1,
      commands: [
        {
          type: 'enable-automation',
          automationAgent: 'auto-refuel',
        },
        {
          type: 'disable-automation',
          automationAgentId: 'pickup',
        },
      ],
    });

    expect(validation.errors).toEqual([]);
    expect(validation.plan).not.toBeNull();
    expect(validation.plan).toMatchObject({
      commands: [
        {
          type: 'enable-automation',
          automationAgent: 'auto-refuel',
        },
        {
          type: 'disable-automation',
          automationAgent: 'auto-pickup',
        },
      ],
    });
  });

  it('describes automation plan commands for logs', () => {
    const enableCommand = {
      type: 'enable-automation',
      automationAgent: 'auto-refuel',
    } as const;
    const disableCommand = {
      type: 'disable-automation',
      automationAgent: 'auto-pickup',
    } as const;

    expect(describeRuntimeAgentPlanCommand(enableCommand)).toEqual({
      label: 'enable automation',
      details: 'auto-refuel',
    });
    expect(describeRuntimeAgentPlanCommand(disableCommand)).toEqual({
      label: 'disable automation',
      details: 'auto-pickup',
    });
  });

  it('parses and normalizes interact plan commands', () => {
    const validation = resolveRuntimeAgentPlanImportPayload({
      version: 1,
      commands: [
        {
          type: 'interact',
          action: 'refuel',
        },
        {
          type: 'interact',
          action: 'deposit',
          x: 3,
          y: 4,
          agent: 'Builder ',
        },
      ],
    });

    expect(validation.errors).toEqual([]);
    expect(validation.plan).not.toBeNull();
    expect(validation.plan).toMatchObject({
      commands: [
        {
          type: 'interact',
          action: 'refuel',
        },
        {
          type: 'interact',
          action: 'deposit',
          x: 3,
          y: 4,
          agent: 'Builder',
        },
      ],
    });
  });

  it('describes interact plan commands for logs', () => {
    const tileCommand = {
      type: 'interact',
      action: 'pickup',
      x: 5,
      y: 6,
    } as const;
    const selfCommand = {
      type: 'interact',
      action: 'deposit',
    } as const;

    expect(describeRuntimeAgentPlanCommand(tileCommand)).toEqual({
      label: 'interact',
      details: 'pickup (5, 6)',
    });
    expect(describeRuntimeAgentPlanCommand(selfCommand)).toEqual({
      label: 'interact',
      details: 'deposit self',
    });
  });

  it('rejects interact commands with malformed coordinates', () => {
    const validation = resolveRuntimeAgentPlanImportPayload({
      version: 1,
      commands: [
        {
          type: 'interact',
          action: 'pickup',
          x: -3,
          y: 4,
        },
      ],
    });

    expect(validation.errors).toEqual([
      'Plan payload is not a valid command list.',
    ]);
    expect(validation.plan).toBeNull();
  });

  it('clamps set-plan-speed delay values during import', () => {
    const validation = resolveRuntimeAgentPlanImportPayload({
      version: 1,
      commands: [
        {
          type: 'set-plan-speed',
          delayMs: 5000,
        },
      ],
    });

    expect(validation.errors).toEqual([]);
    expect(validation.plan).not.toBeNull();
    expect(validation.plan).toMatchObject({
      commands: [
        {
          type: 'set-plan-speed',
          delayMs: 2000,
        },
      ],
    });
  });

  it('normalizes set-agent-speed delay values during import', () => {
    const validation = resolveRuntimeAgentPlanImportPayload({
      version: 1,
      commands: [
        {
          type: 'set-agent-speed',
          targetAgent: ' planner ',
          delayMs: 5000,
          agent: 'planner ',
        },
      ],
    });

    expect(validation.errors).toEqual([]);
    expect(validation.plan).not.toBeNull();
    expect(validation.plan).toMatchObject({
      commands: [
        {
          type: 'set-agent-speed',
          targetAgent: 'planner',
          delayMs: 2000,
          agent: 'planner',
        },
      ],
    });
  });

  it('normalizes set-agent-order plan commands during import', () => {
    const validation = resolveRuntimeAgentPlanImportPayload({
      version: 1,
      commands: [
        {
          type: 'set-agent-order',
          order: [' builder ', 'planner', 'builder'],
          agent: 'planner ',
        },
      ],
    });

    expect(validation.errors).toEqual([]);
    expect(validation.plan).not.toBeNull();
    expect(validation.plan).toMatchObject({
      commands: [
        {
          type: 'set-agent-order',
          order: ['builder', 'planner'],
          agent: 'planner',
        },
      ],
    });
  });

  it('describes agent order plan commands for logs', () => {
    const command = {
      type: 'set-agent-order',
      order: ['planner', 'builder'],
    } as const;

    expect(describeRuntimeAgentPlanCommand(command)).toEqual({
      label: 'set agent order',
      details: 'planner -> builder',
    });
  });

  it('returns no command when all filtered agents are disabled', () => {
    const plan = {
      version: 1,
      commands: [
        {
          type: 'select',
          tool: 'belt',
          agent: 'planner',
        },
      ],
    };

    const normalizedPlan = plan as Parameters<typeof createRuntimeAgentPlanExecutionState>[0];
    const state = createRuntimeAgentPlanExecutionState(normalizedPlan);
    expect(pickNextRuntimeAgentPlanCommand(normalizedPlan, state, {
      enabledAgents: new Set<string>(),
    })).toBeNull();
  });

  it('validates oversized runtime plans before import', () => {
    const hugePlan = {
      version: 1,
      commands: Array.from({ length: 6000 }, () => ({ type: 'pause' as const })),
    };

    const validation = validateRuntimeAgentPlanPayloadForImport(hugePlan);
    expect(validation.errors.length).toBeGreaterThan(0);
    expect(validation.errors[0]).toMatch(/5000/);
  });

  it('warns when importing an empty runtime plan', () => {
    const emptyPlan = {
      version: 1,
      commands: [],
    };

    const validation = validateRuntimeAgentPlanPayloadForImport(emptyPlan);
    expect(validation.errors).toEqual([]);
    expect(validation.warnings).toEqual(expect.arrayContaining(['Plan has no commands.']));
    expect(validation.plan).not.toBeNull();
  });

  it('formats warning list for user-facing messages', () => {
    expect(formatRuntimeAgentPlanWarnings([])).toEqual('');
    expect(formatRuntimeAgentPlanWarnings(['Legacy command list detected.'])).toEqual(
      ' Warnings: Legacy command list detected.',
    );
    expect(formatRuntimeAgentPlanWarnings(['Schema mismatch.', 'Plan has no commands.'])).toEqual(
      ' Warnings: Schema mismatch. Plan has no commands.',
    );
  });

  it('normalizes agent identifiers during runtime plan import', () => {
    const whitespacePlan = {
      version: 1,
      commands: [
        {
          type: 'select',
          tool: 'belt',
          agent: '  planner  ',
        },
        {
          type: 'rotate',
          steps: 1,
          agent: '\n\t',
        },
      ],
    };

    const validation = validateRuntimeAgentPlanPayloadForImport(whitespacePlan);
    expect(validation.errors).toEqual([]);
    expect(validation.plan).not.toBeNull();

    const commands = validation.plan!.commands;
    expect(commands).toHaveLength(2);
    expect(commands[0]).toMatchObject({
      type: 'select',
      tool: 'Belt',
      agent: 'planner',
    });
    expect(commands[1]).toMatchObject({
      type: 'rotate',
      steps: 1,
    });
    expect('agent' in commands[1]).toBe(false);
  });

  it('supports wrapped storage payload import with preserved per-agent enablement', () => {
    const wrapped = {
      schemaVersion: 1,
      plan: {
        version: 1,
        commands: [
          {
            type: 'select',
            tool: 'belt',
            agent: 'planner',
          },
          {
            type: 'step',
            ticks: 2,
            agent: 'builder',
          },
        ],
      },
      enabledAgents: {
        planner: false,
        builder: true,
        ghost: true,
      },
    };

    const result = resolveRuntimeAgentPlanImportPayload(wrapped);

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.plan).not.toBeNull();
    expect(result.enabledAgents).toEqual({
      planner: false,
      builder: true,
    });
  });

  it('warns when loading a plan schema newer than this app', () => {
    const futurePlan = {
      schemaVersion: 99,
      version: 1,
      commands: [
        {
          type: 'pause',
        },
      ],
    };

    const result = resolveRuntimeAgentPlanImportPayload(futurePlan);

    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('newer than the current app schema');
  });

  it('clamps plan speed slider values', () => {
    expect(clampRuntimePlanStepDelayMs(-100)).toBe(20);
    expect(clampRuntimePlanStepDelayMs(2_500)).toBe(2_000);
    expect(clampRuntimePlanStepDelayMs(55)).toBe(55);
    expect(clampRuntimePlanStepDelayMs('bad' as unknown as number)).toBe(80);
  });

  it('describes runtime plan commands without side effects', () => {
    const command = {
      type: 'step',
      ticks: 12,
      agent: 'planner',
    } as const;

    expect(describeRuntimeAgentPlanCommand(command)).toEqual({
      label: 'step',
      details: '12 ticks',
    });
    expect(describeRuntimeAgentPlanCommandForLog(command)).toBe('step 12 ticks [planner]');
    expect(describeNextRuntimeAgentPlanCommand(null)).toBe('No pending command.');
  });

  it('peeks next runtime plan command without mutating execution state', () => {
    const plan = {
      version: 1,
      commands: [
        {
          type: 'select',
          tool: 'belt',
          agent: 'planner',
        },
        {
          type: 'step',
          ticks: 1,
          agent: 'builder',
        },
      ],
    };

    const normalizedPlan = plan as Parameters<typeof createRuntimeAgentPlanExecutionState>[0];
    const executionState = createRuntimeAgentPlanExecutionState(normalizedPlan);
    const before = cloneRuntimeAgentPlanExecutionState(executionState);
    const peeked = peekNextRuntimeAgentPlanCommand(normalizedPlan, executionState, {
      enabledAgents: new Set(['builder', 'planner']),
    });

    expect(peeked).not.toBeNull();
    expect(peeked).toMatchObject({ agent: 'planner', commandIndex: 0 });
    expect(executionState).toEqual(before);
    expect(executionState).toMatchObject(before);

    const consumed = pickNextRuntimeAgentPlanCommand(normalizedPlan, executionState, {
      enabledAgents: new Set(['builder', 'planner']),
    });
    expect(consumed).toMatchObject(peeked);
  });
});
