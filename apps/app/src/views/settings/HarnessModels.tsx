import { useState } from 'react';
import { Search } from 'lucide-react';
import type { ThreadModelCatalogEntry } from '../../components/thread/pickers/thread-model-catalog.js';

const PAGE_SIZE = 12;

export function HarnessModels({ name, entry, status, canReload, onReload }: {
  name: string;
  entry?: ThreadModelCatalogEntry;
  status: string;
  canReload: boolean;
  onReload: () => void;
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const search = query.trim().toLocaleLowerCase();
  const models = entry?.models ?? [];
  const matches = models.filter(model => [model.displayName, model.id, model.model].some(value => value?.toLocaleLowerCase().includes(search)));
  const pages = Math.ceil(matches.length / PAGE_SIZE);
  const current = Math.min(page, Math.max(0, pages - 1));
  const start = current * PAGE_SIZE;
  const visible = matches.slice(start, start + PAGE_SIZE);

  return <>
    <div className="registered-harness-model-heading">
      <strong>{name} models</strong>
      <button type="button" className="settings-btn" disabled={!canReload} onClick={onReload}>Reload models</button>
    </div>
    {models.length > 0 && <label className="registered-harness-search">
      <Search size={14} aria-hidden />
      <input type="search" aria-label={`Search ${name} models`} placeholder="Search models…" value={query}
        onChange={event => { setQuery(event.target.value); setPage(0); }} />
    </label>}
    {entry?.modelLoadErrorDetail && <p className="settings-help" role="status">{entry.modelLoadErrorDetail}</p>}
    {visible.length ? <ul>{visible.map(model => <li key={model.id}>
      <span>{model.displayName}</span><code>{model.id}</code>
      {model.isDefault && <span className="registered-harness-tag">Provider default</span>}
    </li>)}</ul> : <p className="settings-help">{models.length && search ? 'No models match your search.' : status}</p>}
    {pages > 1 && <div className="harness-model-pagination">
      <span>{start + 1}–{start + visible.length} of {matches.length} models</span>
      <div>
        <button className="settings-btn" type="button" disabled={current === 0} aria-label={`Previous ${name} models`} onClick={() => setPage(current - 1)}>Previous</button>
        <button className="settings-btn" type="button" disabled={current + 1 >= pages} aria-label={`Next ${name} models`} onClick={() => setPage(current + 1)}>Next</button>
      </div>
    </div>}
    {entry?.lastSuccessAt != null && <p className="settings-help">Last loaded: {new Date(entry.lastSuccessAt).toLocaleString()}</p>}
  </>;
}
