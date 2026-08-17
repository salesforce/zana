import type { AppConfig } from '@shared/types';
import { SESSION_MEMORY_DEFAULTS } from '@shared/types';
import { useUi } from '../../store';
import { Section, Field, CheckboxField } from './FormFields';
import { DoctorSection } from './DoctorSection';
import { AuthorizationsSection } from './AuthorizationsSection';
import { PopoverPicklist } from '../ui/PopoverPicklist';

interface GlobalTabProps {
  config: AppConfig;
  onConfigDraft: (config: AppConfig) => void;
  onUpdate: (patch: Partial<AppConfig>) => Promise<void>;
  hooks: unknown;
  onOpen: (path: string) => void;
}

export function GlobalTab({
  config,
  onConfigDraft,
  onUpdate,
  hooks,
  onOpen
}: GlobalTabProps) {
  return (
    <>
      <Section anchorId="appearance" title="Appearance">
        <Field label="Theme">
          <PopoverPicklist
            value={config.theme}
            ariaLabel="Theme"
            searchable={false}
            onChange={(theme) => onUpdate({ theme: theme as AppConfig['theme'] })}
            options={[
              { value: 'system', label: 'System' },
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' }
            ]}
          />
        </Field>
      </Section>

      <AuthorizationsSection />

      {/* Connectivity — where remote (SSH) projects open + remote agent MCP. */}
      <Section anchorId="connectivity" title="Connectivity" help="Remote (SSH) defaults.">
        <Field
          label="Default remote path"
          help="Optional start path for remote (SSH) projects that don't set their own. Both the terminal and the Explorer open here instead of the remote home directory. A per-project remote path still overrides this. Leave blank to start in the remote home directory."
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

      {/* Performance & limits — resource ceilings that protect the host. */}
      <Section
        anchorId="performance"
        title="Performance & limits"
        help="Resource ceilings so many or runaway agents can't exhaust this machine."
      >
        <Field
          label="Max live sessions"
          help={`Hard cap on how many terminal sessions can run at once (visible, hidden, and scheduled alike). Leave blank to auto-size from this machine’s RAM — a long agent on a large-context model can hold several GB, so too many at once can exhaust memory. Range ${SESSION_MEMORY_DEFAULTS.minLiveSessions}–${SESSION_MEMORY_DEFAULTS.maxLiveSessionsCeiling}.`}
        >
          <input
            type="number"
            min={SESSION_MEMORY_DEFAULTS.minLiveSessions}
            max={SESSION_MEMORY_DEFAULTS.maxLiveSessionsCeiling}
            placeholder="auto"
            value={config.maxLiveSessions ?? ''}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === '') {
                onConfigDraft({ ...config, maxLiveSessions: undefined });
                return;
              }
              const n = parseInt(raw, 10);
              if (!Number.isNaN(n)) onConfigDraft({ ...config, maxLiveSessions: n });
            }}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              if (raw === '') {
                // Blank ⇒ clear the override, back to the RAM-derived default.
                onUpdate({ maxLiveSessions: undefined });
                return;
              }
              const n = Math.max(
                SESSION_MEMORY_DEFAULTS.minLiveSessions,
                Math.min(SESSION_MEMORY_DEFAULTS.maxLiveSessionsCeiling, parseInt(raw, 10) || 0)
              );
              onUpdate({ maxLiveSessions: n });
            }}
          />
        </Field>
        <Field
          label="Agent heap limit (MB)"
          help={`Per-session memory ceiling for claude agents, passed via NODE_OPTIONS=--max-old-space-size and inherited by any subagents the session spawns. Bounds a runaway agent so it fails its own turn instead of taking the whole app down. Default ${SESSION_MEMORY_DEFAULTS.claudeMaxOldSpaceMB}. Set to 0 to disable (let V8 auto-size). Takes effect on the next session launch.`}
        >
          <input
            type="number"
            min={0}
            max={32768}
            step={512}
            value={config.claudeMaxOldSpaceMB ?? SESSION_MEMORY_DEFAULTS.claudeMaxOldSpaceMB}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!Number.isNaN(n)) onConfigDraft({ ...config, claudeMaxOldSpaceMB: n });
            }}
            onBlur={(e) => {
              const n = parseInt(e.target.value, 10);
              const clamped = Number.isNaN(n)
                ? SESSION_MEMORY_DEFAULTS.claudeMaxOldSpaceMB
                : n <= 0
                  ? 0
                  : Math.max(512, Math.min(32768, n));
              onUpdate({ claudeMaxOldSpaceMB: clamped });
            }}
          />
        </Field>
      </Section>

      <Section anchorId="projects" title="Projects">
        <Field
          label="Clone root"
          help="Folder that “Import from Git” clones repos into. Leave blank for the default (~/zcc-workspace). Must be an absolute path."
          mono
        >
          <input
            type="text"
            value={config.cloneRoot ?? ''}
            placeholder="~/zcc-workspace"
            onChange={(e) => onConfigDraft({ ...config, cloneRoot: e.target.value })}
            onBlur={(e) => onUpdate({ cloneRoot: e.target.value.trim() })}
            spellCheck={false}
          />
        </Field>
      </Section>

      <Section anchorId="inbox" title="Inbox">
        <CheckboxField
          label="Show inbox guidance"
          help="Hint cards in the inbox view."
          checked={config.inboxGuidanceEnabled ?? true}
          onChange={(v) => onUpdate({ inboxGuidanceEnabled: v })}
        />
        <CheckboxField
          label="Trust all ZCC tools"
          help="Pre-authorize every zcc-inbox tool for terminal agents this app launches, so they’re never prompted to use them (messaging peers, pushing to your inbox, the library, follow-ups, and more). On by default, which also pre-approves privileged tools — remote shell exec and library delete — for ordinary sessions, not just autonomous team runs. Turn it off if you'd rather approve those the first time they're used. Applies to sessions started after you toggle it."
          checked={config.trustZccToolsEnabled ?? true}
          onChange={(v) => onUpdate({ trustZccToolsEnabled: v })}
        />
        <Field
          label="PDF download folder"
          help="Folder that inbox “Download as PDF” saves into. Leave blank for your Downloads folder. Must be an absolute path."
          mono
        >
          <input
            type="text"
            value={config.pdfExportDir ?? ''}
            placeholder="~/Downloads"
            onChange={(e) => onConfigDraft({ ...config, pdfExportDir: e.target.value })}
            onBlur={(e) => onUpdate({ pdfExportDir: e.target.value.trim() })}
            spellCheck={false}
          />
        </Field>
      </Section>

      <Section title="Help">
        <p className="settings-help">
          New here? Replay the quick walkthrough — launching an agent, adding a project, and
          creating a schedule.
        </p>
        <button
          type="button"
          className="settings-btn"
          onClick={() => useUi.getState().setWalkthroughOpen(true)}
        >
          Replay walkthrough
        </button>
        <p className="settings-help" style={{ marginTop: 14 }}>
          Check that the companion pieces — the Claude Code CLI and Zana —
          are installed, and set up any that are missing.
        </p>
        <button
          type="button"
          className="settings-btn"
          onClick={() => {
            void window.cc.deps.check();
            useUi.getState().setSetupOpen(true);
          }}
        >
          Check setup
        </button>
      </Section>

      <Section title="Hooks" help={<>Read-only view of <code>hooks</code> in <code>~/.claude/settings.json</code>.</>}>
        {hooks == null ? (
          <p className="settings-help settings-help--muted">No hooks configured.</p>
        ) : (
          <pre className="settings-code-block">{JSON.stringify(hooks, null, 2)}</pre>
        )}
        <button
          type="button"
          className="settings-btn"
          onClick={() => onOpen('~/.claude/settings.json')}
        >
          Edit in Cursor
        </button>
      </Section>

      <Section title="Quick open" help="Opens config files in Cursor.">
        <div className="settings-btn-row">
          <button className="settings-btn" onClick={() => onOpen('~/.claude/settings.json')}>
            ~/.claude/settings.json
          </button>
          <button className="settings-btn" onClick={() => onOpen('~/.claude.json')}>
            ~/.claude.json
          </button>
        </div>
      </Section>

      <DoctorSection />
    </>
  );
}
