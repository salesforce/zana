import { product } from '../../lib/product-client.js';
import { useState, useCallback } from 'react';
import { Stethoscope } from 'lucide-react';
import { useData, useUi } from '../../store.js';
import { Section } from './FormFields.js';
import { buildLaunchArgs } from '../AgentLauncher.js';
import { DOCTOR_PROMPT } from '../../lib/doctorPrompt.js';

/**
 * "Call Doctor Agent" — spawns a single, narrowly-scoped repair agent whose only
 * job is to get the app into a runnable state: verify the `~/.zcc` tree, that
 * runtime extensions are present/enabled/consented, and fix what it safely can.
 *
 * Mirrors {@link AgentLauncher}'s spawn path (ensure the scratch workspace
 * project → launch a claude session seeded with the doctor prompt → redirect
 * into its terminal). Uses the `claude-yolo` profile so the Doctor can read and
 * repair config files without a permission prompt on every step.
 */
export function DoctorSection() {
  const createTerminal = useData((s) => s.createTerminal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const callDoctor = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await product.projects.ensureQuickAgent();
      if (!res.ok) {
        setError(res.message);
        return;
      }
      const anchor = res.value;
      const session = await createTerminal(anchor.id, 'claude-yolo', 80, 24, {
        ...buildLaunchArgs(DOCTOR_PROMPT, 'Doctor'),
        title: 'Doctor',
        // Run in its own fresh scratch subfolder rather than the flat root.
        isolateScratch: 'Doctor'
      });
      if (session) {
        const ui = useUi.getState();
        ui.enterProjectFocus(anchor.id);
        ui.selectTab(anchor.id, session.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [busy, createTerminal]);

  return (
    <Section
      title="Doctor"
      help="Spins up a focused repair agent whose only goal is to make this app run — it verifies your ~/.zcc setup, checks that runtime extensions are installed, enabled, and authorized (consented), and fixes what it safely can. It won’t add features or change behaviour; anything broader is a job for a normal agent."
    >
      {error && <p className="modal-error">{error}</p>}
      <div className="settings-btn-row">
        <button
          type="button"
          className="settings-btn"
          onClick={() => void callDoctor()}
          disabled={busy}
        >
          <Stethoscope size={14} />
          {busy ? 'Summoning…' : 'Call Doctor Agent'}
        </button>
      </div>
    </Section>
  );
}
