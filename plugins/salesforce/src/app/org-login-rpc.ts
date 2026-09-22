import { requireResult } from './components/client.js';

/** Each RPC is short; browser SSO/MFA can take the CLI's full ten-minute budget. */
export async function signInWithBrowser(
  call: (method: string, args: Record<string, unknown>) => Promise<unknown>,
  input: Record<string, unknown>,
  signal: AbortSignal,
): Promise<unknown> {
  const started = requireResult<{ loginId: string }>(await call('orgs.login.start', input));
  if (!started.loginId) throw Error('Could not start sign-in. Reload the Salesforce plugin and retry.');
  const deadline = Date.now() + 11 * 60_000;
  while (!signal.aborted && Date.now() < deadline) {
    const status = requireResult<{ done: boolean; result?: unknown }>(await call('orgs.login.status', { loginId: started.loginId }));
    if (status.done) return status.result;
    await new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
      const timer = setTimeout(finish, 1000);
      signal.addEventListener('abort', finish, { once: true });
      if (signal.aborted) finish();
    });
  }
  throw Error(signal.aborted ? 'Sign-in view closed.' : 'Sign-in timed out. Refresh your orgs, then retry.');
}
