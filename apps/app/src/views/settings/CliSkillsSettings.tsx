import { useCallback, useEffect, useState } from 'react';
import { product } from '../../lib/product-client.js';
import { Section } from '@/components/settings/FormFields';
import { useHosts } from '@/hooks/useHosts';

type MachineStatus = Awaited<ReturnType<typeof product.cliSkills.status>>['machines'][number];

function statusLabel(status: MachineStatus['status']): string {
  if (status === 'installed') return 'Installed';
  if (status === 'outdated') return 'Needs update';
  if (status === 'missing') return 'Not installed';
  return 'Unknown';
}

export function CliSkillsSettings() {
  const hosts = useHosts();
  const [machines, setMachines] = useState<MachineStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    product.cliSkills
      .status()
      .then((body) => setMachines(body.machines))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    refresh();
  }, [hosts, refresh]);

  const installable = machines.filter((row) => row.status !== 'unknown');
  const install = () => {
    const hostIds = (installable.length > 0 ? installable : machines).map((row) => row.hostId);
    if (hostIds.length === 0) {
      setError('Pair a machine first');
      return;
    }
    setBusy(true);
    setError(null);
    product.cliSkills
      .install(hostIds)
      .then((body) => {
        const failed = body.results.filter((row) => !row.ok);
        if (failed.length > 0) {
          setError(failed.map((row) => `${row.hostName}: ${row.errorMessage}`).join(' · '));
        }
        refresh();
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  return (
    <Section
      anchorId="cli-skills"
      title="CLI skills"
      help="Install the zcc-cli skill into ~/.agents/skills and ~/.claude/skills on each machine so agents outside Zana can drive the CLI."
    >
      {machines.length === 0 ? (
        <p className="settings-help settings-help--muted">No machines enrolled yet.</p>
      ) : (
        <ul className="cli-skills-list" data-testid="cli-skills-status">
          {machines.map((row) => (
            <li key={row.hostId} className="cli-skills-row">
              <span>{row.hostName}</span>
              <span className={`settings-badge${row.status === 'missing' || row.status === 'outdated' ? ' settings-badge--warn' : ''}`}>
                {statusLabel(row.status)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="modal-error">{error}</p>}
      <button
        type="button"
        className="settings-btn primary"
        disabled={busy || machines.length === 0}
        onClick={install}
      >
        {busy ? 'Installing…' : 'Install'}
      </button>
    </Section>
  );
}
