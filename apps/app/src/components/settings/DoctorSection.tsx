import { product } from '../../lib/product-client.js';
import { useState, useCallback } from 'react';
import { Stethoscope } from 'lucide-react';
import { useData, useUi } from '../../store.js';
import { Section, SettingsActionRow } from './FormFields.js';
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
    <Section title="Doctor">
      {error && <p className="modal-error">{error}</p>}
      <SettingsActionRow
        label="Call Doctor Agent"
        help="Verifies ~/.zcc, runtime extensions, and consent — then fixes what it safely can. It won’t add features or change behaviour."
      >
        <button
          type="button"
          className="settings-btn primary"
          onClick={() => void callDoctor()}
          disabled={busy}
        >
          <Stethoscope size={14} />
          {busy ? 'Summoning…' : 'Call Doctor'}
        </button>
      </SettingsActionRow>
    </Section>
  );
}
