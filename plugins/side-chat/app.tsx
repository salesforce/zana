import { useCallback, useState } from 'react';
import {
  callPluginRpc,
  definePluginApp,
  Markdown,
  ThreadChat,
  useRpc,
  type PluginMessageActionContext,
  type PluginThreadPanelActionContext,
  type PluginThreadPanelProps,
  type ThreadChatMessageAction
} from '@zana-ai/zcc-plugin-sdk/app';

const PLUGIN_ID = 'side-chat';
const PANEL_ACTION_ID = 'side-chat';
const PANEL_TAB_TITLE = 'Side chat';

type SideChatPanelParams = {
  threadId: string;
  sourceThreadId: string;
  sourceMessageText: string;
  sourceSeqEnd: number | null;
};

export function parsePanelParams(value: unknown): SideChatPanelParams | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.threadId !== 'string'
    || record.threadId.length === 0
    || typeof record.sourceThreadId !== 'string'
    || record.sourceThreadId.length === 0
  ) {
    return null;
  }
  return {
    threadId: record.threadId,
    sourceThreadId: record.sourceThreadId,
    sourceMessageText: typeof record.sourceMessageText === 'string' ? record.sourceMessageText : '',
    sourceSeqEnd: typeof record.sourceSeqEnd === 'number' ? record.sourceSeqEnd : null
  };
}

function pluginToast(message: string, kind: 'info' | 'error' = 'info'): void {
  const runtime = (globalThis as {
    __ZCC_PLUGIN_RUNTIME__?: { toast?: (message: string, kind?: 'info' | 'error') => void };
  }).__ZCC_PLUGIN_RUNTIME__;
  runtime?.toast?.(message, kind);
}

function createdThreadId(result: unknown): string {
  if (
    typeof result === 'object'
    && result !== null
    && typeof (result as { threadId?: unknown }).threadId === 'string'
  ) {
    return (result as { threadId: string }).threadId;
  }
  throw new Error('Plugin returned an unexpected createSideChat response.');
}

interface OpenSideChatArgs {
  sourceThreadId: string;
  anchorText: string;
  sourceSeqEnd: number | null;
  openPanel(options: { title: string; params: SideChatPanelParams }): boolean;
}

const inFlightOpens = new Map<string, Promise<void>>();

function openKey({
  sourceThreadId,
  anchorText,
  sourceSeqEnd
}: Pick<OpenSideChatArgs, 'sourceThreadId' | 'anchorText' | 'sourceSeqEnd'>): string {
  return `${sourceThreadId}|${sourceSeqEnd ?? 'tip'}|${anchorText}`;
}

function openSideChat(args: OpenSideChatArgs): Promise<void> {
  const key = openKey(args);
  const pending = inFlightOpens.get(key);
  if (pending !== undefined) return pending;
  const run = createAndOpenSideChat(args);
  inFlightOpens.set(key, run);
  run.then(
    () => inFlightOpens.delete(key),
    () => inFlightOpens.delete(key)
  );
  return run;
}

async function createAndOpenSideChat({
  sourceThreadId,
  anchorText,
  sourceSeqEnd,
  openPanel
}: OpenSideChatArgs): Promise<void> {
  let threadId: string;
  try {
    threadId = createdThreadId(
      await callPluginRpc(PLUGIN_ID, 'createSideChat', {
        sourceThreadId,
        ...(sourceSeqEnd !== null ? { sourceSeqEnd } : {}),
        anchorText
      })
    );
  } catch (error) {
    pluginToast(
      `Failed to start side chat: ${error instanceof Error ? error.message : String(error)}`,
      'error'
    );
    throw error;
  }
  openPanel({
    title: PANEL_TAB_TITLE,
    params: {
      threadId,
      sourceThreadId,
      sourceMessageText: anchorText,
      sourceSeqEnd
    }
  });
}

function ReplyingTo({ anchorText }: { anchorText: string }) {
  const trimmed = anchorText.trim();
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const measureRef = useCallback((node: HTMLDivElement | null) => {
    if (node !== null) {
      setOverflows(node.scrollHeight > node.clientHeight + 1);
    }
  }, []);
  if (trimmed.length === 0) return null;
  const clamped = !expanded;
  return (
    <div className="thread-chat-replying">
      <span className="thread-chat-replying-label">Replying to</span>
      <div
        className={`thread-chat-replying-quote${overflows ? ' is-overflow' : ''}`}
        role={overflows ? 'button' : undefined}
        title={overflows ? (expanded ? 'Collapse' : 'Show full message') : undefined}
        onClick={overflows ? () => setExpanded((value) => !value) : undefined}
      >
        <div
          ref={measureRef}
          className={`thread-chat-replying-body${clamped ? ' is-clamped' : ''}${
            clamped && overflows ? ' is-faded' : ''
          }`}
        >
          <Markdown content={trimmed} />
        </div>
      </div>
    </div>
  );
}

function SideChatPanel({ params }: PluginThreadPanelProps) {
  const rpc = useRpc();
  const parsed = parsePanelParams(params);
  const sideChatThreadId = parsed?.threadId ?? null;
  const sourceThreadId = parsed?.sourceThreadId ?? null;

  const sendToMain = useCallback(
    async (message: { text: string; threadId: string }) => {
      if (sourceThreadId === null || sideChatThreadId === null) return;
      try {
        await rpc.call('sendToMain', {
          sourceThreadId,
          senderThreadId: sideChatThreadId,
          text: message.text
        });
        pluginToast('Sent to main thread');
      } catch (error) {
        pluginToast(
          `Failed to send to main thread: ${error instanceof Error ? error.message : String(error)}`,
          'error'
        );
      }
    },
    [rpc, sideChatThreadId, sourceThreadId]
  );

  if (parsed === null) {
    return (
      <div className="thread-chat-leading" role="alert">
        This side chat tab is missing its thread reference.
      </div>
    );
  }

  const messageActions: ThreadChatMessageAction[] = [
    {
      id: 'send-to-main',
      title: 'Send to main thread',
      icon: 'Undo2',
      roles: ['assistant'],
      run: (message) => sendToMain(message)
    }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <ThreadChat
        threadId={parsed.threadId}
        variant="compact"
        layout="contained"
        permissionPolicy="editable"
        className="plugin-thread-chat"
        leadingContent={<ReplyingTo anchorText={parsed.sourceMessageText} />}
        messageActions={messageActions}
        includePluginMessageActions={false}
      />
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.messageAction({
    id: 'reply-in-side-chat',
    title: 'Reply in side chat',
    icon: 'MessageCirclePlus',
    async run(context: PluginMessageActionContext) {
      const anchorText = context.selectedText ?? context.message.text;
      await openSideChat({
        sourceThreadId: context.threadId,
        anchorText,
        sourceSeqEnd: context.message.sourceSeqEnd,
        openPanel: (options) => context.openPanel({ actionId: PANEL_ACTION_ID, ...options })
      });
    }
  });
  app.slots.threadPanelAction({
    id: PANEL_ACTION_ID,
    title: 'Start side chat',
    icon: 'MessageCirclePlus',
    component: SideChatPanel,
    layout: 'flush',
    async run(context: PluginThreadPanelActionContext) {
      await openSideChat({
        sourceThreadId: context.threadId,
        anchorText: '',
        sourceSeqEnd: null,
        openPanel: (options) => context.openPanel(options)
      });
    }
  });
});
