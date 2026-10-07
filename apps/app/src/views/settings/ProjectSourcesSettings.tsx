import { useEffect, useState } from 'react';
import type { Project } from '@zana-ai/zcc-domain/product';
import type { ProjectSource } from '@zana-ai/zcc-domain/project';
import { apiJson } from '../../lib/fetch-with-app-surface.js';
import { useHosts } from '../../hooks/useHosts.js';
import { Field, Section } from '../../components/settings/FormFields.js';

export function ProjectSourcesSettings({ project, onSaved }: { project: Project; onSaved(): void }) {
  const hosts = useHosts();
  const [sources, setSources] = useState<ProjectSource[]>([]);
  const [hostId, setHostId] = useState('');
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setSources([]); setError('');
    void apiJson<{ sources: ProjectSource[] }>(`/projects/${encodeURIComponent(project.id)}/sources`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setSources(result.sources); })
      .catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [project.id, revision]);
  async function mutate(sourceId?: string) {
    setBusy(true); setError('');
    try {
      await apiJson(`/projects/${encodeURIComponent(project.id)}/sources${sourceId ? '/' + encodeURIComponent(sourceId) : ''}`, {
        method: sourceId ? 'DELETE' : 'POST', body: sourceId ? '{}' : JSON.stringify({ hostId, path })
      });
      setPath(''); setHostId(''); setRevision(value => value + 1); onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update checkouts'); }
    finally { setBusy(false); }
  }
  const available = hosts.filter(host => !sources.some(source => source.hostId === host.id));
  return <Section
    title="Checkouts on your machines"
    help="Use this same project on different machines. Each machine keeps its own files and Git changes. Shared history and project settings stay with this Zana instance."
  >
    <ul className="settings-list project-checkout-list">{sources.map(source => {
      const host = hosts.find(candidate => candidate.id === source.hostId);
      const original = source.id.startsWith('original:');
      return <li className="settings-list-row project-checkout-row" key={source.id}>
        <span className={`machine-status-dot${host?.status === 'connected' ? ' machine-status-dot--on' : ''}`} aria-hidden="true" />
        <div className="project-checkout-details">
          <span className="settings-label">{host?.name ?? 'Offline machine'}</span>
          <code className="settings-list-name project-checkout-path" title={source.path}>{source.path}</code>
        </div>
        {original
          ? <span className="settings-badge" title="The original checkout holds this project's shared metadata">Shared metadata</span>
          : <button type="button" className="settings-btn" disabled={busy} onClick={() => void mutate(source.id)}>Remove</button>}
      </li>;
    })}</ul>
    <div className="project-checkout-add">
      <Field label="Machine">
        <select aria-label="Checkout machine" value={hostId} onChange={event => setHostId(event.target.value)} disabled={busy || available.length === 0}>
          <option value="">{available.length === 0 ? 'No other machines' : 'Choose a machine'}</option>
          {available.map(host => <option key={host.id} value={host.id} disabled={host.status !== 'connected'}>{host.name}{host.status !== 'connected' ? ' (offline)' : ''}</option>)}
        </select>
      </Field>
      <Field label="Existing folder" mono>
        <input aria-label="Checkout folder" value={path} onChange={event => setPath(event.target.value)} placeholder="/home/you/projects/my-project" disabled={busy} />
      </Field>
      <button type="button" className="settings-btn settings-btn--primary" disabled={busy || !hostId || !path.startsWith('/')} onClick={() => void mutate()}>Add checkout</button>
    </div>
    <p className="settings-help">Removing a checkout leaves its files and existing threads intact. New work requires a registered checkout.</p>
    {error && <p className="settings-help project-checkout-error" role="alert">{error}</p>}
  </Section>;
}
