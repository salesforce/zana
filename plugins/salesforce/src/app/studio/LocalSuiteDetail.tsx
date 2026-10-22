import { useEffect, useState, type ComponentType } from 'react';
import { callPluginRpc } from '@zana-ai/zcc-plugin-sdk/app';
import { agentSuitePath } from '../../../lib/graph-coverage.js';
import type { ScenarioSuite } from '../../../lib/studio-contract.js';
import type { TestsPaneProps } from './TestsPane.js';

export interface LocalSuiteDetailProps {
  suite: ScenarioSuite;
  editor: TestsPaneProps;
  /** Reuse the case editor without coupling the catalogue to its implementation. */
  Cases: ComponentType<TestsPaneProps>;
}

export function LocalSuiteDetail({ suite, editor, Cases }: LocalSuiteDetailProps) {
  const { pluginId, projectId, path, visible } = editor;
  const call = editor.call ?? callPluginRpc;
  const current = Boolean(path && agentSuitePath(path) === suite.path);
  const [loaded, setLoaded] = useState<{ path: string; source: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (current || !visible) return;
    let cancelled = false;
    setLoaded(null);
    setMessage(null);
    const args = projectId ? { projectId } : {};
    void (async () => {
      try {
        const listed = await call(pluginId, 'agentFiles.list', args) as { ok?: boolean; error?: string; files?: Array<{ path: string }> } | null;
        if (cancelled) return;
        if (listed?.ok === false || !listed?.files) throw Error(listed?.error || 'Could not find the local agent file.');
        const matches = listed.files.filter(file => agentSuitePath(file.path) === suite.path);
        if (matches.length !== 1) {
          setMessage(matches.length ? 'Open the agent file to choose which source to test.' : 'No local agent file matches this suite. Open or retrieve its agent to run these cases.');
          return;
        }
        const read = await call(pluginId, 'agentFiles.read', { ...args, path: matches[0]!.path }) as { ok?: boolean; error?: string; file?: { path: string; content: string } } | null;
        if (cancelled) return;
        if (read?.ok === false || !read?.file) throw Error(read?.error || 'Could not read the local agent file.');
        setLoaded({ path: read.file.path, source: read.file.content });
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => { cancelled = true; };
  }, [current, visible, call, pluginId, projectId, suite.path]);

  return <section aria-label={`Local cases for ${suite.id}`} data-testid="local-suite-detail">
    <p className="sf-tp-sub">Local cases · {suite.path}</p>
    {current ? <Cases {...editor} casesOnly /> : loaded ? <>
      <p className="sf-tp-sub">Simulate uses the saved source in {loaded.path}.</p>
      <Cases {...editor} path={loaded.path} source={loaded.source} dirty={false} proposalSource={null} onShowPath={undefined} casesOnly />
    </> : <>
      <p role="status">{message ?? 'Reading the local agent…'}</p>
      <table className="sf-tp-table"><thead><tr><th>Case</th><th>Utterances</th></tr></thead>
        <tbody>{suite.cases.map(c => <tr key={c.id}><td>{c.name}</td><td>{c.utterances.join(' / ')}</td></tr>)}</tbody>
      </table>
    </>}
  </section>;
}
