import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useRealtime, useRpc } from '@zana-ai/zcc-plugin-sdk/app';
import { CreditCard, KeyRound, ContactRound } from 'lucide-react';
import { botScopeKey, contactFields, isShared, type BotIdentity, type VaultItem, type VaultKind } from './items.js';

const kinds = { login: 'Login', card: 'Card', contact: 'Contact info' } as const;
const icons = { login: KeyRound, card: CreditCard, contact: ContactRound };
const styles = `
.bv{max-width:44rem;margin:auto;color:var(--text-primary);font-size:13px;line-height:1.5}.bv h3,.bv h4,.bv p{margin:0}.bv p,.bv small{color:var(--text-muted)}
.bv header,.bv footer,.bv-bar,.bv-tabs,.bv-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.bv header,.bv footer{justify-content:space-between}.bv header{margin-bottom:14px}
.bv button,.bv input,.bv textarea,.bv select{font:inherit;color:inherit}.bv button{cursor:pointer;border:1px solid var(--border);border-radius:7px;background:var(--bg-elevated);padding:5px 10px}.bv button:disabled{opacity:.5;cursor:default}
.bv .bv-primary,.bv button[aria-pressed=true]{color:var(--accent-blue);border-color:var(--accent-blue)}.bv form,.bv-editor,.bv-list{display:grid;gap:12px}.bv-editor,.bv-list{padding:14px;border:1px solid var(--border);border-radius:10px}
.bv label{display:grid;gap:4px}.bv input:not([type=checkbox]),.bv select{box-sizing:border-box;border:1px solid var(--border);padding:7px 9px;border-radius:6px;background:var(--bg-base);width:100%}
.bv fieldset{border:0;margin:0;padding:0;display:grid;gap:6px}.bv legend{margin-bottom:4px}.bv .bv-check{display:flex;gap:7px;align-items:center}.bv .bv-row{display:flex;align-items:center;gap:12px;text-align:left;width:100%;background:transparent;border:0;padding:8px}
.bv .bv-row small,.bv .bv-row strong{display:block;overflow-wrap:anywhere}.bv .bv-row:hover{background:var(--bg-hover)}.bv .bv-danger,.bv [role=alert]{color:var(--danger,#db6a70)}.bv .bv-stack{display:grid;gap:12px}.bv .bv-mask{color:var(--text-muted)}
`;
type Editor = { kind: VaultKind; item?: VaultItem };
function errorText(reason: unknown) { return reason instanceof Error ? reason.message : 'Vault request failed.'; }
function WriteOnly({ name, label, saved }: { name: string; label: string; saved: boolean }) {
  const [replace, setReplace] = useState(!saved);
  return replace ? <label>{label}<input name={name} type="password" autoComplete="new-password" maxLength={name === 'password' ? 4096 : 32} /></label>
    : <div className="bv-bar"><span>{label}</span><span className="bv-mask">•••••• saved</span><button type="button" aria-label={'Replace ' + label} onClick={() => setReplace(true)}>Replace</button></div>;
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
  return <form className="bv-editor" onSubmit={submit}>
    <h4>{item ? 'Edit ' : 'New '}{kinds[kind].toLowerCase()}</h4>
    {kind === 'login' && <>
      <label>Websites<input name="sites" required defaultValue={item?.sites.join(', ')} placeholder="accounts.example.com" /></label>
      <label>Username<input name="username" autoComplete="off" defaultValue={item?.username} /></label>
      <WriteOnly name="password" label="Password" saved={!!item} />
      <label>Hint<input name="hint" defaultValue={item?.hint} /></label>
    </>}
    {kind === 'card' && <>
      <label>Nickname<input name="label" defaultValue={item?.label} placeholder="Travel card" /></label>
      <label>Name on card<input name="nameOnCard" autoComplete="off" defaultValue={item?.nameOnCard} /></label>
      <WriteOnly name="number" label="Card number" saved={!!item} /><WriteOnly name="expiry" label="Expiry (MM/YY)" saved={!!item} />
      <label>Billing contact<select name="billingContactId" defaultValue={item?.billingContactId ?? ''}>
        <option value="">None</option>{contacts.map(contact => <option key={contact.id} value={contact.id}>{contact.label}</option>)}
      </select></label>
      <WriteOnly name="securityCode" label="Security code (optional)" saved={!!item?.hasCode} />
    </>}
    {kind === 'contact' && contactFields.map(([key, label]) => <label key={key}>{label}<input name={key} required={key === 'fullName'} defaultValue={item?.contact?.[key]} /></label>)}
    <fieldset><legend>Share with</legend>
      <label className="bv-check"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} />All current and future bots</label>
      {!all && bots.map(b => <label className="bv-check" key={b.id}><input name="scope" type="checkbox" value={botScopeKey(b)} defaultChecked={scope !== 'all' && scope.includes(botScopeKey(b))} />{b.name}</label>)}
    </fieldset>
    {kind === 'contact' && <p>Shared bots can read these contact details.</p>}
    <footer><div>{item && (deleting ? <span>Delete this item? <button type="button" className="bv-danger" disabled={busy} onClick={remove}>Confirm delete</button></span>
      : <button type="button" className="bv-danger" onClick={() => setDeleting(true)}>Delete item</button>)}</div>
      <div className="bv-actions"><button type="button" onClick={close} disabled={busy}>Cancel</button><button className="bv-primary" disabled={busy}>Save item</button></div>
    </footer>
  </form>;
}
export function VaultPanel({ bot }: { bot?: BotIdentity }) {
  const rpc = useRpc();
  const titleId = useId();
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
  return <section className="bv" aria-labelledby={titleId}><style>{styles}</style><header>
    <div><h3 id={titleId}>Vault</h3><p>{bot ? 'Items shared with ' + bot.name : 'Logins, cards, and contacts for your bots.'}</p></div>
  </header>
  {error && <p role="alert">{error} {!items && !migrationRequired && <button type="button" onClick={refresh}>Retry</button>}</p>}
  {migrationRequired ? <form className="bv-editor" onSubmit={migrate}><h4>Move your existing Vault to this device</h4>
      <p>Enter your previous passphrase once to keep your saved items.</p>
      <label>Previous Vault passphrase<input name="passphrase" required type="password" maxLength={512} autoComplete="current-password" /></label>
      <div><button className="bv-primary" disabled={busy}>Migrate Vault</button></div></form>
    : !items ? !error && <p role="status">Loading Vault…</p>
    : editor ? <ItemEditor key={editor.item?.id ?? editor.kind} editor={editor} bot={bot} bots={bots} contacts={items.filter(item => item.kind === 'contact')} busy={busy} close={() => { setEditor(undefined); setError(''); }}
      save={item => void action(async () => { await rpc.call('desktop.vaultSave', { item }); setEditor(undefined); })}
      remove={() => void action(async () => { await rpc.call('desktop.vaultRemove', { id: editor.item?.id, revision: editor.item?.revision }); setEditor(undefined); })} />
    : <div className="bv-stack">
      <div className="bv-bar"><button type="button" aria-expanded={adding} onClick={() => setAdding(!adding)}>New item</button>
        {adding && (Object.keys(kinds) as VaultKind[]).map(kind => <button key={kind} type="button" onClick={() => { setEditor({ kind }); setAdding(false); }}>{kinds[kind]}</button>)}
      </div>
      {shared.length > 0 && <><input type="search" aria-label="Search Vault" placeholder="Search Vault" value={search} onChange={e => setSearch(e.target.value)} />
        <div className="bv-tabs">{(['all','login','card','contact'] as const).map(k => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>
          {k === 'all' ? 'All' : kinds[k]} · {shared.filter(item => k === 'all' || k === item.kind).length}</button>)}</div></>}
      <div className="bv-list">{!shown.length ? <p>{shared.length ? 'No matching items.' : 'No saved items here yet.'}</p> : shown.map(item => {
        const Icon = icons[item.kind];
        return <button type="button" key={item.id} className="bv-row" onClick={() => { setEditor({ kind: item.kind, item }); setError(''); }}>
          <Icon size={18}/><span><strong>{item.label}{item.last4 && ' •••• ' + item.last4}</strong><small>{[item.username ?? item.contact?.email, item.scope === 'all' ? 'All bots' : bots.filter(b => isShared(item,b)).map(b => b.name).join(', ') || 'No current bots'].filter(Boolean).join(' · ')}</small></span></button>;
      })}</div>
    </div>}
  </section>;
}
