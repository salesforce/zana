import * as React from 'react';
import type { ComponentType, ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import type {
  ComposerView,
  MarkdownProps,
  PluginComposerApi,
  PluginComposerScope,
  PluginRpcClient,
  PluginSdkApp,
  PluginSettingsState,
  ThreadChatMessageReference,
  ThreadChatProps,
  ZccContext,
  ZccNavigate
} from '../app-contract.js';
import { collectTestPluginApp } from './app.js';

export interface RpcCall {
  method: string;
  input: unknown;
}

export type NavigateCall =
  | { method: 'toThread'; threadId: string }
  | { method: 'toProject'; projectId: string; options?: { tabId?: string } }
  | { method: 'toPluginPanel'; path: string; options?: { subPath?: string; replace?: boolean } }
  | { method: 'toCompose'; options?: { initialPrompt?: string; focusPrompt?: boolean } }
  | {
      method: 'openThreadPanel';
      options: { actionId: string; title?: string; params?: unknown };
    };

export interface RenderSlotOptions {
  rpc?: Record<string, (input: unknown) => unknown | Promise<unknown>>;
  settings?: PluginSettingsState['values'];
  context?: Partial<ZccContext>;
  composer?: { text?: string; scope?: PluginComposerScope };
  realtimeConnectionState?: 'connecting' | 'connected' | 'reconnecting';
}

export interface RenderedSlot extends RenderResult {
  inspection: {
    rpcCalls: RpcCall[];
    navigateCalls: NavigateCall[];
  };
  lifecycle: {
    unmount(): void;
  };
  emitRealtime(channel: string, payload?: unknown): void;
}

type PluginAppModule = { default?: unknown };

export type PluginAppSource =
  | unknown
  | PluginAppModule
  | (() => Promise<unknown | PluginAppModule>);

function asPluginApp(value: unknown): unknown {
  if (value && typeof value === 'object' && 'default' in value) {
    return (value as PluginAppModule).default ?? value;
  }
  return value;
}

function installHostReact(): void {
  (globalThis as { __ZCC_HOST_REACT__?: typeof React }).__ZCC_HOST_REACT__ = React;
}

function defaultComposerScope(context: ZccContext): PluginComposerScope {
  if (context.threadId) return { kind: 'thread', threadId: context.threadId };
  return { kind: 'new-thread', projectId: context.projectId };
}

/**
 * Install mock `useRpc` / `useSettings` / navigate / composer hooks on
 * `globalThis.__ZCC_PLUGIN_RUNTIME__` and host React. Call before importing a
 * plugin `app.tsx` (static imports bind hooks at module load).
 */
export function installTestPluginRuntime(options: RenderSlotOptions = {}): {
  rpcCalls: RpcCall[];
  navigateCalls: NavigateCall[];
  emitRealtime(channel: string, payload?: unknown): void;
} {
  const rpcCalls: RpcCall[] = [];
  const navigateCalls: NavigateCall[] = [];
  const realtimeHandlers = new Map<string, (payload: unknown) => void>();
  const context: ZccContext = {
    projectId: options.context?.projectId ?? null,
    threadId: options.context?.threadId ?? null
  };
  let composerText = options.composer?.text ?? '';
  const composerScope = options.composer?.scope ?? defaultComposerScope(context);
  const settingsState: PluginSettingsState = {
    values: options.settings,
    isLoading: false
  };

  const rpcClient: PluginRpcClient = {
    async call(method, input) {
      const normalized = input === undefined ? null : input;
      rpcCalls.push({ method, input: normalized });
      const handler = options.rpc?.[method];
      if (!handler) {
        throw new Error(`no rpc handler for "${method}" — add it to renderSlot options.rpc`);
      }
      return handler(normalized);
    }
  };

  const navigate: ZccNavigate = {
    toThread(threadId) {
      navigateCalls.push({ method: 'toThread', threadId });
    },
    toProject(projectId, options) {
      navigateCalls.push({
        method: 'toProject',
        projectId,
        ...(options !== undefined ? { options } : {})
      });
    },
    toPluginPanel(path, panelOptions) {
      navigateCalls.push({
        method: 'toPluginPanel',
        path,
        ...(panelOptions !== undefined ? { options: panelOptions } : {})
      });
    },
    toCompose(composeOptions) {
      navigateCalls.push({
        method: 'toCompose',
        ...(composeOptions !== undefined ? { options: composeOptions } : {})
      });
    },
    openThreadPanel(panelOptions) {
      navigateCalls.push({ method: 'openThreadPanel', options: panelOptions });
      return true;
    }
  };

  const composerApi: PluginComposerApi = {
    scope: composerScope,
    get text() {
      return composerText;
    },
    setText(next) {
      composerText = next;
    },
    updateText(updater) {
      composerText = updater(composerText);
    },
    clear() {
      composerText = '';
    },
    setTextEffect() {
      /* test stub */
    },
    setInputLock() {
      /* test stub */
    },
    addQuote() {
      /* test stub */
    },
    insertMention() {
      /* test stub */
    },
    focus() {
      /* test stub */
    }
  };

  const composerView = (): ComposerView => ({
    scope: composerScope,
    layout: 'expanded',
    draft: { text: composerText, isEmpty: composerText.trim() === '', attachmentCount: 0 },
    run: { isRunning: false, isSubmitting: false }
  });

  const runtime: Partial<PluginSdkApp> = {
    useRpc() {
      return rpcClient;
    },
    useRealtime(channel, handler) {
      realtimeHandlers.set(channel, handler);
    },
    useRealtimeConnectionState() {
      return options.realtimeConnectionState ?? 'connected';
    },
    useSettings() {
      return settingsState;
    },
    useZccContext() {
      return context;
    },
    useZccNavigate() {
      return navigate;
    },
    useComposer() {
      return composerApi;
    },
    useComposerView: composerView,
    toast() {
      /* test stub */
    },
    ThreadChat(props: ThreadChatProps) {
      return React.createElement(
        'div',
        {
          'data-testid': 'plugin-thread-chat',
          'data-thread-id': props.threadId,
          'data-variant': props.variant,
          'data-layout': props.layout,
          'data-permission-policy': props.permissionPolicy,
          'data-message-actions': (props.messageActions ?? []).map((action) => action.id).join(','),
          'data-include-plugin-message-actions': String(props.includePluginMessageActions !== false)
        },
        React.createElement(
          'div',
          { 'data-testid': 'plugin-thread-chat-leading-content' },
          props.leadingContent
        ),
        ...(props.messageActions ?? []).map((action) =>
          React.createElement(
            'button',
            {
              key: action.id,
              type: 'button',
              'data-testid': `plugin-thread-chat-action-${action.id}`,
              'data-roles': (action.roles ?? []).join(','),
              onClick: () => {
                const message: ThreadChatMessageReference = {
                  id: 'msg_test',
                  threadId: props.threadId,
                  role: 'assistant',
                  text: 'test message text',
                  sourceSeqEnd: 0
                };
                void action.run(message);
              }
            },
            action.title
          )
        )
      );
    },
    Markdown(props: MarkdownProps) {
      return React.createElement(
        'div',
        { 'data-testid': 'plugin-markdown', className: props.className },
        props.content
      );
    }
  };

  (globalThis as { __ZCC_PLUGIN_RUNTIME__?: Partial<PluginSdkApp> }).__ZCC_PLUGIN_RUNTIME__ = runtime;
  installHostReact();

  return {
    rpcCalls,
    navigateCalls,
    emitRealtime(channel, payload) {
      realtimeHandlers.get(channel)?.(payload);
    }
  };
}

/**
 * Install the test runtime, then resolve a `definePluginApp` export.
 * Pass a thunk (`() => import('./app.tsx')`) so the module evaluates after
 * the runtime is installed.
 */
export async function loadPluginApp(
  source: PluginAppSource,
  pluginId = 'test',
  generation = 1
) {
  installTestPluginRuntime();
  const resolved = typeof source === 'function' ? await source() : source;
  return collectTestPluginApp(asPluginApp(resolved), pluginId, generation);
}

/**
 * Mount one slot registration with Testing Library. Does not reproduce host
 * layout, routing, or crash boundaries.
 */
export function renderSlot<Props extends object>(
  registration: { component: ComponentType<Props> },
  props: Props,
  options: RenderSlotOptions = {}
): RenderedSlot {
  const installed = installTestPluginRuntime(options);
  const element = React.createElement(registration.component, props) as ReactElement;
  const result = render(element);
  return {
    ...result,
    inspection: {
      rpcCalls: installed.rpcCalls,
      navigateCalls: installed.navigateCalls
    },
    lifecycle: {
      unmount: result.unmount
    },
    emitRealtime: installed.emitRealtime
  };
}
