import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useRpc } from '@zana-ai/zcc-plugin-sdk/app';

type Mode = 'service' | 'delegated';
type Account = { mode: Mode; origin: string };
type Waiting = { state: 'waiting'; ticket: string; code: string; url: string; interval: number };
type Reply = Waiting | { state: 'connected' };

export function Connections({ bot, token, picker }: { bot: string; token: string; picker?: ReactNode }) {
  const rpc = useRpc();
  const call = useCallback(
    (action: string, args: Record<string, unknown> = {}) =>
      rpc.call('botConnection', { action, bot, token, ...args }),
    [rpc, bot, token]
  );
  const [account, setAccount] = useState<Account | null>();
  const [edit, setEdit] = useState(false);
  const [mode, setMode] = useState<Mode>('service');
  const [pending, setPending] = useState<Waiting>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const message = (e: unknown) => (e instanceof Error ? e.message : 'Could not update this connection.');

  useEffect(() => {
    let active = true;
    void call('status')
      .then((row) => {
        if (active) setAccount(row as Account | null);
      })
      .catch((e) => {
        if (active) setError(message(e));
      });
    return () => {
      active = false;
    };
  }, [call, reload]);
  useEffect(() => {
    if (!pending) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const reply = (await call('finish', { ticket: pending.ticket })) as Reply;
        if (!active) return;
        if (reply.state === 'connected') {
          setPending(undefined);
          setEdit(false);
          setReload((n) => n + 1);
        } else timer = setTimeout(poll, reply.interval * 1000);
      } catch (e) {
        if (active) {
          setPending(undefined);
          setError(message(e));
        }
      }
    };
    timer = setTimeout(poll, pending.interval * 1000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [call, pending]);

  async function connect(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    setBusy(true);
    setError('');
    try {
      const reply = (await call('connect', { ...values, mode })) as Reply;
      form.reset();
      setEdit(false);
      if (reply.state === 'waiting') setPending(reply);
      else setReload((n) => n + 1);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    setError('');
    try {
      await call('disconnect');
      setPending(undefined);
      setAccount(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="bv-list" aria-label="Connections">
      <h4>Connections</h4>
      {picker}
      {pending ? (
        <>
          <p>
            Enter <strong>{pending.code}</strong> on the Salesforce verification page to authorize this bot.
          </p>
          <div className="bv-actions">
            <a href={pending.url} target="_blank" rel="noopener noreferrer">
              Verify with Salesforce
            </a>
            <button type="button" disabled={busy} onClick={disconnect}>
              Cancel sign-in
            </button>
          </div>
        </>
      ) : edit ? (
        <form onSubmit={connect}>
          <label>
            Salesforce identity
            <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              <option value="service">Bot service account</option>
              <option value="delegated">My account</option>
            </select>
          </label>
          <label>
            My Domain URL
            <input name="origin" required placeholder="example.my.salesforce.com" autoComplete="off" />
          </label>
          <label>
            Consumer key
            <input name="clientId" autoComplete="off" required maxLength={512} />
          </label>
          <label>
            {mode === 'service' ? 'Consumer secret' : 'Consumer secret (if required by your app)'}
            <input
              name="clientSecret"
              type="password"
              autoComplete="new-password"
              required={mode === 'service'}
              maxLength={2048}
            />
          </label>
          <p>
            {mode === 'service'
              ? 'Use an app with client credentials enabled and an assigned integration user.'
              : 'Use a local Salesforce app dedicated to device flow, with https://localhost as its callback and API and refresh-token access.'}
          </p>
          <p>Grants this bot and its routines access to read open cases assigned to the connected account.</p>
          <div className="bv-actions">
            <button className="bv-primary" disabled={busy}>
              {busy ? 'Connecting…' : 'Connect'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setEdit(false);
                setError('');
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : account ? (
        <>
          <strong>Salesforce · {account.mode === 'service' ? 'Bot service account' : 'My account'}</strong>
          <small>{new URL(account.origin).host} · Read assigned cases</small>
          <div>
            <button type="button" disabled={busy} onClick={disconnect}>
              Disconnect
            </button>
          </div>
        </>
      ) : account === null ? (
        <>
          <p>Let this bot read its assigned Salesforce cases in chat and scheduled routines.</p>
          <div>
            <button
              type="button"
              onClick={() => {
                setEdit(true);
                setError('');
              }}
            >
              Connect Salesforce
            </button>
          </div>
        </>
      ) : (
        !error && <p role="status">Loading connections…</p>
      )}
      {error && (
        <p role="alert">
          {error}{' '}
          {account === undefined && (
            <button
              onClick={() => {
                setError('');
                setReload((n) => n + 1);
              }}
            >
              Retry
            </button>
          )}
        </p>
      )}
      {(edit || account) && (
        <small>
          Connections keep running when the editor times out. Locking the Vault or restarting Zana pauses them
          until you unlock it.
        </small>
      )}
    </section>
  );
}
