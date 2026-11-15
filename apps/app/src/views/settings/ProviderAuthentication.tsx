import { TerminalView } from '../../components/TerminalView.js';
import { useProviderAuthentication } from '../../hooks/useProviderAuthentication.js';

export function ProviderAuthentication({ providerId, name, hostId, hostName, onReady }: {
  providerId: string; name: string; hostId?: string; hostName?: string; onReady: () => void;
}) {
  const auth = useProviderAuthentication(providerId, hostId, onReady);
  const health = auth.result?.supported ? auth.result.health : null;
  const needsLogin = health?.status === 'unauthenticated' || health?.status === 'expired';
  const label = !hostId ? 'Machine disconnected' : health?.status === 'ready' ? 'Credentials ready'
    : health?.status === 'not_installed' ? 'CLI not installed'
      : health?.status === 'unsupported_version' ? 'CLI update required'
        : needsLogin ? health.status === 'expired' ? 'Sign-in expired' : 'Sign-in required'
          : auth.checking ? 'Checking credentials…' : 'Credentials unverified';
  return <div className="provider-auth" aria-label={`${name} authentication`}>
    <div className="provider-auth-summary">
      <span className={`registered-harness-state registered-harness-state--${health?.status === 'ready' ? 'ok' : needsLogin ? 'warn' : 'muted'}`} role="status">{label}</span>
      {health?.accountEmail ? <span>{health.accountEmail}</span> : null}
      {health?.planLabel ? <span>{health.planLabel}</span> : null}
      <button type="button" className="settings-btn" disabled={!hostId || auth.checking} onClick={() => { void auth.check(); }} aria-label={`Check ${name} credentials`}>Check status</button>
      {needsLogin && health.loginCommand && !auth.session && !auth.starting ? <button type="button" className="settings-btn" onClick={() => { void auth.start(); }}>Sign in to {name}</button> : null}
      {auth.starting || auth.session ? <button type="button" className="settings-btn" onClick={() => { void auth.cancel(); }}>{auth.starting ? 'Cancel sign-in' : 'Close sign-in'}</button> : null}
    </div>
    {health?.statusMessage ? <p className="settings-help">{health.statusMessage}</p> : null}
    {auth.error ? <p role="alert" className="settings-help">{auth.error}</p> : null}
    {auth.starting ? <p className="settings-help" role="status">Starting sign-in on {hostName ?? 'the selected machine'}…</p> : null}
    {auth.session ? <div className="provider-auth-login">
      <p className="settings-help">Complete sign-in on {hostName ?? 'the selected machine'}. Status refreshes automatically.</p>
      <div className="provider-auth-terminal"><TerminalView session={auth.session} area="a" scrollbackLimit={2000} /></div>
      {auth.session.status === 'exited' ? <p className="settings-help">Sign-in terminal exited. Check status or close it to try again.</p> : null}
    </div> : null}
  </div>;
}
