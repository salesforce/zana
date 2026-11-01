import { product } from '../lib/product-client.js';
import { useState } from 'react';
import { FolderOpen, FolderPlus, GitBranch } from 'lucide-react';
import { Modal } from './Modal.js';
import { AddGitProjectDialog } from './AddGitProjectDialog.js';
import { CreateProjectFolderDialog } from './CreateProjectFolderDialog.js';
import { useData } from '../store.js';
import type { MachineProjectGroup } from '../lib/machine-projects.js';
import { AddLocalProjectDialog } from './AddLocalProjectDialog.js';
import { AddRemoteProjectDialog } from './AddRemoteProjectDialog.js';

/** The target comes from the group. Neither this dialog nor a roster refresh may change it. */
export function AddMachineProjectDialog({ group, onClose, onAdded }: {
  group: MachineProjectGroup;
  onClose: () => void;
  onAdded: (project: { id: string }) => void;
}) {
  const addProjectByPath = useData(s => s.addProjectByPath);
  const addRemoteProject = useData(s => s.addRemoteProject);
  const cloneProject = useData(s => s.cloneProject);
  const [mode, setMode] = useState<'choose' | 'open' | 'create' | 'clone'>('choose');
  if (group.remote && !group.hostId) return <AddRemoteProjectDialog
    fixedTarget={group.remote}
    onClose={onClose}
    onSubmit={addRemoteProject}
    onSuccess={id => onAdded({ id })}
  />;
  if (mode === 'choose') return <Modal title={`Add project on ${group.name}`} onClose={onClose}>
    <p className="modal-hint">Choose how to add a project on <strong>{group.name}</strong>.</p>
    <div className="machine-project-add-options">
      <button className="btn" onClick={() => setMode('open')}><FolderOpen size={16} /><span>Open existing folder<small>Add a folder already on this machine</small></span></button>
      <button className="btn" disabled={!group.hostId} onClick={() => setMode('create')}><FolderPlus size={16} /><span>Create new folder<small>Start with an empty project</small></span></button>
      <button className="btn" disabled={!group.hostId} onClick={() => setMode('clone')}><GitBranch size={16} /><span>Clone repository<small>Download a Git repository to this machine</small></span></button>
    </div>
  </Modal>;
  if (mode === 'create') return <CreateProjectFolderDialog group={group} onClose={onClose} onAdded={onAdded} />;
  if (mode === 'clone') return <AddGitProjectDialog fixedHostId={group.hostId} fixedMachineName={group.name} onClose={onClose}
    onClone={input => cloneProject({ ...input, hostId: group.hostId })} onSuccess={id => onAdded({ id })} />;
  return <AddLocalProjectDialog
    fixedHostId={group.hostId}
    fixedMachineName={group.name}
    onClose={onClose}
    onBrowse={() => product.projects.pickDirectory()}
    onSubmit={async (path, hostId) => {
      const project = await addProjectByPath(path, hostId ? { hostId } : undefined);
      if (project) onAdded(project);
      return project;
    }}
  />;
}
