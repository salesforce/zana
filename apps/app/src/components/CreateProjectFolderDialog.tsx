import { useEffect, useId, useRef, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { Modal } from './Modal.js';
import { product } from '../lib/product-client.js';
import { createProjectFolder } from '../lib/machine-project-client.js';
import { useData } from '../store.js';
import type { MachineProjectGroup } from '../lib/machine-projects.js';

export function CreateProjectFolderDialog({ group, onClose, onAdded }: {
  group: MachineProjectGroup; onClose: () => void; onAdded: (project: { id: string }) => void;
}) {
  const loadProjects = useData(s => s.loadProjects);
  const parentInputId = useId();
  const [parentPath, setParentPath] = useState('');
  const [name, setName] = useState('');
  const [entries, setEntries] = useState<Array<{ name: string; path: string }>>([]);
  const [parent, setParent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const operation = useRef({ key: '', id: '' });
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let cancelled = false;
    nameInput.current?.focus();
    if (group.hostId) void product.hosts.directory(group.hostId).then(listing => {
      if (!cancelled) setParentPath(current => current || listing.directory);
    }).catch(error => { if (!cancelled) setError(error instanceof Error ? error.message : 'Machine is unavailable'); });
    return () => { cancelled = true; };
  }, [group.hostId]);
  const browse = async (path?: string) => {
    try {
      if (group.primary && path === undefined) {
        const selected = await product.projects.pickDirectory();
        if (selected) setParentPath(selected);
      } else if (group.hostId) {
        const listing = await product.hosts.directory(group.hostId, path ?? (parentPath || undefined));
        setParentPath(listing.directory); setParent(listing.parent);
        setEntries(listing.entries.filter(entry => entry.kind === 'directory'));
      }
      setError('');
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not browse folders'); }
  };
  const submit = async () => {
    if (busy || !name.trim() || !parentPath.trim() || !group.hostId) return;
    setBusy(true); setError('');
    const key = JSON.stringify([group.hostId, parentPath.trim(), name.trim()]);
    if (operation.current.key !== key) operation.current = { key, id: crypto.randomUUID() };
    try {
      const project = await createProjectFolder({ hostId: group.hostId, parentPath: parentPath.trim(), name: name.trim(), operationId: operation.current.id });
      await loadProjects(); onAdded(project); onClose();
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not create project'); }
    finally { setBusy(false); }
  };
  return <Modal title="Create project folder" onClose={() => { if (!busy) onClose(); }} closeOnBackdrop={!busy}
    footer={<><button className="btn" disabled={busy} onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !name.trim() || !parentPath.trim() || !group.hostId} onClick={() => void submit()}>{busy ? 'Creating…' : 'Create & add'}</button></>}>
    <p className="modal-hint">Create an empty folder on <strong>{group.name}</strong> and add it as a project.</p>
    <label className="remote-form-row"><span>Folder name</span><input ref={nameInput} value={name} disabled={busy} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void submit(); }} placeholder="my-project" /></label>
    <div className="remote-form-row"><label htmlFor={parentInputId}>Parent folder</label><div className="local-path-input-group"><input id={parentInputId} value={parentPath} disabled={busy} onChange={e => setParentPath(e.target.value)} spellCheck={false} /><button className="btn" disabled={busy} onClick={() => void browse()}><FolderOpen size={13} />Browse…</button></div></div>
    {(entries.length > 0 || parent) && <ul className="host-directory-list">{parent && <li><button className="btn" disabled={busy} onClick={() => void browse(parent)}>..</button></li>}{entries.map(entry => <li key={entry.path}><button className="btn" disabled={busy} onClick={() => void browse(entry.path)}>{entry.name}</button></li>)}</ul>}
    {error && <div className="modal-error" role="alert">{error}</div>}
  </Modal>;
}
