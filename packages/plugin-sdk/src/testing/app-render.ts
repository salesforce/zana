import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
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
  ZccDeepLinkOpenResult,
  ZccDeepLinks,
  ZccNavigate,
  ZccPanelAgentOptions,
  ZccPanelToolOptions,
  ZccPanelScope,
  ZccWindowTitle
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
    }
  | { method: 'openPanelAgent'; options: ZccPanelAgentOptions }
  | { method: 'openPanelTool'; options: ZccPanelToolOptions }
  | { method: 'setPanelScope'; scope: ZccPanelScope | null }
  | { method: 'openInWindow'; projectId: string; options?: { tabId?: string; resourceId?: string } };

export interface RenderSlotOptions {
  rpc?: Record<string, (input: unknown) => unknown | Promise<unknown>>;
  settings?: PluginSettingsState['values'];
  context?: Partial<ZccContext>;
  composer?: { text?: string; scope?: PluginComposerScope };
  realtimeConnectionState?: 'connecting' | 'connected' | 'reconnecting';
  /** Whether the page has a side panel to show agents in (`navigate.openPanelAgent`). Defaults to false. */
  panelAgent?: boolean;
  /** `deepLinks.base()`. Defaults to `zana-test://`. */
  deepLinkBase?: string | null;
  /** What `deepLinks.open(raw)` resolves. Defaults to `unavailable`. */
  deepLinkOpenResult?: ZccDeepLinkOpenResult;
  /**
   * Whether the page has a side panel for its tools (`navigate.openPanelTool`,
   * `useZccContext().sidePanel`). Defaults to false.
   */
  panelTools?: boolean;
}

export interface RenderedSlot extends RenderResult {
  inspection: {
    rpcCalls: RpcCall[];
    navigateCalls: NavigateCall[];
    /** The newest `useWindowTitle` value still mounted, or null. The fake records it on every surface. */
    readonly windowTitle: ZccWindowTitle | null;
    /** Raw links passed to `deepLinks.open`. */
    deepLinkOpenCalls: string[];
  };
  lifecycle: {
    unmount(): void;
  };
  emitRealtime(channel: string, payload?: unknown): void;
  /** Deliver a deep link to the handlers registered with `deepLinks.on(route, …)`. */
  emitDeepLink(route: string, payload?: string | null): void;
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
  (globalThis as { __ZCC_HOST_REACT_DOM__?: typeof ReactDOM }).__ZCC_HOST_REACT_DOM__ = ReactDOM;
  (globalThis as { __ZCC_HOST_REACT_DOM_CLIENT__?: typeof ReactDOMClient }).__ZCC_HOST_REACT_DOM_CLIENT__ =
    ReactDOMClient;
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
  emitDeepLink(route: string, payload?: string | null): void;
  windowTitle(): ZccWindowTitle | null;
  deepLinkOpenCalls: string[];
} {
  const rpcCalls: RpcCall[] = [];
  const navigateCalls: NavigateCall[] = [];
  let windowTitles: Array<{ token: symbol; title: ZccWindowTitle | null }> = [];
  const realtimeHandlers = new Map<string, (payload: unknown) => void>();
  const deepLinkHandlers = new Map<string, Set<(payload: string | null) => void>>();
  const deepLinkOpenCalls: string[] = [];
  const deepLinks: ZccDeepLinks = {
    base: () => (options.deepLinkBase === undefined ? 'zana-test://' : options.deepLinkBase),
    on(route, handler) {
      const set = deepLinkHandlers.get(route) ?? new Set();
      set.add(handler);
      deepLinkHandlers.set(route, set);
      return () => {
        set.delete(handler);
      };
    },
    async open(rawLink) {
      deepLinkOpenCalls.push(rawLink);
      return options.deepLinkOpenResult ?? { ok: false, reason: 'unavailable' };
    }
  };
  const context: ZccContext = {
    projectId: options.context?.projectId ?? null,
    threadId: options.context?.threadId ?? null,
    ...(options.context?.surface !== undefined ? { surface: options.context.surface } : {}),
    ...(options.context?.resourceId !== undefined ? { resourceId: options.context.resourceId } : {}),
    ...(options.context?.resourceRequestId !== undefined ? { resourceRequestId: options.context.resourceRequestId } : {}),
    ...(options.panelTools === true || options.context?.sidePanel !== undefined
      ? { sidePanel: options.context?.sidePanel ?? true }
      : {}),
    ...(options.context?.sidePanelOpen !== undefined ? { sidePanelOpen: options.context.sidePanelOpen } : {})
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
    },
    openPanelAgent(agentOptions) {
      navigateCalls.push({ method: 'openPanelAgent', options: agentOptions });
      return options.panelAgent === true;
    },
    openPanelTool(toolOptions) {
      navigateCalls.push({ method: 'openPanelTool', options: toolOptions });
      return options.panelTools === true;
    },
    setPanelScope(scope) {
      navigateCalls.push({ method: 'setPanelScope', scope });
    },
    openInWindow(projectId, windowOptions) {
      navigateCalls.push({
        method: 'openInWindow',
        projectId,
        ...(windowOptions !== undefined ? { options: windowOptions } : {})
      });
      return Promise.resolve(true);
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
    },
    experimental_setLaunchPatch() {
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
    useZccDeepLinks() {
      return deepLinks;
    },
    useWindowCloseHandler() {},
    useWindowTitle(title) {
      const key = title ? JSON.stringify(title) : '';
      const slot = React.useRef<symbol | null>(null);
      // Like the host: one place per caller from mount to unmount, updated in place.
      React.useEffect(() => {
        const token = Symbol('window-title');
        slot.current = token;
        windowTitles = [...windowTitles, { token, title: null }];
        return () => {
          slot.current = null;
          windowTitles = windowTitles.filter((entry) => entry.token !== token);
        };
      }, []);
      React.useEffect(() => {
        const title = key ? (JSON.parse(key) as ZccWindowTitle) : null;
        windowTitles = windowTitles.map((entry) => (entry.token === slot.current ? { ...entry, title } : entry));
      }, [key]);
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
    },
    emitDeepLink(route, payload = null) {
      for (const handler of [...(deepLinkHandlers.get(route) ?? [])]) handler(payload);
    },
    deepLinkOpenCalls,
    windowTitle: () => [...windowTitles].reverse().find((entry) => entry.title)?.title ?? null
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
      navigateCalls: installed.navigateCalls,
      get windowTitle() {
        return installed.windowTitle();
      },
      deepLinkOpenCalls: installed.deepLinkOpenCalls
    },
    lifecycle: {
      unmount: result.unmount
    },
    emitRealtime: installed.emitRealtime,
    emitDeepLink: installed.emitDeepLink
  };
}
