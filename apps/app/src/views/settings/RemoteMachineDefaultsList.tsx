import { useHosts } from '../../hooks/useHosts.js';
import { getSettingsRoutePath } from '../../lib/route-paths.js';
import { Section } from '@/components/settings/FormFields';

/**
 * Read-only list of enrolled-machine workspace defaults. Edit them on
 * Settings → Machines so catalogues stay distinct.
 */
export function RemoteMachineDefaultsList() {
  const hosts = useHosts().filter((host) => !host.isPrimary);
  return (
    <Section
      anchorId="legacy-agent-remote-defaults"
      title="Remote defaults"
      help="Each enrolled machine has its own start path for SSH projects that do not set a per-project Remote start path. Edit the path on Machines."
    >
      {hosts.length === 0 ? (
        <p className="settings-help" data-testid="remote-machine-defaults-empty">
          No enrolled machines yet.{' '}
          <a href={getSettingsRoutePath('machines')}>Add a machine</a>
          {' '}to set a per-box workspace path.
        </p>
      ) : (
        <ul className="remote-machine-defaults" data-testid="remote-machine-defaults">
          {hosts.map((host) => (
            <li key={host.id} className="settings-field settings-field--mono">
              <span className="settings-label">{host.name}</span>
              <span data-testid={`remote-machine-default-${host.id}`}>
                {host.defaultWorkspacePath || 'Not set'}
              </span>
              {host.defaultWorkspacePath ? null : (
                <p className="settings-help">
                  Falls through to Connectivity’s global default, then the remote home directory.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="settings-help">
        <a href={getSettingsRoutePath('machines')} data-testid="remote-machine-defaults-link">
          Edit on Machines
        </a>
      </p>
    </Section>
  );
}
