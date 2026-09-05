import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createConversationThread,
  createEnvironment,
  listDeferredThreadMessages,
  openDatabase,
  setConversationProviderThreadId,
  upsertHost,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import { PluginHostArtifactRegistry } from '../../plugins/plugin-host-artifact-registry.js';
import { registerThreadProvider } from './thread-provider-catalog.js';
import {
  buildChildThreadNeedsAttentionInput,
  buildChildThreadTurnStatusBatchInput,
  notifyParentOfChildTurn,
  type ChildThreadNotificationSource,
  type ChildThreadTurnNotificationBatchItem
} from './conversation-child-notifications.js';
import { queueParentSystemMessage } from './conversation-parent-system-messages.js';

interface TestThreadArgs {
  id: string;
  title: string | null;
}

function testThread(args: TestThreadArgs): ChildThreadNotificationSource {
  return {
    id: args.id,
    projectId: 'proj_alpha',
    title: args.title
  };
}

function renderBatchMessage(args: {
  items: ChildThreadTurnNotificationBatchItem[];
}): string {
  const [input] = buildChildThreadTurnStatusBatchInput(args);
  if (!input || input.type !== 'text') {
    throw new Error('Expected one text input');
  }
  return input.text;
}

describe('child thread notifications', () => {
  it('keeps final output for a single completed outcome', () => {
    const message = renderBatchMessage({
      items: [
        {
          activeWorkflowCount: 0,
          childThread: testThread({
            id: 'thr_child',
            title: 'Fix checkout flow'
          }),
          terminalOutput: 'Implemented the requested change.',
          turnStatus: 'completed'
        }
      ]
    });

    expect(message).toContain(
      [
        '@thread:thr_child completed:',
        '',
        'Implemented the requested change.'
      ].join('\n')
    );
    expect(message).not.toContain('Child thread updates:');
  });

  it('omits output for a single failed outcome', () => {
    const message = renderBatchMessage({
      items: [
        {
          activeWorkflowCount: 0,
          childThread: testThread({
            id: 'thr_child',
            title: 'Patch deploy script'
          }),
          terminalOutput: 'Deploy script failed on preflight.',
          turnStatus: 'failed'
        }
      ]
    });

    expect(message).toContain(
      [
        '@thread:thr_child failed.',
        '',
        'Review the thread before deciding next steps.'
      ].join('\n')
    );
    expect(message).not.toContain('Deploy script failed on preflight.');
  });

  it('omits output and preserves manual-stop safety guidance for a single interrupted outcome', () => {
    const message = renderBatchMessage({
      items: [
        {
          activeWorkflowCount: 0,
          childThread: testThread({
            id: 'thr_child',
            title: 'Fix checkout flow'
          }),
          terminalOutput: 'Stopped after writing the checkout summary.',
          turnStatus: 'interrupted'
        }
      ]
    });

    expect(message).toContain(
      [
        '@thread:thr_child was interrupted.',
        '',
        'Review the thread before deciding next steps.',
        '',
        'If the user stopped it manually, do not resume, restart, retry, replace, or continue the work unless the user explicitly asks.'
      ].join('\n')
    );
    expect(message).not.toContain('Child thread updates:');
    expect(message).not.toContain('Stopped after writing the checkout summary.');
  });

  it('renders multiple child outcomes as status-only bullet lines', () => {
    const message = renderBatchMessage({
      items: [
        {
          activeWorkflowCount: 0,
          childThread: testThread({
            id: 'thr_child_one',
            title: 'Fix checkout flow'
          }),
          terminalOutput: 'Checkout flow is fixed.',
          turnStatus: 'completed'
        },
        {
          activeWorkflowCount: 0,
          childThread: testThread({
            id: 'thr_child_two',
            title: 'Patch deploy script'
          }),
          terminalOutput: 'Deploy script failed on preflight.',
          turnStatus: 'failed'
        }
      ]
    });

    expect(message).toContain(
      [
        'Child thread updates:',
        '',
        '- @thread:thr_child_one completed.',
        '- @thread:thr_child_two failed.'
      ].join('\n')
    );
    expect(message).not.toContain('Checkout flow is fixed.');
    expect(message).not.toContain('Deploy script failed on preflight.');
  });

  it('builds mention ranges for batched outcome thread references', () => {
    const input = buildChildThreadTurnStatusBatchInput({
      items: [
        {
          activeWorkflowCount: 0,
          childThread: testThread({
            id: 'thr_child_one',
            title: 'Fix checkout flow'
          }),
          terminalOutput: 'Checkout flow is fixed.',
          turnStatus: 'completed'
        },
        {
          activeWorkflowCount: 0,
          childThread: testThread({
            id: 'thr_child_two',
            title: null
          }),
          terminalOutput: 'Deploy script failed.',
          turnStatus: 'failed'
        }
      ]
    });

    expect(input).toHaveLength(1);
    const [textInput] = input;
    if (!textInput || textInput.type !== 'text') {
      throw new Error('Expected one text input');
    }
    expect(textInput).toEqual({
      type: 'text',
      text: expect.stringContaining('@thread:thr_child_one'),
      mentions: [
        {
          start: expect.any(Number),
          end: expect.any(Number),
          resource: {
            kind: 'thread',
            label: 'Fix checkout flow',
            projectId: 'proj_alpha',
            threadId: 'thr_child_one'
          }
        },
        {
          start: expect.any(Number),
          end: expect.any(Number),
          resource: {
            kind: 'thread',
            label: 'thr_child_two',
            projectId: 'proj_alpha',
            threadId: 'thr_child_two'
          }
        }
      ]
    });
    expect(textInput.text).toContain('@thread:thr_child_two');
    expect(textInput.text).toContain('Child thread updates:');
    expect(
      textInput.mentions.map((mention) => textInput.text.slice(mention.start, mention.end))
    ).toEqual(['@thread:thr_child_one', '@thread:thr_child_two']);
  });

  it('does not render raw title suffixes next to rich thread mentions', () => {
    const nestedToken = '@thread:thr_child_two';
    const input = buildChildThreadTurnStatusBatchInput({
      items: [
        {
          activeWorkflowCount: 0,
          childThread: testThread({
            id: 'thr_child_one',
            title: `Title mentions ${nestedToken}`
          }),
          terminalOutput: 'Checkout flow is fixed.',
          turnStatus: 'completed'
        },
        {
          activeWorkflowCount: 0,
          childThread: testThread({
            id: 'thr_child_two',
            title: 'Second thread'
          }),
          terminalOutput: 'Deploy script failed.',
          turnStatus: 'failed'
        }
      ]
    });

    expect(input).toHaveLength(1);
    const [textInput] = input;
    if (!textInput || textInput.type !== 'text') {
      throw new Error('Expected one text input');
    }

    const secondLineTokenStart = textInput.text.lastIndexOf(nestedToken);
    expect(textInput.text).not.toContain('Title mentions');
    expect(textInput.mentions.map((mention) => mention.start)).toEqual([
      textInput.text.indexOf('@thread:thr_child_one'),
      secondLineTokenStart
    ]);
    expect(
      textInput.mentions.map((mention) => textInput.text.slice(mention.start, mention.end))
    ).toEqual(['@thread:thr_child_one', nestedToken]);
  });

  it('renders a final output fallback for a completed child without output', () => {
    const message = renderBatchMessage({
      items: [
        {
          activeWorkflowCount: 0,
          childThread: testThread({
            id: 'thr_child',
            title: 'Patch deploy script'
          }),
          terminalOutput: null,
          turnStatus: 'completed'
        }
      ]
    });

    expect(message).toContain(
      [
        '@thread:thr_child completed:',
        '',
        'No final output was recorded.'
      ].join('\n')
    );
  });

  it('flags a still-running workflow on a single completed outcome', () => {
    const message = renderBatchMessage({
      items: [
        {
          activeWorkflowCount: 1,
          childThread: testThread({
            id: 'thr_child',
            title: 'Rebalance archetypes'
          }),
          terminalOutput: 'Kicked off the balance pass.',
          turnStatus: 'completed'
        }
      ]
    });

    expect(message).toContain(
      [
        '@thread:thr_child completed, with 1 workflow still running:',
        '',
        'Kicked off the balance pass.',
        '',
        'A workflow it started is still running, so this output is not its final result. The thread will report again when the workflow finishes.'
      ].join('\n')
    );
  });

  it('pluralizes and flags still-running workflows across batched outcomes', () => {
    const message = renderBatchMessage({
      items: [
        {
          activeWorkflowCount: 2,
          childThread: testThread({
            id: 'thr_child_one',
            title: 'Rebalance archetypes'
          }),
          terminalOutput: 'Kicked off two workflows.',
          turnStatus: 'completed'
        },
        {
          activeWorkflowCount: 0,
          childThread: testThread({
            id: 'thr_child_two',
            title: 'Patch deploy script'
          }),
          terminalOutput: 'Deploy script failed on preflight.',
          turnStatus: 'failed'
        }
      ]
    });

    expect(message).toContain(
      [
        'Child thread updates:',
        '',
        '- @thread:thr_child_one completed, with 2 workflows still running.',
        '- @thread:thr_child_two failed.',
        '',
        'Threads with a workflow still running have not finished; they will report again when their workflow does.'
      ].join('\n')
    );
  });

  it('builds mention ranges for needs-attention thread references', () => {
    const input = buildChildThreadNeedsAttentionInput({
      blockerSummary: null,
      childThread: testThread({
        id: 'thr_child',
        title: 'Backend cleanup'
      })
    });

    expect(input).toHaveLength(1);
    const [textInput] = input;
    if (!textInput || textInput.type !== 'text') {
      throw new Error('Expected one text input');
    }
    const threadMention = '@thread:thr_child';
    const mentionStart = textInput.text.indexOf(threadMention);
    expect(textInput.mentions).toEqual([
      {
        start: mentionStart,
        end: mentionStart + threadMention.length,
        resource: {
          kind: 'thread',
          label: 'Backend cleanup',
          projectId: 'proj_alpha',
          threadId: 'thr_child'
        }
      }
    ]);
    expect(textInput.text).toContain(
      'Review the blocker. If you can resolve it from existing context, reply to the thread with guidance.'
    );
  });

  it('renders needs-attention blocker summaries when provided', () => {
    const input = buildChildThreadNeedsAttentionInput({
      blockerSummary: ['Blocked on command approval:', 'git push'].join('\n'),
      childThread: testThread({
        id: 'thr_child',
        title: 'Backend cleanup'
      })
    });

    const [textInput] = input;
    if (!textInput || textInput.type !== 'text') {
      throw new Error('Expected one text input');
    }

    expect(textInput.text).toContain(['Blocked on command approval:', 'git push'].join('\n'));
    expect(textInput.text).not.toContain('It is blocked on a pending interaction.');
  });
});

describe('parent system message delivery', () => {
  let db: ZccDatabase | null = null;
  let dir: string | null = null;
  const providerHandles: Array<{ unregister(): void }> = [];

  afterEach(() => {
    for (const handle of providerHandles.splice(0)) handle.unregister();
    db?.close();
    db = null;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
    vi.useRealTimers();
  });

  function openTestDb(): ZccDatabase {
    dir = mkdtempSync(join(tmpdir(), 'zcc-child-notify-'));
    db = openDatabase(join(dir, 'zcc.sqlite'));
    return db;
  }

  function ctxFor(
    database: ZccDatabase,
    callHostOnlineRpc: (input: unknown) => Promise<unknown>,
    hostId: string,
    pendingThreadId?: string
  ): ProductHttpContext {
    const pluginHostArtifacts = new PluginHostArtifactRegistry();
    pluginHostArtifacts.set('test', {
      path: '/tmp/host.js',
      digest: 'a'.repeat(64),
      byteLength: 12,
      generation: 'g1'
    });
    return {
      db: database,
      dataDir: dir ?? '/tmp/zcc-data',
      hub: { emit: vi.fn() },
      hostHub: { callHostOnlineRpc, connectedHostIds: () => [hostId] },
      pluginHostArtifacts,
      plugins: { emitThreadEvent: vi.fn().mockResolvedValue(undefined) },
      pendingInteractions: {
        hasPendingThreadInteraction: (threadId: string) => threadId === pendingThreadId
      }
    } as unknown as ProductHttpContext;
  }

  it('defers a parent system message when the parent has a pending interaction', async () => {
    const database = openTestDb();
    const host = upsertHost(database, { name: 'laptop', hostKeyHash: 'h'.repeat(64) });
    const environment = createEnvironment(database, {
      projectId: 'proj-1',
      hostId: host.id,
      path: '/tmp/proj'
    });
    const parent = createConversationThread(database, {
      projectId: 'proj-1',
      hostId: host.id,
      environmentId: environment.id,
      providerId: 'claude-code',
      status: 'idle',
      title: 'Parent'
    });
    const queued = await queueParentSystemMessage(ctxFor(database, async () => ({}), host.id, parent.id), {
      parentThreadId: parent.id,
      input: buildChildThreadTurnStatusBatchInput({
        items: [{
          activeWorkflowCount: 0,
          childThread: { id: 'child', projectId: 'proj-1', title: 'Child' },
          terminalOutput: 'done',
          turnStatus: 'completed'
        }]
      })
    });
    expect(queued).toBe(true);
    expect(listDeferredThreadMessages(database, parent.id)).toHaveLength(1);
  });

  it('does not notify the source thread when a fork idles', () => {
    const database = openTestDb();
    const host = upsertHost(database, { name: 'laptop', hostKeyHash: 'h'.repeat(64) });
    const environment = createEnvironment(database, {
      projectId: 'proj-1',
      hostId: host.id,
      path: '/tmp/proj'
    });
    const source = createConversationThread(database, {
      projectId: 'proj-1',
      hostId: host.id,
      environmentId: environment.id,
      providerId: 'claude-code',
      status: 'idle',
      title: 'Source'
    });
    const fork = createConversationThread(database, {
      projectId: 'proj-1',
      hostId: host.id,
      environmentId: environment.id,
      providerId: 'claude-code',
      status: 'idle',
      title: 'Source (fork)',
      parentThreadId: source.id,
      originKind: 'fork'
    });
    notifyParentOfChildTurn(ctxFor(database, async () => ({}), host.id), fork);
    expect(listDeferredThreadMessages(database, source.id)).toHaveLength(0);
  });

  it('sends a drain parent notice when the parent is writable', async () => {
    providerHandles.push(
      registerThreadProvider('test', {
        id: 'claude-code',
        displayName: 'Claude Code',
        capabilities: {
          supportsServiceTier: false,
          fork: 'checkpoint',
          supportsThreadArchive: false,
          supportsThreadRename: false,
          permissionModes: ['full']
        },
        composerActions: ['plan']
      })
    );
    const database = openTestDb();
    const host = upsertHost(database, { name: 'laptop', hostKeyHash: 'h'.repeat(64) });
    const environment = createEnvironment(database, {
      projectId: 'proj-1',
      hostId: host.id,
      path: '/tmp/proj'
    });
    const parent = setConversationProviderThreadId(
      database,
      createConversationThread(database, {
        projectId: 'proj-1',
        hostId: host.id,
        environmentId: environment.id,
        providerId: 'claude-code',
        status: 'idle',
        title: 'Parent'
      }).id,
      'prov-parent'
    )!;
    const callHostOnlineRpc = vi.fn(async () => ({ accepted: true }));
    const queued = await queueParentSystemMessage(ctxFor(database, callHostOnlineRpc, host.id), {
      parentThreadId: parent.id,
      input: buildChildThreadTurnStatusBatchInput({
        items: [{
          activeWorkflowCount: 0,
          childThread: { id: 'child', projectId: 'proj-1', title: 'Child' },
          terminalOutput: 'done',
          turnStatus: 'completed'
        }]
      })
    });
    expect(queued).toBe(true);
    await Promise.resolve();
    expect(callHostOnlineRpc).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({
        type: 'turn.submit',
        threadId: parent.id,
        permissionEscalation: 'deny'
      })
    }));
  });
});
