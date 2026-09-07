import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { Section, Field, CheckboxField } from '@/components/settings/FormFields';

interface ConnectivityViewProps {
  config: AppConfig;
  onConfigDraft: (config: AppConfig) => void;
  onUpdate: (patch: Partial<AppConfig>) => Promise<void>;
}

/**
 * Remote (SSH) defaults. Enrolled host-daemon machines stay on Settings →
 * Machines; this page is the SSH start path and inbox-over-tunnel opt-in.
 */
export function ConnectivityView({
  config,
  onConfigDraft,
  onUpdate
}: ConnectivityViewProps) {
  return (
    <Section
      anchorId="connectivity-remote"
      title="Remote SSH"
      help="Defaults for remote (SSH) projects. Enrolled machines live under Settings → Machines."
    >
      <Field
        label="Default remote path"
        help="Fallback start path for SSH remotes that are not paired to a Machine and do not set their own project path. Enrolled machines have their own default under Settings → Machines. A per-project Remote start path still wins. Leave blank to start in the remote home directory."
      >
        <input
          type="text"
          placeholder="/path/to/workspaces"
          value={config.remoteDefaultPath ?? ''}
          onChange={(e) => onConfigDraft({ ...config, remoteDefaultPath: e.target.value })}
          onBlur={(e) => onUpdate({ remoteDefaultPath: e.target.value.trim() })}
        />
      </Field>
      <CheckboxField
        label="Give remote agents the inbox (MCP over the tunnel)"
        help="Forward the zcc-inbox MCP server to remote (SSH) agents over the same reverse tunnel already used for live status. When on, a remote Claude agent can push to your inbox, ask questions, search the inbox, coordinate with peers, and read/write the project library — the same tools a local agent has. Off by default: without it, remote agents can only report status via fire-and-forget hooks. The reverse tunnel is a prerequisite, so this has no effect on shell/scheduled remote sessions."
        checked={config.remoteMcpEnabled ?? false}
        onChange={(v) => onUpdate({ remoteMcpEnabled: v })}
      />
    </Section>
  );
}

export { ConnectivityView as ConnectivityTab };
