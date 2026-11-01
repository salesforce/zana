import { useMachineProjectSync } from '../hooks/useMachineProjectSync.js';
import type { Project } from '@zana-ai/zcc-domain/product';
import { Folder, Home, Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useProjectAvailability } from '../hooks/useProjectAvailability.js';
import { projectAvailabilityLabel } from '../lib/machine-project-client.js';
import { Modal } from './Modal.js';
import { useThreads } from '../thread-store.js';
import { composerProjectLabel, isScratchWorkspaceProject } from './composer-project-default.js';
import type { MachineProjectGroup } from '../lib/machine-projects.js';

export function MachineProjectsDialog({ group, onClose, onAdd, onNewThread, onOpenProject }: {
  group: MachineProjectGroup;
  onClose: () => void;
  onAdd: (group: MachineProjectGroup) => void;
  onNewThread: (group: MachineProjectGroup, project: Project) => void;
  onOpenProject: (project: Project) => void;
}) {
  const sync = useMachineProjectSync(group.hostId, group.host?.status === 'connected');
  const threads = useThreads(s => s.threads);
  const [refreshToken, setRefreshToken] = useState(0);
  const availability = useProjectAvailability(group.projects, group.host ? [group.host] : [], refreshToken);
  const hasNamed = group.projects.some(project => !isScratchWorkspaceProject(project));
  return <Modal title={group.name} className="machine-project-overview" onClose={onClose}>
    <div className="machine-project-overview-summary">
      <p>{group.primary ? 'Projects on this machine.' : 'Projects on this remote machine.'} Each project keeps its own threads and files.</p>
      <button type="button" className="btn primary" onClick={() => onAdd(group)}><Plus size={14} />Add project</button>
    </div>
    {sync && <p className="machine-project-sync-status" role="status">
      {group.host?.status !== 'connected' ? 'Offline · showing saved projects' : sync.status === 'error' ? 'Project sync needs attention' : sync.status === 'syncing' ? 'Syncing projects…' : 'Projects up to date'}
      {sync.lastSyncedAt && <> · Last synced <time dateTime={new Date(sync.lastSyncedAt).toISOString()}>{new Date(sync.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></>}
      {sync.error && <span className="project-folder-status">{sync.error}</span>}
    </p>}
    {!hasNamed && <div className="machine-project-empty"><strong>Ready to start</strong><p>Use Default Project for a question or a task. Add a project when you need a specific folder.</p></div>}
    <div className="machine-project-table-wrap"><table className="machine-project-table">
      <thead><tr><th>Project</th><th>Threads</th><th><span className="sr-only">Actions</span></th></tr></thead>
      <tbody>{group.projects.map(project => {
        const scratch = isScratchWorkspaceProject(project);
        const count = threads.filter(thread => thread.projectId === project.id && !thread.archivedAt && (!scratch || thread.hostId === group.hostId || (group.primary && !thread.hostId))).length;
        return <tr key={project.id}>
          <td><button type="button" className="machine-project-open" onClick={() => scratch && !group.primary ? onNewThread(group, project) : onOpenProject(project)}>
            {scratch ? <Home size={14} /> : <Folder size={14} />}{composerProjectLabel(project)}
          </button><p>{scratch ? `General tasks on ${group.name}` : project.remote?.remotePath ?? project.path}</p>
          {!scratch && availability[project.id] && availability[project.id] !== 'ready' && <p className="project-folder-status">{projectAvailabilityLabel[availability[project.id]]}</p>}</td>
          <td>{count || 'No'} {count === 1 ? 'thread' : 'threads'}</td>
          <td><button type="button" className="btn" onClick={() => onNewThread(group, project)}><Plus size={13} />New thread</button></td>
        </tr>;
      })}</tbody>
    </table></div>
    <button type="button" className="btn machine-project-refresh" onClick={() => setRefreshToken(token => token + 1)}><RefreshCw size={13} />Check folders</button>
  </Modal>;
}
