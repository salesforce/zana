import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { callPluginRpc, setPluginSettings, useSettings } from '@zana-ai/zcc-plugin-sdk/app';
import { AGENT_SCRIPT_EXAMPLES } from '../../lib/agent-script-model.js';
import { AGENT_SCRIPT_DIALECTS, normalizeAgentScriptDialect, type AgentScriptDialect } from '../../lib/types.js';
import {
  isPlaygroundToHost,
  PLAYGROUND_ASSET_SRC,
  PLAYGROUND_BRIDGE_SOURCE,
  readDocumentTheme,
  type HostToPlayground,
  type PlaygroundFileRef
} from './playground-bridge.js';
import { filePickerValue, parseFilePickerValue, playgroundHint, saveIsDisabled } from './agent-script-panel-logic.js';

const PLUGIN_ID = 'salesforce';
const PANEL_ROOT: CSSProperties = { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' };

type StatusPayload = {
  projectRoot?: string;
  dxProject?: boolean;
  agentScriptDialect?: AgentScriptDialect;
  defaultOrg?: string;
};

function postToPlayground(frame: HTMLIFrameElement | null, message: HostToPlayground): void {
  try {
    frame?.contentWindow?.postMessage(message, window.location.origin);
  } catch {
    // iframe may still be about:blank (tests) or not yet same-origin
  }
}

export function AgentScriptPanel(props: { pluginId: string; subPath: string }) {
  const pluginId = props.pluginId || PLUGIN_ID;
  const settings = useSettings();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [files, setFiles] = useState<PlaygroundFileRef[]>([]);
  const [activePath, setActivePath] = useState<string | null>(props.subPath || null);
  const [exampleId, setExampleId] = useState(AGENT_SCRIPT_EXAMPLES[0]?.id ?? 'support-bot');
  const [sha256, setSha256] = useState<string | undefined>(undefined);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialectOverride, setDialectOverride] = useState<AgentScriptDialect | null>(null);
  const dialect =
    dialectOverride ??
    normalizeAgentScriptDialect((settings.values as Record<string, unknown> | undefined)?.agentScriptDialect);
  const saveEnabled = Boolean(status?.dxProject);

  const refreshFiles = useCallback(async () => {
    const listed = (await callPluginRpc(pluginId, 'agentFiles.list')) as {
      ok?: boolean;
      files?: PlaygroundFileRef[];
      error?: string;
    };
    if (listed?.ok && Array.isArray(listed.files)) setFiles(listed.files);
  }, [pluginId]);

  useEffect(() => {
    let cancelled = false;
    void callPluginRpc(pluginId, 'status')
      .then((next) => {
        if (!cancelled) setStatus((next ?? {}) as StatusPayload);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    void refreshFiles().catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      cancelled = true;
    };
  }, [pluginId, refreshFiles]);

  const openFile = useCallback(
    async (path: string | null, nextExampleId?: string) => {
      setError(null);
      if (!path) {
        const example =
          AGENT_SCRIPT_EXAMPLES.find((row) => row.id === nextExampleId) ?? AGENT_SCRIPT_EXAMPLES[0];
        setActivePath(null);
        setExampleId(example?.id ?? 'support-bot');
        setSha256(undefined);
        setDirty(false);
        postToPlayground(frameRef.current, {
          source: PLAYGROUND_BRIDGE_SOURCE,
          type: 'setFile',
          path: null,
          content: example?.source ?? '',
          dialect: example?.dialect ?? dialect,
          readOnly: false
        });
        return;
      }
      const result = (await callPluginRpc(pluginId, 'agentFiles.read', { path })) as {
        ok?: boolean;
        error?: string;
        file?: { path: string; content: string; sha256: string };
      };
      if (!result?.ok || !result.file) {
        setError(result?.error || 'Could not read Agent Script file.');
        return;
      }
      setActivePath(result.file.path);
      setExampleId('');
      setSha256(result.file.sha256);
      setDirty(false);
      postToPlayground(frameRef.current, {
        source: PLAYGROUND_BRIDGE_SOURCE,
        type: 'setFile',
        path: result.file.path,
        content: result.file.content,
        dialect,
        readOnly: false,
        sha256: result.file.sha256
      });
    },
    [dialect, pluginId]
  );

  const save = useCallback(() => {
    postToPlayground(frameRef.current, { source: PLAYGROUND_BRIDGE_SOURCE, type: 'flushSave' });
  }, []);

  const persistFromPlayground = useCallback(
    async (path: string, content: string) => {
      if (!saveEnabled || !path) {
        setError('Set a DX project root before saving.');
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const result = (await callPluginRpc(pluginId, 'agentFiles.write', {
          path,
          content,
          expectedSha256: sha256
        })) as { ok?: boolean; error?: string; file?: { sha256: string; path: string } };
        if (!result?.ok || !result.file) {
          setError(result?.error || 'Save failed.');
          return;
        }
        setSha256(result.file.sha256);
        setDirty(false);
        postToPlayground(frameRef.current, {
          source: PLAYGROUND_BRIDGE_SOURCE,
          type: 'saved',
          sha256: result.file.sha256
        });
        await refreshFiles();
      } finally {
        setBusy(false);
      }
    },
    [pluginId, refreshFiles, saveEnabled, sha256]
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!isPlaygroundToHost(event.data)) return;
      const message = event.data;
      if (message.type === 'ready') {
        postToPlayground(frameRef.current, {
          source: PLAYGROUND_BRIDGE_SOURCE,
          type: 'init',
          dialect,
          theme: readDocumentTheme(),
          examples: AGENT_SCRIPT_EXAMPLES,
          files,
          saveEnabled
        });
        void openFile(props.subPath || null);
        return;
      }
      if (message.type === 'dirty') {
        setDirty(message.dirty);
        return;
      }
      if (message.type === 'requestOpen') {
        void openFile(message.path);
        return;
      }
      if (message.type === 'persist') {
        void persistFromPlayground(message.path, message.content);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [dialect, files, openFile, persistFromPlayground, props.subPath, saveEnabled]);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      postToPlayground(frameRef.current, {
        source: PLAYGROUND_BRIDGE_SOURCE,
        type: 'setTheme',
        theme: readDocumentTheme()
      });
    });
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const hint = useMemo(() => playgroundHint(Boolean(status), status?.dxProject), [status]);
  const fileValue = filePickerValue(activePath, exampleId);

  return (
    <div style={PANEL_ROOT} data-testid="salesforce-agent-script-panel">
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          padding: '8px 12px',
          borderBottom: '1px solid var(--border, #333)',
          flexWrap: 'wrap'
        }}
      >
        <strong>Agent Script</strong>
        <select
          aria-label="Agent Script dialect"
          value={dialect}
          onChange={(event) => {
            const next = normalizeAgentScriptDialect(event.target.value);
            setDialectOverride(next);
            void setPluginSettings(pluginId, { agentScriptDialect: next }).catch(() => undefined);
            postToPlayground(frameRef.current, {
              source: PLAYGROUND_BRIDGE_SOURCE,
              type: 'setDialect',
              dialect: next
            });
          }}
        >
          {AGENT_SCRIPT_DIALECTS.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <select
          aria-label="Agent Script file"
          value={fileValue}
          onChange={(event) => {
            const picked = parseFilePickerValue(event.target.value);
            if (picked.kind === 'example') {
              void openFile(null, picked.id);
              return;
            }
            void openFile(picked.path);
          }}
        >
          {AGENT_SCRIPT_EXAMPLES.map((example) => (
            <option key={example.id} value={`example:${example.id}`}>
              Example: {example.title}
            </option>
          ))}
          {files.map((file) => (
            <option key={file.path} value={`file:${file.path}`}>
              {file.apiName} ({file.path})
            </option>
          ))}
        </select>
        <button type="button" disabled={saveIsDisabled(saveEnabled, activePath, busy)} onClick={() => void save()}>
          {busy ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
        {hint ? <span style={{ color: 'var(--text-muted)' }}>{hint}</span> : null}
        {error ? <span style={{ color: 'var(--danger, #c00)' }}>{error}</span> : null}
      </div>
      <iframe
        ref={frameRef}
        title="Agent Script playground"
        src={typeof process !== 'undefined' && process.env.VITEST ? 'about:blank' : PLAYGROUND_ASSET_SRC}
        style={{ flex: 1, minHeight: 0, width: '100%', border: 0, background: 'transparent' }}
      />
    </div>
  );
}
