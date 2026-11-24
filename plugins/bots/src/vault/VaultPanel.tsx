import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useRealtime, useRpc } from '@zana-ai/zcc-plugin-sdk/app';
import { Plus } from 'lucide-react';
import { Section, botSectionCss } from '../BotSection.js';
import { botScopeKey, contactFields, isShared, type BotIdentity, type VaultItem, type VaultKind } from './items.js';

const kinds = { login: 'Login', card: 'Card', contact: 'Contact info' } as const;
const styles = `
.bv { font-size: 13px; line-height: 1.5; color: var(--text-primary); overflow-wrap: anywhere; }
.bv-standalone { container: bot-page / inline-size; max-width: 44rem; margin-inline: auto; }
.bv-standalone .bt-sec { margin-top: 0; }
.bv h4 { margin: 0; font-size: 13px; font-weight: 600; }
.bv-bar, .bv-check { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.bv-tools, .bv-choices { display: grid; gap: 8px; }
.bv-tools .bt-btn[aria-pressed=true] { background: var(--bg-elevated); border-color: var(--accent-blue); color: var(--accent-blue); }
.bv-check input { margin: 0; }
.bv .bv-check { flex-direction: row; }
.bv .bv-delete { margin-inline-end: auto; }
.bv .bt-row > span { min-width: 0; }
`;
type Editor = { kind: VaultKind; item?: VaultItem };
function errorText(reason: unknown) { return reason instanceof Error ? reason.message : 'Vault request failed.'; }
function WriteOnly({ name, label, saved }: { name: string; label: string; saved: boolean }) {
  const [replace, setReplace] = useState(!saved);
  return replace ? <label className="bt-form-row">{label}<input name={name} type="password" autoComplete="new-password" maxLength={name === 'password' ? 4096 : 32} /></label>
    : <div className="bt-form-row"><span>{label}</span><div className="bv-bar"><span className="bt-sub">•••••• saved</span><button type="button" className="bt-btn is-sm" aria-label={'Replace ' + label} onClick={() => setReplace(true)}>Replace</button></div></div>;
}
function ItemEditor({ editor, bots, contacts, bot, busy, save, close, remove }: {
  editor: Editor; contacts: VaultItem[]; bots: BotIdentity[]; bot?: BotIdentity; busy: boolean;
  save: (item: Record<string, unknown>) => void; close: () => void; remove: () => void;
}) {
  const { kind, item } = editor;
  const [all, setAll] = useState(item ? item.scope === 'all' : false);
  const [deleting, setDeleting] = useState(false);
  const scope = item ? item.scope : bot ? [botScopeKey(bot)] : [];
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const input = Object.fromEntries(fd.entries());
    save({ ...input, kind, id: item?.id, revision: item?.revision, scope: all ? 'all' : fd.getAll('scope'),
      ...(kind === 'login' ? { sites: String(input.sites ?? '').split(/[\s,]+/).filter(Boolean) } : {}) });
  }
  return <form className="bt-form" onSubmit={submit}>
    <h4 className="bt-inset">{item ? 'Edit ' : 'New '}{kinds[kind].toLowerCase()}</h4>
    {kind === 'login' && <>
      <label className="bt-form-row">Websites<input name="sites" required defaultValue={item?.sites.join(', ')} placeholder="accounts.example.com" /></label>
      <label className="bt-form-row">Username<input name="username" autoComplete="off" defaultValue={item?.username} /></label>
      <WriteOnly name="password" label="Password" saved={!!item} />
      <label className="bt-form-row">Hint<input name="hint" defaultValue={item?.hint} /></label>
    </>}
    {kind === 'card' && <>
      <label className="bt-form-row">Nickname<input name="label" defaultValue={item?.label} placeholder="Travel card" /></label>
      <label className="bt-form-row">Name on card<input name="nameOnCard" autoComplete="off" defaultValue={item?.nameOnCard} /></label>
      <WriteOnly name="number" label="Card number" saved={!!item} /><WriteOnly name="expiry" label="Expiry (MM/YY)" saved={!!item} />
      <label className="bt-form-row">Billing contact<select name="billingContactId" defaultValue={item?.billingContactId ?? ''}>
        <option value="">None</option>{contacts.map(contact => <option key={contact.id} value={contact.id}>{contact.label}</option>)}
      </select></label>
      <WriteOnly name="securityCode" label="Security code (optional)" saved={!!item?.hasCode} />
    </>}
    {kind === 'contact' && contactFields.map(([key, label]) => <label className="bt-form-row" key={key}>{label}<input name={key} required={key === 'fullName'} defaultValue={item?.contact?.[key]} /></label>)}
    <div className="bt-form-row" role="group" aria-label="Share with">
      <span>Share with</span>
      <div className="bv-choices">
        <label className="bv-check"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} />All current and future bots</label>
        {!all && bots.map(b => <label className="bv-check" key={b.id}><input name="scope" type="checkbox" value={botScopeKey(b)} defaultChecked={scope !== 'all' && scope.includes(botScopeKey(b))} />{b.name}</label>)}
      </div>
    </div>
    {kind === 'contact' && <p className="bt-empty-line">Shared bots can read these contact details.</p>}
    <footer className="bt-form-footer">
      {item && <div className="bv-delete">{deleting ? <span>Delete this item? <button type="button" className="bt-btn is-danger" disabled={busy} onClick={remove}>Confirm delete</button></span>
        : <button type="button" className="bt-btn is-danger" onClick={() => setDeleting(true)}>Delete item</button>}</div>}
      <button type="button" className="bt-btn is-ghost" onClick={close} disabled={busy}>Cancel</button>
      <button className="bt-btn is-primary" disabled={busy}>Save item</button>
    </footer>
  </form>;
}
export function VaultPanel({ bot }: { bot?: BotIdentity }) {
  const rpc = useRpc();
  const [migrationRequired, setMigrationRequired] = useState<boolean>();
  const [items, setItems] = useState<VaultItem[] | null>(null);
  const [bots, setBots] = useState<BotIdentity[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<Editor>();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<VaultKind | 'all'>('all');
  const [adding, setAdding] = useState(false);
  const loadId = useRef(0);
  const load = useCallback(async () => {
    const id = ++loadId.current;
    const status = await rpc.call('desktop.vaultStatus') as { migrationRequired: boolean };
    if (id !== loadId.current) return;
    setMigrationRequired(status.migrationRequired);
    if (status.migrationRequired) { setItems(null); return; }
    const [result, choices] = await Promise.all([rpc.call('desktop.vaultList'), rpc.call('list')]);
    if (id !== loadId.current) return;
    setItems(result as VaultItem[]); setBots(choices as BotIdentity[]);
  }, [rpc]);
  const refresh = useCallback(() => { setError(''); void load().catch(e => setError(errorText(e))); }, [load]);
  useEffect(() => { refresh(); return () => { ++loadId.current; }; }, [refresh]);
  useRealtime('bots:vault-changed', refresh);
  async function action(fn: () => Promise<void>) {
    setBusy(true); setError('');
    try { await fn(); await load(); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  function migrate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const passphrase = new FormData(e.currentTarget).get('passphrase');
    e.currentTarget.reset();
    void action(async () => { await rpc.call('desktop.vaultMigrate', { passphrase }); });
  }
  const shared = items?.filter(item => !bot || isShared(item, bot)) ?? [];
  const shown = shared.filter(item => (filter === 'all' || item.kind === filter) &&
    [item.label, item.username, item.last4, ...item.sites, item.contact?.email].some(value => value?.toLowerCase().includes(search.toLowerCase())));
  const createAction = items && !migrationRequired && !editor && (
    <button type="button" className="bt-btn is-sm" aria-expanded={adding} onClick={() => setAdding(!adding)}>
      <Plus size={14} aria-hidden="true" />New item
    </button>
  );
  return <div className={bot ? 'bv' : 'bv bv-standalone'}>
    <style>{bot ? styles : botSectionCss + styles}</style>
    <Section label="Vault" action={createAction}>
      {!bot && <p className="bt-empty-line">Logins, cards, and contacts for your bots.</p>}
      {error && <p className="bt-empty-line" role="alert">{error} {!items && !migrationRequired && <button type="button" className="bt-btn is-sm" onClick={refresh}>Retry</button>}</p>}
      {migrationRequired ? <form className="bt-form" onSubmit={migrate}>
          <h4 className="bt-inset">Move your existing Vault to this device</h4>
          <p className="bt-empty-line">Enter your previous passphrase once to keep your saved items.</p>
          <label className="bt-form-row">Previous Vault passphrase<input name="passphrase" required type="password" maxLength={512} autoComplete="current-password" /></label>
          <div className="bt-form-footer"><button className="bt-btn is-primary" disabled={busy}>Migrate Vault</button></div>
        </form>
        : !items ? !error && <p role="status" className="bt-empty-line">Loading Vault…</p>
        : editor ? <ItemEditor key={editor.item?.id ?? editor.kind} editor={editor} bot={bot} bots={bots} contacts={items.filter(item => item.kind === 'contact')} busy={busy} close={() => { setEditor(undefined); setError(''); }}
          save={item => void action(async () => { await rpc.call('desktop.vaultSave', { item }); setEditor(undefined); })}
          remove={() => void action(async () => { await rpc.call('desktop.vaultRemove', { id: editor.item?.id, revision: editor.item?.revision }); setEditor(undefined); })} />
        : <>
          {adding && <div className="bt-inset bv-bar">{(Object.keys(kinds) as VaultKind[]).map(kind =>
            <button key={kind} type="button" className="bt-btn is-sm" onClick={() => { setEditor({ kind }); setAdding(false); }}>{kinds[kind]}</button>)}</div>}
          {shared.length > 0 && <div className="bt-inset bv-tools">
            {bot && <span className="bt-sub">Items shared with {bot.name}</span>}
            <input type="search" aria-label="Search Vault" placeholder="Search Vault" value={search} onChange={e => setSearch(e.target.value)} />
            <div className="bv-bar">{(['all', 'login', 'card', 'contact'] as const).map(k =>
              <button key={k} className="bt-btn is-sm" type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>
                {k === 'all' ? 'All' : kinds[k]} · {shared.filter(item => k === 'all' || k === item.kind).length}
              </button>)}</div>
          </div>}
          {!shown.length && <p className="bt-empty-line">{shared.length ? 'No matching items.' : bot ? `No items shared with ${bot.name} yet.` : 'No saved items yet.'}</p>}
          {shown.map(item => <button type="button" key={item.id} className="bt-row" onClick={() => { setEditor({ kind: item.kind, item }); setError(''); }}>
            <span><span className="bt-row-title">{item.label}{item.last4 && ' •••• ' + item.last4}</span>
              <span className="bt-sub">{[kinds[item.kind], item.username ?? item.contact?.email, item.scope === 'all' ? 'All bots' : bots.filter(b => isShared(item, b)).map(b => b.name).join(', ') || 'No current bots'].filter(Boolean).join(' · ')}</span>
            </span>
          </button>)}
        </>}
    </Section>
  </div>;
}
