import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostEventEnvelope } from '@zana-ai/zcc-contracts/host-rpc';
import {
  createAgentRuntimeWithAdapters,
  createFakeAdapter,
  fakeProviderScriptPath
} from '@zana-ai/zcc-agent-runtime/test';
import {
  createAgentRuntimeAdapter,
  mapRuntimeThreadEvent,
  mergeSessionTooling,
  resolveRuntimeBridgeLaunch,
  threadExecutionOptions
} from './agent-runtime-adapter.js';
import type { PromptInput, ThreadEvent } from '@zana-ai/zcc-domain/thread-runtime';

function prompt(...chunks: string[]): PromptInput[] {
  return chunks.map((text) => ({ type: 'text' as const, text, mentions: [] }));
}

describe('agent runtime thread adapter', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'zcc-agent-rt-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('merges plugin tools with remote proxy tooling', () => {
    expect(mergeSessionTooling({
      remoteProxy: false,
      dynamicTools: [{ name: 'sf_soql', description: 'SOQL', inputSchema: {} }],
      instructions: 'Use sf_soql.'
    })).toEqual({
      dynamicTools: [{ name: 'sf_soql', description: 'SOQL', inputSchema: {} }],
      instructions: 'Use sf_soql.'
    });
    expect(mergeSessionTooling({ remoteProxy: false })).toEqual({});
    const remote = mergeSessionTooling({
      remoteProxy: true,
      dynamicTools: [{ name: 'sf_soql', description: 'SOQL', inputSchema: {} }],
      instructions: 'Use Salesforce tools.'
    });
    expect(remote.disallowedTools).toEqual(expect.arrayContaining(['Bash', 'Read']));
    expect(remote.dynamicTools?.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['remote_exec', 'sf_soql'])
    );
    expect(remote.instructions).toMatch(/remote_read/);
    expect(remote.instructions).toMatch(/Use Salesforce tools/);
  });

  it('starts a thread through AgentRuntime without PtyManager', async () => {
    const events: HostEventEnvelope[] = [];
    const adapter = createAgentRuntimeAdapter({
      emit: (event) => events.push(event),
      dataDir: cwd,
      createRuntime: (options) =>
        createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter({ scriptPath: fakeProviderScriptPath })
        })
    });
    const threadId = randomUUID();
    await adapter.startWork({
      threadId,
      environmentId: randomUUID(),
      projectId: 'p1',
      providerId: 'fake',
      input: prompt('hello'),
      cwd
    });
    expect(events.some((event) => event.threadId === threadId)).toBe(true);
    await adapter.stopWork({ threadId });
    adapter.dispose();
  });

  it('forwards command mentions into AgentRuntime instead of wiping them', async () => {
    const started: Array<{ input: PromptInput[] }> = [];
    const turned: Array<{ input: PromptInput[] }> = [];
    const adapter = createAgentRuntimeAdapter({
      emit: () => undefined,
      dataDir: cwd,
      createRuntime: (options) => {
        const runtime = createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter({ scriptPath: fakeProviderScriptPath })
        });
        return {
          ...runtime,
          startThread: async (input) => {
            started.push({ input: input.input });
            return runtime.startThread(input);
          },
          runTurn: async (input) => {
            turned.push({ input: input.input });
            return runtime.runTurn(input);
          }
        };
      }
    });
    const threadId = randomUUID();
    const planInput: PromptInput[] = [{
      type: 'text',
      text: '/plan inspect',
      mentions: [{
        start: 0,
        end: 5,
        resource: {
          kind: 'command',
          trigger: '/',
          name: 'plan',
          source: 'command',
          origin: 'builtin',
          label: 'plan',
          argumentHint: null
        }
      }]
    }];
    await adapter.startWork({
      threadId,
      environmentId: randomUUID(),
      projectId: 'p1',
      providerId: 'fake',
      input: planInput,
      cwd
    });
    await adapter.submitTurn({ threadId, input: planInput });
    adapter.dispose();
    expect(started[0]?.input).toEqual(planInput);
    expect(turned[0]?.input).toEqual(planInput);
  });

  it('applies Settings provider-bridge recording to process env before start', async () => {
    const { resetProviderBridgeRecordDirEnvSync } = await import('./provider-bridge-record-env.js');
    const previous = process.env.ZCC_PROVIDER_BRIDGE_RECORD_DIR;
    delete process.env.ZCC_PROVIDER_BRIDGE_RECORD_DIR;
    resetProviderBridgeRecordDirEnvSync();
    const adapter = createAgentRuntimeAdapter({
      emit: () => undefined,
      dataDir: cwd,
      loadConfig: () => ({
        version: 1,
        theme: 'dark',
        shell: '/bin/zsh',
        claudeBinary: 'claude',
        fontSize: 13,
        lastProjectId: null,
        providerBridgeRecordingEnabled: true
      }),
      createRuntime: (options) =>
        createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter({ scriptPath: fakeProviderScriptPath })
        })
    });
    const threadId = randomUUID();
    try {
      await adapter.startWork({
        threadId,
        environmentId: randomUUID(),
        projectId: 'p1',
        providerId: 'fake',
        input: prompt('hello'),
        cwd
      });
      expect(process.env.ZCC_PROVIDER_BRIDGE_RECORD_DIR).toBe(
        join(cwd, 'provider-recordings', 'raw')
      );
      await adapter.stopWork({ threadId });
    } finally {
      adapter.dispose();
      resetProviderBridgeRecordDirEnvSync();
      if (previous === undefined) delete process.env.ZCC_PROVIDER_BRIDGE_RECORD_DIR;
      else process.env.ZCC_PROVIDER_BRIDGE_RECORD_DIR = previous;
    }
  });

  it('runs a follow-up turn on the same AgentRuntime', async () => {
    const events: HostEventEnvelope[] = [];
    const adapter = createAgentRuntimeAdapter({
      emit: (event) => events.push(event),
      dataDir: cwd,
      createRuntime: (options) =>
        createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter({ scriptPath: fakeProviderScriptPath })
        })
    });
    const threadId = randomUUID();
    await adapter.startWork({
      threadId,
      environmentId: randomUUID(),
      projectId: 'p1',
      providerId: 'fake',
      input: prompt('hello'),
      cwd
    });
    await adapter.submitTurn({ threadId, input: prompt('follow up') });
    await adapter.stopWork({ threadId });
    adapter.dispose();
    expect(events.some((event) => event.kind === 'turn.completed' || event.kind === 'thread.event')).toBe(true);
  });

  it('passes model and reasoningLevel through startThread and runTurn', async () => {
    let startThread: ReturnType<typeof vi.spyOn>;
    let runTurn: ReturnType<typeof vi.spyOn>;
    let steerTurn: ReturnType<typeof vi.spyOn>;
    const adapter = createAgentRuntimeAdapter({
      emit: () => undefined,
      dataDir: cwd,
      createRuntime: (options) => {
        const runtime = createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter({ scriptPath: fakeProviderScriptPath })
        });
        startThread = vi.spyOn(runtime, 'startThread');
        runTurn = vi.spyOn(runtime, 'runTurn');
        steerTurn = vi.spyOn(runtime, 'steerTurn');
        return runtime;
      }
    });
    const threadId = randomUUID();
    await adapter.startWork({
      threadId,
      environmentId: randomUUID(),
      projectId: 'p1',
      providerId: 'fake',
      input: prompt('hello'),
      cwd,
      model: 'claude-sonnet-5',
      reasoningLevel: 'high'
    });
    await adapter.submitTurn({
      threadId,
      input: prompt('follow up'),
      model: 'claude-sonnet-5',
      reasoningLevel: 'xhigh'
    });
    adapter.dispose();
    expect(startThread!.mock.calls[0]?.[0]).toMatchObject({
      options: { model: 'claude-sonnet-5', reasoningLevel: 'high' }
    });
    const followUp = [...runTurn!.mock.calls, ...steerTurn!.mock.calls]
      .map((call) => call[0])
      .find((args) => args?.options?.reasoningLevel === 'xhigh');
    expect(followUp).toMatchObject({
      options: { model: 'claude-sonnet-5', reasoningLevel: 'xhigh' }
    });
  });

  it('sends a valid full policy on follow-up even when submit asks to escalate', async () => {
    const turned: Array<{ permissionMode?: string; permissionEscalation?: string | null }> = [];
    const adapter = createAgentRuntimeAdapter({
      emit: () => undefined,
      dataDir: cwd,
      createRuntime: (options) => {
        const runtime = createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter({ scriptPath: fakeProviderScriptPath })
        });
        return {
          ...runtime,
          runTurn: async (input) => {
            turned.push(input.options);
            return runtime.runTurn(input);
          }
        };
      }
    });
    const threadId = randomUUID();
    await adapter.startWork({
      threadId,
      environmentId: randomUUID(),
      projectId: 'p1',
      providerId: 'fake',
      input: prompt('hello'),
      cwd
    });
    await adapter.submitTurn({
      threadId,
      input: prompt('follow up'),
      permissionEscalation: 'ask'
    });
    adapter.dispose();
    expect(turned[0]).toMatchObject({
      permissionMode: 'full',
      permissionEscalation: null
    });
  });

  it('keeps accept-edits deny escalation on follow-up turns', async () => {
    const turned: Array<{ permissionMode?: string; permissionEscalation?: string | null }> = [];
    const adapter = createAgentRuntimeAdapter({
      emit: () => undefined,
      dataDir: cwd,
      createRuntime: (options) => {
        const runtime = createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter({ scriptPath: fakeProviderScriptPath })
        });
        return {
          ...runtime,
          runTurn: async (input) => {
            turned.push(input.options);
            return runtime.runTurn(input);
          }
        };
      }
    });
    const threadId = randomUUID();
    await adapter.startWork({
      threadId,
      environmentId: randomUUID(),
      projectId: 'p1',
      providerId: 'fake',
      input: prompt('hello'),
      cwd,
      permissionMode: 'accept-edits'
    });
    await adapter.submitTurn({
      threadId,
      input: prompt('follow up'),
      permissionMode: 'accept-edits',
      permissionEscalation: 'deny'
    });
    adapter.dispose();
    expect(turned[0]).toMatchObject({
      permissionMode: 'accept-edits',
      permissionEscalation: 'deny'
    });
  });

  it('passes a checkpoint fork through startThread', async () => {
    const forks: Array<{ sourceProviderThreadId: string; sourceProviderCheckpointId?: string }> = [];
    const adapter = createAgentRuntimeAdapter({
      emit: () => undefined,
      dataDir: cwd,
      createRuntime: (options) => {
        const runtime = createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter({ scriptPath: fakeProviderScriptPath })
        });
        return {
          ...runtime,
          startThread: async (input) => {
            if (input.fork) forks.push(input.fork);
            return runtime.startThread(input);
          }
        };
      }
    });
    const threadId = randomUUID();
    await adapter.startWork({
      threadId,
      environmentId: randomUUID(),
      projectId: 'p1',
      providerId: 'fake',
      input: prompt('from checkpoint'),
      cwd,
      providerThreadId: 'prov-source',
      providerCheckpointId: 'cp-9'
    });
    adapter.dispose();
    expect(forks).toEqual([{
      sourceProviderThreadId: 'prov-source',
      sourceProviderCheckpointId: 'cp-9'
    }]);
  });

  it('forwards clientRequestId into startThread and runTurn', async () => {
    const started: (string | undefined)[] = [];
    const turned: string[] = [];
    const adapter = createAgentRuntimeAdapter({
      emit: () => undefined,
      dataDir: cwd,
      createRuntime: (options) => {
        const runtime = createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter({ scriptPath: fakeProviderScriptPath })
        });
        return {
          ...runtime,
          startThread: async (input) => {
            started.push(input.clientRequestId);
            return runtime.startThread(input);
          },
          runTurn: async (input) => {
            turned.push(input.clientRequestId);
            return runtime.runTurn(input);
          }
        };
      }
    });
    const threadId = randomUUID();
    await adapter.startWork({
      threadId,
      environmentId: randomUUID(),
      projectId: 'p1',
      providerId: 'fake',
      input: prompt('hello'),
      cwd,
      clientRequestId: 'creq_23456789ab'
    });
    await adapter.submitTurn({
      threadId,
      input: prompt('follow up'),
      clientRequestId: 'creq_23456789ac'
    });
    adapter.dispose();
    expect(started).toEqual(['creq_23456789ab']);
    expect(turned).toEqual(['creq_23456789ac']);
  });

  it('steers an active turn instead of runTurn when mode is steer', async () => {
    const steered: string[] = [];
    const turned: string[] = [];
    const adapter = createAgentRuntimeAdapter({
      emit: () => undefined,
      dataDir: cwd,
      createRuntime: (options) => {
        const runtime = createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter({ scriptPath: fakeProviderScriptPath })
        });
        return {
          ...runtime,
          getActiveTurnId: () => 'turn-live',
          steerTurn: async (input: { input: Array<{ type: string; text: string }> }) => {
            steered.push(input.input[0]?.text ?? '');
          },
          runTurn: async (input: { input: Array<{ type: string; text: string }> }) => {
            turned.push(input.input[0]?.text ?? '');
          }
        };
      }
    });
    const threadId = randomUUID();
    await adapter.startWork({
      threadId,
      environmentId: randomUUID(),
      projectId: 'p1',
      providerId: 'fake',
      input: prompt('hello'),
      cwd
    });
    await adapter.submitTurn({
      threadId,
      input: prompt('nudge'),
      mode: 'steer'
    });
    await adapter.submitTurn({
      threadId,
      input: prompt('next'),
      mode: 'auto'
    });
    adapter.dispose();
    expect(steered).toEqual(['nudge', 'next']);
    expect(turned).toEqual([]);
  });

  it('starts a new Auto turn when no turn is active', async () => {
    const steered: string[] = [];
    const turned: string[] = [];
    const adapter = createAgentRuntimeAdapter({
      emit: () => undefined,
      dataDir: cwd,
      createRuntime: (options) => {
        const runtime = createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter({ scriptPath: fakeProviderScriptPath })
        });
        return {
          ...runtime,
          getActiveTurnId: () => null,
          steerTurn: async (input: { input: Array<{ type: string; text: string }> }) => {
            steered.push(input.input[0]?.text ?? '');
          },
          runTurn: async (input: { input: Array<{ type: string; text: string }> }) => {
            turned.push(input.input[0]?.text ?? '');
          }
        };
      }
    });
    const threadId = randomUUID();
    await adapter.startWork({
      threadId,
      environmentId: randomUUID(),
      projectId: 'p1',
      providerId: 'fake',
      input: prompt('hello'),
      cwd
    });
    await adapter.submitTurn({
      threadId,
      input: prompt('next'),
      mode: 'auto'
    });
    adapter.dispose();
    expect(steered).toEqual([]);
    expect(turned).toEqual(['next']);
  });

  it('returns from startWork before a delayed fake turn completes', async () => {
    const adapter = createAgentRuntimeAdapter({
      emit: () => undefined,
      dataDir: cwd,
      createRuntime: (options) =>
        createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter({ scriptPath: fakeProviderScriptPath })
        })
    });
    const threadId = randomUUID();
    const startedAt = Date.now();
    await adapter.startWork({
      threadId,
      environmentId: randomUUID(),
      projectId: 'p1',
      providerId: 'fake',
      input: prompt('delay:2000 keep this turn alive'),
      cwd,
      clientRequestId: 'creq_23456789ab'
    });
    expect(Date.now() - startedAt).toBeLessThan(1500);
    adapter.dispose();
  });

  it('steers a live delayed fake turn and accepts the Auto follow-up', async () => {
    const events: HostEventEnvelope[] = [];
    const adapter = createAgentRuntimeAdapter({
      emit: (event) => events.push(event),
      dataDir: cwd,
      createRuntime: (options) =>
        createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter({ scriptPath: fakeProviderScriptPath })
        })
    });
    const threadId = randomUUID();
    await adapter.startWork({
      threadId,
      environmentId: randomUUID(),
      projectId: 'p1',
      providerId: 'fake',
      input: prompt('delay:2000 keep this turn alive'),
      cwd,
      clientRequestId: 'creq_23456789ab'
    });
    await vi.waitFor(() => {
      expect(events.some((event) => {
        const payload = event.payload as { type?: string } | undefined;
        return payload?.type === 'turn/started';
      })).toBe(true);
    });
    await adapter.submitTurn({
      threadId,
      input: prompt('Is it done ?'),
      mode: 'auto',
      clientRequestId: 'creq_23456789ac'
    });
    expect(events.some((event) => {
      const payload = event.payload as { type?: string; clientRequestId?: string } | undefined;
      return payload?.type === 'turn/input/accepted' && payload.clientRequestId === 'creq_23456789ac';
    })).toBe(true);
    adapter.dispose();
  });

  it('accepts two Auto follow-ups while a delayed fake turn is live', async () => {
    const events: HostEventEnvelope[] = [];
    const adapter = createAgentRuntimeAdapter({
      emit: (event) => events.push(event),
      dataDir: cwd,
      createRuntime: (options) =>
        createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter({ scriptPath: fakeProviderScriptPath })
        })
    });
    const threadId = randomUUID();
    await adapter.startWork({
      threadId,
      environmentId: randomUUID(),
      projectId: 'p1',
      providerId: 'fake',
      input: prompt('delay:2000 keep this turn alive'),
      cwd,
      clientRequestId: 'creq_23456789ab'
    });
    await vi.waitFor(() => {
      expect(events.some((event) => {
        const payload = event.payload as { type?: string } | undefined;
        return payload?.type === 'turn/started';
      })).toBe(true);
    });
    await Promise.all([
      adapter.submitTurn({
        threadId,
        input: prompt('Is it done ?'),
        mode: 'auto',
        clientRequestId: 'creq_23456789ac'
      }),
      adapter.submitTurn({
        threadId,
        input: prompt('Is it done yet?'),
        mode: 'auto',
        clientRequestId: 'creq_23456789ad'
      })
    ]);
    const accepted = events.flatMap((event) => {
      const payload = event.payload as { type?: string; clientRequestId?: string } | undefined;
      return payload?.type === 'turn/input/accepted' && payload.clientRequestId
        ? [payload.clientRequestId]
        : [];
    });
    expect(accepted).toEqual(expect.arrayContaining(['creq_23456789ac', 'creq_23456789ad']));
    adapter.dispose();
  });

  it('resumes a thread through AgentRuntime', async () => {
    const events: HostEventEnvelope[] = [];
    const adapter = createAgentRuntimeAdapter({
      emit: (event) => events.push(event),
      dataDir: cwd,
      createRuntime: (options) =>
        createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter({ scriptPath: fakeProviderScriptPath })
        })
    });
    const threadId = randomUUID();
    const started = await adapter.startWork({
      threadId,
      environmentId: randomUUID(),
      projectId: 'p1',
      providerId: 'fake',
      input: prompt('hello'),
      cwd
    });
    await adapter.stopWork({ threadId });
    if (started?.providerThreadId) {
      await adapter.resumeWork({
        threadId,
        environmentId: randomUUID(),
        projectId: 'p1',
        providerId: 'fake',
        providerThreadId: started.providerThreadId,
        cwd
      });
    }
    adapter.dispose();
    expect(events.length).toBeGreaterThan(0);
  });

  it('reuses one AgentRuntime for threads in the same environment', async () => {
    const created: string[] = [];
    const adapter = createAgentRuntimeAdapter({
      emit: () => undefined,
      dataDir: cwd,
      createRuntime: (options) => {
        created.push(options.workspacePath);
        return createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter({ scriptPath: fakeProviderScriptPath })
        });
      }
    });
    const environmentId = randomUUID();
    const otherCwd = join(cwd, 'other');
    mkdirSync(otherCwd, { recursive: true });
    await adapter.startWork({
      threadId: randomUUID(),
      environmentId,
      projectId: 'p1',
      providerId: 'fake',
      input: prompt('one'),
      cwd
    });
    await adapter.startWork({
      threadId: randomUUID(),
      environmentId,
      projectId: 'p1',
      providerId: 'fake',
      input: prompt('two'),
      cwd: otherCwd
    });
    adapter.dispose();
    expect(created).toEqual([cwd]);
  });

  it('denies native fs/shell tools and attaches remote dynamic tools without ssh -t', async () => {
    const started: Array<{
      disallowedTools?: readonly string[];
      instructions?: string;
      dynamicTools?: Array<{ name: string }>;
    }> = [];
    const adapter = createAgentRuntimeAdapter({
      emit: () => undefined,
      dataDir: cwd,
      createRuntime: (options) => {
        const runtime = createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter({ scriptPath: fakeProviderScriptPath })
        });
        return {
          ...runtime,
          startThread: async (input) => {
            started.push({
              disallowedTools: input.disallowedTools,
              instructions: input.instructions,
              dynamicTools: input.dynamicTools
            });
            return runtime.startThread(input);
          }
        };
      }
    });
    await adapter.startWork({
      threadId: randomUUID(),
      environmentId: randomUUID(),
      projectId: 'p-ssh',
      providerId: 'fake',
      input: prompt('inspect remote'),
      cwd,
      remote: { host: 'devbox', user: 'me', remotePath: '/src' },
      remoteToolProxy: true
    });
    adapter.dispose();
    expect(started[0]?.disallowedTools).toEqual(expect.arrayContaining(['Bash', 'Read', 'Write']));
    expect(started[0]?.instructions).toMatch(/remote_read/);
    expect(started[0]?.dynamicTools?.map((tool) => tool.name)).toContain('remote_exec');
  });

  it('attaches plugin dynamicTools on start and resume', async () => {
    const started: Array<{ dynamicTools?: Array<{ name: string }>; instructions?: string }> = [];
    const resumed: Array<{ dynamicTools?: Array<{ name: string }>; instructions?: string }> = [];
    const adapter = createAgentRuntimeAdapter({
      emit: () => undefined,
      dataDir: cwd,
      createRuntime: (options) => {
        const runtime = createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter({ scriptPath: fakeProviderScriptPath })
        });
        return {
          ...runtime,
          startThread: async (input) => {
            started.push({ dynamicTools: input.dynamicTools, instructions: input.instructions });
            return runtime.startThread(input);
          },
          resumeThread: async (input) => {
            resumed.push({ dynamicTools: input.dynamicTools, instructions: input.instructions });
            return runtime.resumeThread(input);
          }
        };
      }
    });
    const threadId = randomUUID();
    const environmentId = randomUUID();
    const pluginTool = {
      name: 'sf_soql',
      description: 'Run SOQL',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } }
    };
    await adapter.startWork({
      threadId,
      environmentId,
      projectId: 'p1',
      providerId: 'fake',
      input: prompt('hello'),
      cwd,
      dynamicTools: [pluginTool],
      instructions: 'Use sf_soql.'
    });
    await adapter.resumeWork({
      threadId,
      environmentId,
      projectId: 'p1',
      providerId: 'fake',
      providerThreadId: 'prov-1',
      cwd,
      dynamicTools: [pluginTool],
      instructions: 'Use sf_soql.'
    });
    adapter.dispose();
    expect(started[0]).toEqual({
      dynamicTools: [pluginTool],
      instructions: 'Use sf_soql.'
    });
    expect(resumed[0]).toEqual({
      dynamicTools: [pluginTool],
      instructions: 'Use sf_soql.'
    });
  });

  it('merges plugin tools after remote proxy tools', async () => {
    const started: Array<{ dynamicTools?: Array<{ name: string }>; instructions?: string }> = [];
    const adapter = createAgentRuntimeAdapter({
      emit: () => undefined,
      dataDir: cwd,
      createRuntime: (options) => {
        const runtime = createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter({ scriptPath: fakeProviderScriptPath })
        });
        return {
          ...runtime,
          startThread: async (input) => {
            started.push({ dynamicTools: input.dynamicTools, instructions: input.instructions });
            return runtime.startThread(input);
          }
        };
      }
    });
    await adapter.startWork({
      threadId: randomUUID(),
      environmentId: randomUUID(),
      projectId: 'p-ssh',
      providerId: 'fake',
      input: prompt('inspect remote'),
      cwd,
      remote: { host: 'devbox', user: 'me', remotePath: '/src' },
      remoteToolProxy: true,
      dynamicTools: [{ name: 'sf_soql', description: 'SOQL', inputSchema: {} }],
      instructions: 'Use Salesforce tools.'
    });
    adapter.dispose();
    expect(started[0]?.dynamicTools?.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['remote_exec', 'sf_soql'])
    );
    expect(started[0]?.instructions).toMatch(/remote_read/);
    expect(started[0]?.instructions).toMatch(/Use Salesforce tools/);
  });

  it('dispatches non-remote tool calls through onPluginToolCall', async () => {
    let onToolCall: ((request: {
      threadId: string;
      tool: string;
      arguments?: unknown;
      providerThreadId: string;
      turnId: string;
      callId: string;
      requestId: string;
    }) => Promise<{ success: boolean; contentItems: Array<{ type: 'inputText'; text: string }> }>) | undefined;
    const pluginCalls: string[] = [];
    const adapter = createAgentRuntimeAdapter({
      emit: () => undefined,
      dataDir: cwd,
      onPluginToolCall: async (request) => {
        pluginCalls.push(request.tool);
        return {
          success: true,
          contentItems: [{ type: 'inputText', text: `ran ${request.tool}` }]
        };
      },
      createRuntime: (options) => {
        onToolCall = options.onToolCall as typeof onToolCall;
        return createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter({ scriptPath: fakeProviderScriptPath })
        });
      }
    });
    const threadId = randomUUID();
    await adapter.startWork({
      threadId,
      environmentId: randomUUID(),
      projectId: 'p1',
      providerId: 'fake',
      input: prompt('hello'),
      cwd
    });
    await expect(onToolCall!({
      requestId: '1',
      threadId,
      providerThreadId: 'prov-1',
      turnId: 'turn-1',
      callId: 'call-1',
      tool: 'sf_soql',
      arguments: { query: 'SELECT Id FROM Account' }
    })).resolves.toEqual({
      success: true,
      contentItems: [{ type: 'inputText', text: 'ran sf_soql' }]
    });
    expect(pluginCalls).toEqual(['sf_soql']);
    adapter.dispose();
  });

  it('maps onPluginToolCall throws to an unsuccessful tool result', async () => {
    let onToolCall: ((request: {
      threadId: string;
      tool: string;
      arguments?: unknown;
      providerThreadId: string;
      turnId: string;
      callId: string;
      requestId: string;
    }) => Promise<{ success: boolean; contentItems: Array<{ type: 'inputText'; text: string }> }>) | undefined;
    const adapter = createAgentRuntimeAdapter({
      emit: () => undefined,
      dataDir: cwd,
      onPluginToolCall: async () => {
        throw new Error('host offline');
      },
      createRuntime: (options) => {
        onToolCall = options.onToolCall as typeof onToolCall;
        return createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter({ scriptPath: fakeProviderScriptPath })
        });
      }
    });
    const threadId = randomUUID();
    await adapter.startWork({
      threadId,
      environmentId: randomUUID(),
      projectId: 'p1',
      providerId: 'fake',
      input: prompt('hello'),
      cwd
    });
    await expect(onToolCall!({
      requestId: '1',
      threadId,
      providerThreadId: 'prov-1',
      turnId: 'turn-1',
      callId: 'call-1',
      tool: 'sf_apex'
    })).resolves.toMatchObject({
      success: false,
      contentItems: [{ type: 'inputText', text: expect.stringContaining('host offline') }]
    });
    adapter.dispose();
  });

  it('does not deny native tools when remoteToolProxy is off', async () => {
    const started: Array<{ disallowedTools?: readonly string[] }> = [];
    const adapter = createAgentRuntimeAdapter({
      emit: () => undefined,
      dataDir: cwd,
      createRuntime: (options) => {
        const runtime = createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter({ scriptPath: fakeProviderScriptPath })
        });
        return {
          ...runtime,
          startThread: async (input) => {
            started.push({ disallowedTools: input.disallowedTools });
            return runtime.startThread(input);
          }
        };
      }
    });
    await adapter.startWork({
      threadId: randomUUID(),
      environmentId: randomUUID(),
      projectId: 'p-ssh',
      providerId: 'fake',
      input: prompt('hello'),
      cwd,
      remote: { host: 'devbox' }
    });
    adapter.dispose();
    expect(started[0]?.disallowedTools).toBeUndefined();
  });

  it('passes a packed bridge bundle dir into AgentRuntime', async () => {
    const seen: Array<{ bridgeBundleDir?: string }> = [];
    const adapter = createAgentRuntimeAdapter({
      emit: () => undefined,
      dataDir: cwd,
      bridgeBundleDir: '/tmp/zcc-packed-bridges',
      createRuntime: (options) => {
        seen.push({ bridgeBundleDir: options.bridgeBundleDir });
        return createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter({ scriptPath: fakeProviderScriptPath })
        });
      }
    });
    await adapter.startWork({
      threadId: randomUUID(),
      environmentId: randomUUID(),
      projectId: 'p1',
      providerId: 'fake',
      input: prompt('hello'),
      cwd
    });
    expect(seen).toEqual([{ bridgeBundleDir: '/tmp/zcc-packed-bridges' }]);
    adapter.dispose();
  });

  it('lists fake provider models through AgentRuntime', async () => {
    const adapter = createAgentRuntimeAdapter({
      emit: () => undefined,
      dataDir: cwd,
      createRuntime: (options) =>
        createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter({ scriptPath: fakeProviderScriptPath })
        })
    });
    const listed = await adapter.listModels({
      providerId: 'fake',
      bridgeLaunch: {
        pluginId: 'provider-fake',
        source: { kind: 'daemon-bundled', id: 'fake' },
        capabilities: {
          supportsServiceTier: false,
          permissionModes: ['full'],
          supportsThreadArchive: false,
          supportsThreadRename: false,
          fork: 'checkpoint'
        }
      }
    });
    expect(listed.models.length).toBeGreaterThan(0);
    expect(listed.models[0]?.model).toBeTruthy();
    adapter.dispose();
  });

  it('reports unsupported health for the fake provider through AgentRuntime', async () => {
    const adapter = createAgentRuntimeAdapter({
      emit: () => undefined,
      dataDir: cwd,
      createRuntime: (options) =>
        createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter({ scriptPath: fakeProviderScriptPath })
        })
    });
    const health = await adapter.providerHealth({
      providerId: 'fake',
      bridgeLaunch: {
        pluginId: 'provider-fake',
        source: { kind: 'daemon-bundled', id: 'fake' },
        capabilities: {
          supportsServiceTier: false,
          permissionModes: ['full'],
          supportsThreadArchive: false,
          supportsThreadRename: false,
          fork: 'checkpoint'
        }
      }
    });
    expect(health).toEqual({ supported: false });
    adapter.dispose();
  });

  it('resolves an artifact launch to the cached host.js path, not a laptop source path', async () => {
    const bytes = new Uint8Array(Buffer.from('export default "cached";\n'));
    const digest = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
    const fetchPluginHostArtifact = vi.fn(async () => bytes);
    const launch = {
      pluginId: 'provider-acp',
      source: { kind: 'artifact' as const, digest, byteLength: bytes.byteLength },
      capabilities: {
        supportsServiceTier: true,
        permissionModes: ['full'],
        supportsThreadArchive: false,
        supportsThreadRename: false,
        fork: 'tip'
      }
    };
    const first = await resolveRuntimeBridgeLaunch({
      launch,
      daemonDataDir: cwd,
      fetchPluginHostArtifact
    });
    expect(first.source.kind).toBe('artifact');
    if (first.source.kind === 'artifact') {
      expect(first.source.artifactPath).toBe(
        join(cwd, 'plugin-host-artifacts', 'provider-acp', digest, 'host.js')
      );
      expect(first.source.artifactPath).not.toMatch(/bridge\.ts$/u);
    }
    expect(fetchPluginHostArtifact).toHaveBeenCalledTimes(1);
    await resolveRuntimeBridgeLaunch({
      launch,
      daemonDataDir: cwd,
      fetchPluginHostArtifact
    });
    expect(fetchPluginHostArtifact).toHaveBeenCalledTimes(1);
  });

  it('refuses an artifact launch when fetch is not configured', async () => {
    await expect(
      resolveRuntimeBridgeLaunch({
        launch: {
          pluginId: 'provider-acp',
          source: {
            kind: 'artifact',
            digest: 'ab'.repeat(32),
            byteLength: 12
          },
          capabilities: {
            supportsServiceTier: true,
            permissionModes: ['full'],
            supportsThreadArchive: false,
            supportsThreadRename: false,
            fork: 'tip'
          }
        },
        daemonDataDir: cwd
      })
    ).rejects.toThrow(/fetch is not configured/u);
  });

  it('renames, archives, and prepares a rewind through AgentRuntime', async () => {
    const adapter = createAgentRuntimeAdapter({
      emit: () => undefined,
      dataDir: cwd,
      createRuntime: (options) =>
        createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter({ scriptPath: fakeProviderScriptPath })
        })
    });
    const environmentId = randomUUID();
    const threadId = randomUUID();
    const started = await adapter.startWork({
      threadId,
      environmentId,
      projectId: 'p1',
      providerId: 'fake',
      input: prompt('hello'),
      cwd
    });
    await adapter.renameWork({ threadId, title: 'Renamed' });
    await adapter.clearGoal({ threadId });
    const providerThreadId = started?.providerThreadId ?? 'pt-1';
    const prepared = await adapter.prepareRewind({
      threadId,
      environmentId,
      leaseId: 'lease-1',
      projectId: 'p1',
      providerId: 'fake',
      sourceProviderThreadId: providerThreadId,
      retainThroughProviderCheckpoint: 'cp-1',
      cwd
    });
    expect(prepared.providerThreadId).toBeTruthy();
    await adapter.discardRewind({ leaseId: 'lease-1', environmentId });
    await adapter.stopWork({ threadId });
    adapter.dispose();
  });

  it('forwards archive and unarchive to AgentRuntime', async () => {
    const archived: string[] = [];
    const unarchived: string[] = [];
    const adapter = createAgentRuntimeAdapter({
      emit: () => undefined,
      dataDir: cwd,
      createRuntime: (options) => {
        const runtime = createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter({ scriptPath: fakeProviderScriptPath })
        });
        return {
          ...runtime,
          archiveThread: async (input) => {
            archived.push(input.providerThreadId);
          },
          unarchiveThread: async (input) => {
            unarchived.push(input.providerThreadId);
          }
        };
      }
    });
    const environmentId = randomUUID();
    await adapter.archiveWork({
      threadId: randomUUID(),
      environmentId,
      providerId: 'fake',
      providerThreadId: 'pt-1',
      cwd
    });
    await adapter.unarchiveWork({
      threadId: randomUUID(),
      environmentId,
      providerId: 'fake',
      providerThreadId: 'pt-1',
      cwd
    });
    expect(archived).toEqual(['pt-1']);
    expect(unarchived).toEqual(['pt-1']);
    adapter.dispose();
  });

  it('replaces an idle environment runtime when the skill catalog changes', async () => {
    let created = 0;
    const adapter = createAgentRuntimeAdapter({
      emit: () => undefined,
      dataDir: cwd,
      createRuntime: (options) => {
        created += 1;
        return createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter({ scriptPath: fakeProviderScriptPath })
        });
      }
    });
    const environmentId = randomUUID();
    const threadId = randomUUID();
    await adapter.startWork({
      threadId,
      environmentId,
      projectId: 'p1',
      providerId: 'fake',
      input: prompt('hello'),
      cwd
    });
    await adapter.stopWork({ threadId });
    expect(created).toBe(1);
    mkdirSync(join(cwd, 'skills-generated', 'hello'), { recursive: true });
    writeFileSync(
      join(cwd, 'skills-generated', 'hello', 'SKILL.md'),
      '---\ndescription: Hi\n---\n'
    );
    await adapter.refreshSkillCatalog();
    expect(adapter.listLoadedEnvironments()).toEqual([]);
    await adapter.startWork({
      threadId: randomUUID(),
      environmentId,
      projectId: 'p1',
      providerId: 'fake',
      input: prompt('hello'),
      cwd
    });
    expect(created).toBe(2);
    adapter.dispose();
  });

  it('keeps a busy environment runtime when the skill catalog changes', async () => {
    let created = 0;
    const adapter = createAgentRuntimeAdapter({
      emit: () => undefined,
      dataDir: cwd,
      createRuntime: (options) => {
        created += 1;
        return createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter({ scriptPath: fakeProviderScriptPath })
        });
      }
    });
    const environmentId = randomUUID();
    await adapter.startWork({
      threadId: randomUUID(),
      environmentId,
      projectId: 'p1',
      providerId: 'fake',
      input: prompt('hello'),
      cwd
    });
    mkdirSync(join(cwd, 'skills-generated', 'hello'), { recursive: true });
    writeFileSync(
      join(cwd, 'skills-generated', 'hello', 'SKILL.md'),
      '---\ndescription: Hi\n---\n'
    );
    await adapter.refreshSkillCatalog();
    expect(adapter.listLoadedEnvironments()).toEqual([environmentId]);
    await adapter.startWork({
      threadId: randomUUID(),
      environmentId,
      projectId: 'p1',
      providerId: 'fake',
      input: prompt('second'),
      cwd
    });
    expect(created).toBe(1);
    adapter.dispose();
  });
});

describe('threadExecutionOptions', () => {
  it('builds a valid permission policy for accept-edits and auto', () => {
    expect(threadExecutionOptions({ permissionMode: 'accept-edits' })).toMatchObject({
      permissionMode: 'accept-edits',
      permissionScope: 'workspace',
      approvalReviewer: 'user',
      permissionEscalation: 'ask'
    });
    expect(threadExecutionOptions({ permissionMode: 'auto' })).toMatchObject({
      permissionMode: 'auto',
      permissionScope: 'workspace',
      approvalReviewer: 'automatic',
      permissionEscalation: 'ask'
    });
    expect(threadExecutionOptions({})).toMatchObject({
      permissionMode: 'full',
      permissionScope: 'full',
      approvalReviewer: null,
      permissionEscalation: null
    });
  });

  it('does not overlay ask/deny onto a full permission policy', () => {
    expect(threadExecutionOptions({ permissionEscalation: 'ask' })).toMatchObject({
      permissionMode: 'full',
      permissionEscalation: null
    });
    expect(threadExecutionOptions({
      permissionMode: 'full',
      permissionEscalation: 'deny'
    })).toMatchObject({
      permissionMode: 'full',
      approvalReviewer: null,
      permissionEscalation: null
    });
  });

  it('applies ask/deny escalation only for accept-edits and auto', () => {
    expect(threadExecutionOptions({
      permissionMode: 'accept-edits',
      permissionEscalation: 'deny'
    })).toMatchObject({
      permissionMode: 'accept-edits',
      permissionEscalation: 'deny'
    });
    expect(threadExecutionOptions({
      permissionMode: 'auto',
      permissionEscalation: 'deny'
    })).toMatchObject({
      permissionMode: 'auto',
      permissionEscalation: 'deny'
    });
  });

  it('passes model and reasoningLevel into runtime options', () => {
    expect(threadExecutionOptions({
      model: 'claude-sonnet-5',
      reasoningLevel: 'high'
    })).toMatchObject({
      model: 'claude-sonnet-5',
      reasoningLevel: 'high'
    });
  });
});

describe('mapRuntimeThreadEvent', () => {
  const threadId = '11111111-1111-4111-8111-111111111111';
  const scope = { kind: 'turn' as const, turnId: 'turn-1' };

  it('keeps retrying provider errors in-flight instead of failing the turn', () => {
    const event = {
      type: 'provider/error',
      threadId,
      providerThreadId: '',
      scope,
      message: 'Provider error',
      detail: 'Claude Code API retry 5/10 after 9168ms: HTTP 401 authentication_failed',
      willRetry: true,
      errorInfo: {
        category: 'unauthorized',
        providerCode: 'authentication_failed',
        httpStatusCode: 401
      }
    } as ThreadEvent;
    expect(mapRuntimeThreadEvent(event)).toEqual({
      threadId,
      kind: 'thread.event',
      payload: event
    });
  });

  it('keeps reconnecting system errors in-flight', () => {
    const event = {
      type: 'system/error',
      threadId,
      providerThreadId: '',
      scope,
      message: 'stream disconnected',
      reconnectAttempt: 3,
      reconnectTotal: 5
    } as ThreadEvent;
    expect(mapRuntimeThreadEvent(event).kind).toBe('thread.event');
  });

  it('maps a terminal provider error as turn.failed', () => {
    const event = {
      type: 'provider/error',
      threadId,
      providerThreadId: '',
      scope,
      message: 'Provider error',
      willRetry: false,
      errorInfo: {
        category: 'unauthorized',
        providerCode: 'authentication_failed',
        httpStatusCode: 401
      }
    } as ThreadEvent;
    expect(mapRuntimeThreadEvent(event).kind).toBe('turn.failed');
  });

  it('maps turn completion as turn.completed', () => {
    const event = {
      type: 'turn/completed',
      threadId,
      providerThreadId: '',
      scope,
      status: 'completed'
    } as ThreadEvent;
    expect(mapRuntimeThreadEvent(event).kind).toBe('turn.completed');
  });
});
