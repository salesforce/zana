'use client';
import { AddressPicker } from './BrowserAccess';
import styles from './computer-enrollment.module.css';

export interface Enrollment { name: string; approved: boolean; denied: boolean; serverId?: string; expiresAt?: number }
interface Computer { id: string; name: string; browserUrl?: string | null; live: boolean }

export function ComputerEnrollment({ enrollment, computers, domain, api, disabled, onApprove, onChanged, onError }: {
  enrollment: Enrollment; computers: Computer[]; domain?: string;
  api: (path: string, body?: unknown) => Promise<any>; disabled: boolean;
  onApprove(approved: boolean): void; onChanged(): Promise<void>; onError(error: unknown): void;
}) {
  const computer = computers.find(row => row.id === enrollment.serverId);
  const ready = !!computer?.browserUrl && computer.live;
  const step = !enrollment.approved ? 0 : !computer?.browserUrl ? 1 : 2;
  return <section className={styles.setup} aria-label="Computer connection setup">
    <p className={styles.eyebrow}>Remote access · {enrollment.name}</p>
    {!enrollment.denied && <ol className={styles.progress} aria-label="Remote access setup progress">{['Sign in', 'Choose address', 'Connect'].map((label, index) => <li key={label} aria-current={!ready && index === step ? 'step' : undefined} className={ready || index < step ? styles.complete : ''}><span aria-hidden="true">{ready || index < step ? '✓' : index + 1}</span>{label}</li>)}</ol>}
    <h2>{enrollment.denied ? 'Computer declined' : !enrollment.approved ? `Connect ${enrollment.name}?` : ready ? `${enrollment.name} is ready` : 'Account connected'}</h2>
    {enrollment.denied ? <p>Return to the desktop app to start again.</p> : !enrollment.approved ? <>
      <p>Approve only if you started this request from Zana on this computer. Devices signed in to your account will be able to use its projects and agents.</p>
      <div className={styles.actions}><button className="zcc-btn zcc-btn-primary" disabled={disabled} onClick={() => onApprove(true)}>Approve computer</button><button className="zcc-btn zcc-btn-ghost" disabled={disabled} onClick={() => onApprove(false)}>Decline</button></div>
    </> : !computer ? <p>Return to the desktop app to continue remote access setup. Approval connects your account; setup is not finished yet.</p> : !computer.browserUrl ? <>
      <p>Setup is not finished yet. Choose an address for this computer, then return to the desktop app to check its connection.</p>
      {domain ? <div id="address"><AddressPicker computers={[computer]} domain={domain} api={api} onChanged={onChanged} onError={onError} disabled={disabled} /></div> : <p>Return to Remote access in the desktop app to finish choosing your address.</p>}
    </> : <>
      <p>{ready ? 'Open this address from another device and sign in with the same account.' : 'Address saved. Return to Remote access in the desktop app. Waiting for this computer to come online…'}</p>
      <code>{computer.browserUrl}</code>
      {!ready && <button className="zcc-btn zcc-btn-ghost" disabled={disabled} onClick={() => void onChanged()}>Check connection</button>}
    </>}
  </section>;
}
