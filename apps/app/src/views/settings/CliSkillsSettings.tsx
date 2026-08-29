import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleDashed } from 'lucide-react';
import { product } from '../../lib/product-client.js';
import { Section } from '@/components/settings/FormFields';
import { useHosts } from '@/hooks/useHosts';
import {
  cliSkillBulkLabel,
  cliSkillInstallError,
  cliSkillPresentation,
  pendingCliSkillHostIds,
  type CliSkillMachineRow,
  type CliSkillTone
} from './cli-skills-status.js';

type MachineStatus = Awaited<ReturnType<typeof product.cliSkills.status>>['machines'][number];

function StatusIcon({ tone }: { tone: CliSkillTone }) {
  if (tone === 'ok') return <CheckCircle2 size={16} aria-hidden="true" />;
  if (tone === 'warn') return <AlertTriangle size={16} aria-hidden="true" />;
  return <CircleDashed size={16} aria-hidden="true" />;
}

export function CliSkillsMachinePanel({
  machines,
  busyKey,
  error,
  onInstall
}: {
  machines: CliSkillMachineRow[];
  busyKey: string | null;
  error: string | null;
  onInstall: (hostIds: string[]) => void;
}) {
  const bulkLabel = cliSkillBulkLabel(machines);
  const pendingIds = pendingCliSkillHostIds(machines);

  return (
    <>
      {machines.length === 0 ? (
        <p className="settings-help settings-help--muted">Pair a machine first, then install the skill there.</p>
      ) : (
        <ul className="cli-skills-list" data-testid="cli-skills-status">
          {machines.map((row) => {
            const copy = cliSkillPresentation(row.status);
            const rowBusy = busyKey === row.hostId || busyKey === 'all';
            return (
              <li
                key={row.hostId}
                className={`cli-skills-row cli-skills-row--${copy.tone}`}
              >
                <span className="cli-skills-icon">
                  <StatusIcon tone={copy.tone} />
                </span>
                <div className="cli-skills-row-copy">
                  <strong title={row.hostName}>{row.hostName}</strong>
                  <p>{copy.hint}</p>
                </div>
                <div className="cli-skills-row-actions">
                  <span className={`settings-badge${copy.tone === 'warn' ? ' settings-badge--warn' : copy.tone === 'ok' ? ' settings-badge--ok' : ''}`}>
                    {copy.label}
                  </span>
                  {copy.actionLabel ? (
                    <button
                      type="button"
                      className="settings-btn"
                      disabled={busyKey !== null}
                      onClick={() => onInstall([row.hostId])}
                    >
                      {rowBusy ? 'Working…' : copy.actionLabel}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="modal-error">{error}</p>}
      {bulkLabel ? (
        <div className="cli-skills-toolbar">
          <button
            type="button"
            className="settings-btn primary"
            disabled={busyKey !== null}
            onClick={() => onInstall(pendingIds)}
          >
            {busyKey === 'all' ? 'Installing…' : bulkLabel}
          </button>
        </div>
      ) : null}
    </>
  );
}

export function CliSkillsSettings() {
  const hosts = useHosts();
  const [machines, setMachines] = useState<MachineStatus[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
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

  const install = (hostIds: string[]) => {
    if (hostIds.length === 0) {
      setError('Pair a machine first');
      return;
    }
    setBusyKey(hostIds.length === 1 ? hostIds[0]! : 'all');
    setError(null);
    product.cliSkills
      .install(hostIds)
      .then((body) => {
        setError(cliSkillInstallError(body.results));
        refresh();
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusyKey(null));
  };

  return (
    <Section
      anchorId="cli-skills"
      title="CLI skills"
      help={
        <>
          Give agents outside Zana the <code>zcc-cli</code> skill. Each machine
          stores a copy in <code>~/.agents/skills</code> and <code>~/.claude/skills</code>.
        </>
      }
    >
      <CliSkillsMachinePanel
        machines={machines}
        busyKey={busyKey}
        error={error}
        onInstall={install}
      />
    </Section>
  );
}
