import { useState } from 'react';
import { CheckCircle2, Layers, Package, Settings2 } from 'lucide-react';
import { Modal } from '../../components/Modal.js';
import './plugin-packs.css';

/** Display data only: sources, membership and installation authority are owned by main. */
export interface PluginPackCardModel {
  key: string;
  id: string;
  title: string;
  description?: string;
  marketplace: string;
  memberNames: string[];
  installedCount?: number;
  memberCount: number;
  remembered: boolean;
}

export interface PluginPackMemberModel {
  id: string;
  title: string;
  description?: string;
  source: string;
  version?: string;
  author?: string;
  permissions?: string[];
  optional: boolean;
  defaultSelected?: boolean;
  installed: boolean;
  available: boolean;
  error?: string;
  note?: string;
}

export interface PluginPackReviewModel {
  pack: PluginPackCardModel;
  members: PluginPackMemberModel[];
}

export interface PluginPackMemberResultModel {
  id: string;
  status: 'pending' | 'installed' | 'already-installed' | 'failed' | 'skipped';
  error?: string;
}

export function PluginPackCards({ packs, mode, onReview, onForget }: {
  packs: PluginPackCardModel[];
  mode: 'browse' | 'installed';
  onReview: (pack: PluginPackCardModel) => void;
  onForget: (pack: PluginPackCardModel) => void;
}) {
  if (packs.length === 0) return null;
  const installed = mode === 'installed';
  return <section className={`ext-packs${installed ? ' ext-packs--installed' : ''}`} aria-label={installed ? 'Installed plugin packs' : 'Plugin packs'}>
    <header className="ext-browse-collection-heading"><div><h3>{installed ? 'Your plugin packs' : 'Plugin packs'} <span>{packs.length}</span></h3>
      {!installed ? <p className="settings-help">Useful plugins together, with one installation flow.</p> : null}</div></header>
    <div className="ext-packs-grid">{packs.map((pack) => <article key={pack.key} className="ext-pack-card" data-testid={`plugin-pack-${pack.id}`}>
      <div className="ext-pack-icon"><Layers size={23} aria-hidden="true" /></div>
      <div className="ext-pack-card-body"><div className="ext-pack-eyebrow">{pack.marketplace} · Plugin pack</div><h4>{pack.title}</h4>
        {pack.description ? <p>{pack.description}</p> : null}
        <div className="ext-pack-members-preview">{pack.memberNames.slice(0, 3).map((name, index) => <span key={`${name}-${index}`}>{name}</span>)}
          {pack.memberNames.length > 3 ? <span>+{pack.memberNames.length - 3} more</span> : null}</div>
        <p className="ext-pack-progress">{pack.installedCount === undefined ? `${pack.memberCount} plugins` : `${pack.installedCount} of ${pack.memberCount} plugins installed`}</p>
      </div>
      <div className="ext-pack-card-actions"><button type="button" className={installed ? 'settings-btn' : 'settings-btn primary'} onClick={() => onReview(pack)}>{installed ? 'Manage pack' : 'Review pack'}</button>
        {installed ? <button type="button" className="ext-pack-forget" onClick={() => onForget(pack)}>Forget pack</button> : null}</div>
    </article>)}</div>
  </section>;
}

export function PluginPackReview({ review, busy = false, installBlocked = false, error, results, onClose, onInstall, onOpenPlugin }: {
  review: PluginPackReviewModel;
  busy?: boolean;
  installBlocked?: boolean;
  error?: string | null;
  results?: PluginPackMemberResultModel[];
  onClose: () => void;
  onInstall: (memberIds: string[]) => void;
  onOpenPlugin: (id: string) => void;
}) {
  const [selected, setSelected] = useState(() => new Set(review.members.filter((member) => member.available && !member.installed && member.defaultSelected !== false).map((member) => member.id)));
  const resultById = new Map(results?.map((result) => [result.id, result]));
  const installed = (member: PluginPackMemberModel) => member.installed || ['installed', 'already-installed'].includes(resultById.get(member.id)?.status ?? '');
  const actionable = review.members.filter((member) => member.available && !installed(member));
  const selectedIds = actionable.filter((member) => selected.has(member.id)).map((member) => member.id);
  const failedIds = selectedIds.filter((id) => resultById.get(id)?.status === 'failed');
  const pending = results?.some((result) => result.status === 'pending') ?? false;
  const completed = results !== undefined && !busy && !pending && !results.some((result) => result.status === 'failed');
  const unavailableRequired = review.members.some((member) => !member.optional && !installed(member) && (!member.available || !selected.has(member.id)));
  const installIds = failedIds.length > 0 ? failedIds : [...review.members.filter(installed).map((member) => member.id), ...selectedIds];
  const close = () => { if (!busy) onClose(); };
  return <Modal title={`Review ${review.pack.title}`} onClose={close} hideClose={busy} closeOnBackdrop={!busy} className="ext-pack-review" footer={<>
    <span className="ext-pack-review-summary" aria-live="polite">{busy || pending ? 'Installing selected plugins…' : completed ? 'Pack saved. Manage each plugin below.' : `${review.members.filter(installed).length} already installed · ${selectedIds.length} to install`}</span>
    <button type="button" className="btn" disabled={busy} onClick={close}>{completed ? 'Done' : 'Cancel'}</button>
    {!completed ? <button type="button" className="btn primary" disabled={busy || pending || installBlocked || unavailableRequired || installIds.length === 0} onClick={() => onInstall(installIds)}>{busy || pending ? 'Installing…' : failedIds.length > 0 ? 'Retry failed plugins' : selectedIds.length === 0 ? 'Save pack' : 'Install selected plugins'}</button> : null}
  </>}>
    <div className="ext-pack-eyebrow">{review.pack.marketplace} · Plugin pack</div>
    {review.pack.description ? <p className="ext-pack-review-lead">{review.pack.description}</p> : null}
    <ul className="ext-pack-member-list">{review.members.map((member) => {
      const result = resultById.get(member.id);
      const present = installed(member);
      const failure = result?.error || member.error;
      const checked = selected.has(member.id);
      return <li key={member.id} className="ext-pack-member" data-testid={`plugin-pack-member-${member.id}`}>
        {present ? <CheckCircle2 size={17} className="ext-pack-member-check" aria-hidden="true" /> : <input type="checkbox" checked={checked} disabled={busy || (!member.optional && checked) || !member.available} aria-label={`Include ${member.title}`} onChange={(event) => setSelected((previous) => {
          const next = new Set(previous); if (event.target.checked) next.add(member.id); else next.delete(member.id); return next;
        })} />}
        <div className="ext-pack-member-icon"><Package size={17} aria-hidden="true" /></div>
        <div className="ext-pack-member-body"><strong>{member.title}</strong>{member.description ? <p>{member.description}</p> : null}
          <p className="ext-pack-member-source">{member.author ? `${member.author} · ` : ''}{member.version ? `${/^\d/.test(member.version) ? 'v' : ''}${member.version} · ` : ''}{member.source}</p>
          {member.note ? <p>{member.note}</p> : null}
          {member.permissions && member.permissions.length > 0 ? <p className="ext-pack-member-permissions">Capabilities: {member.permissions.join(', ')}</p> : null}
          {failure ? <p role="alert" className="modal-error">{failure}</p> : null}
        </div>
        <div className="ext-pack-member-actions">{present ? <><span className="ext-pack-member-installed">{result?.status === 'installed' ? 'Installed' : 'Already installed'}</span><button type="button" className="settings-btn" disabled={busy} onClick={() => onOpenPlugin(member.id)}><Settings2 size={12} aria-hidden="true" />Open settings</button></>
          : <span className="ext-pack-member-state">{result?.status === 'pending' || (busy && selectedIds.includes(member.id) && !result) ? 'Installing…' : !member.available ? 'Unavailable' : result?.status === 'failed' ? 'Failed' : result?.status === 'skipped' ? 'Skipped' : member.optional ? 'Optional' : 'Required'}</span>}</div>
      </li>;
    })}</ul>
    {error ? <p role="alert" className="modal-error">{error}</p> : null}
    <p className="ext-pack-trust-note">Selected plugins run with full trust on this computer. Only install plugins from publishers you trust. Each plugin keeps its own settings, sign-in and update schedule.</p>
  </Modal>;
}

export function PluginPackForgetConfirm({ pack, busy = false, error, onClose, onForget }: {
  pack: PluginPackCardModel;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onForget: () => void;
}) {
  const close = () => { if (!busy) onClose(); };
  return <Modal title={`Forget ${pack.title}?`} onClose={close} hideClose={busy} closeOnBackdrop={!busy} footer={<>
    <button type="button" className="btn" disabled={busy} onClick={close}>Cancel</button><button type="button" className="btn primary" disabled={busy} onClick={onForget}>{busy ? 'Forgetting…' : 'Forget pack'}</button>
  </>}><p>This removes the pack from your collection. Its plugins stay installed, with their settings and accounts unchanged.</p>{error ? <p role="alert" className="modal-error">{error}</p> : null}</Modal>;
}
