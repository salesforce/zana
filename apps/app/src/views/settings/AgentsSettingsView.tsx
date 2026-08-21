import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { AUTO_CLOSE_IDLE_DEFAULTS, HEARTBEAT_DEFAULTS } from '@zana-ai/zcc-domain/product';
import { Section, Field, CheckboxField } from '@/components/settings/FormFields';
import { OverseerRecentPane } from '@/components/settings/OverseerRecentPane';
import { PopoverPicklist } from '@/components/ui/PopoverPicklist';

export function AgentsSettingsView({
  config,
  onConfigDraft,
  onUpdate
}: {
  config: AppConfig;
  onConfigDraft: (config: AppConfig) => void;
  onUpdate: (patch: Partial<AppConfig>) => Promise<void>;
}) {
  // Auto mode defaults ON (absent ⇒ true). The Overseer only makes sense as the
  // fallback, so we soften its help text while auto mode is on.
  const autoModeOn = config.autoModeEnabled ?? true;
  return (
    <>
      {/* Auto mode — Claude Code's native, classifier-backed permission mode.
          The default gate for every interactive claude agent. */}
      <Section
        anchorId="auto-mode"
        title="Auto mode"
        help={
          <>
            Launch every claude agent in Claude Code&rsquo;s native{' '}
            <strong>auto mode</strong> — a server-side classifier reviews each tool
            call, blocking anything irreversible, destructive, or aimed outside
            your environment while skipping the routine permission prompts. Unlike
            the Overseer below (which can only ever loosen), auto mode is a real
            guardrail that both allows and blocks. On by default. Applies to new
            sessions; an explicitly-chosen permission mode (global, persona,
            project, or per-tab) overrides it for that launch, and agents on a model
            that can&rsquo;t support auto mode fall back automatically.{' '}
            <a
              href="https://code.claude.com/docs/en/permission-modes#eliminate-prompts-with-auto-mode"
              target="_blank"
              rel="noreferrer"
            >
              Docs
            </a>
            .
          </>
        }
      >
        <CheckboxField
          label="Use auto mode by default"
          help="When on, new claude agents launch with --permission-mode auto (and the enable flag on Bedrock/Vertex/Foundry). When off, agents use your default permission mode and the Overseer fallback below (if armed)."
          checked={autoModeOn}
          onChange={(v) => onUpdate({ autoModeEnabled: v })}
        />
        {autoModeOn && (
          <>
            <Field
              label="Trusted environment"
              help="One rule per line, added on top of Claude Code's built-in defaults (they're never replaced). Natural-language descriptions of repos, buckets, domains, and services the classifier should treat as inside your boundary, so routine internal operations stop getting blocked. Example: “Source control: github.com/my-org and all repos under it”."
            >
              <textarea
                rows={3}
                defaultValue={(config.autoModeEnvironment ?? []).join('\n')}
                placeholder={'Source control: github.com/my-org\nTrusted internal domains: *.corp.example.com'}
                onBlur={(e) =>
                  onUpdate({
                    autoModeEnvironment: e.target.value
                      .split('\n')
                      .map((s) => s.trim())
                      .filter(Boolean)
                  })
                }
              />
            </Field>
            <Field
              label="Allow rules"
              help="Exceptions to the built-in soft-block rules (one per line, additive). Use when the classifier repeatedly flags a routine pattern the defaults don't cover. Example: “Writing to s3://my-scratch/ is allowed: ephemeral bucket with a 7-day lifecycle”."
            >
              <textarea
                rows={2}
                defaultValue={(config.autoModeAllow ?? []).join('\n')}
                placeholder={'Deploying to the staging namespace is allowed'}
                onBlur={(e) =>
                  onUpdate({
                    autoModeAllow: e.target.value
                      .split('\n')
                      .map((s) => s.trim())
                      .filter(Boolean)
                  })
                }
              />
            </Field>
            <Field
              label="Extra soft-deny rules"
              help="Destructive actions specific to your environment that user intent can still clear (one per line, additive to the defaults). Example: “Never run database migrations outside the migrations CLI, even against dev databases”."
            >
              <textarea
                rows={2}
                defaultValue={(config.autoModeSoftDeny ?? []).join('\n')}
                placeholder={'Never modify files under infra/terraform/prod/'}
                onBlur={(e) =>
                  onUpdate({
                    autoModeSoftDeny: e.target.value
                      .split('\n')
                      .map((s) => s.trim())
                      .filter(Boolean)
                  })
                }
              />
            </Field>
            <Field
              label="Extra hard-deny rules"
              help="Unconditional security boundaries — user intent and allow rules never override these (one per line, additive to the defaults). Example: “Never send repository contents to third-party code-review APIs”."
            >
              <textarea
                rows={2}
                defaultValue={(config.autoModeHardDeny ?? []).join('\n')}
                placeholder={'Never send repository contents to third-party APIs'}
                onBlur={(e) =>
                  onUpdate({
                    autoModeHardDeny: e.target.value
                      .split('\n')
                      .map((s) => s.trim())
                      .filter(Boolean)
                  })
                }
              />
            </Field>
            <CheckboxField
              label="Classify all shell commands"
              help="Route every Bash/PowerShell command through the classifier while auto mode is active, even ones a narrow allow rule would approve instantly. More coverage, a little more latency per shell command. Off by default."
              checked={config.autoModeClassifyAllShell ?? false}
              onChange={(v) => onUpdate({ autoModeClassifyAllShell: v })}
            />
          </>
        )}
      </Section>

      <Section
        anchorId="git-worktrees"
        title="Git worktrees"
        help="Give parallel agents separate branches and checkouts under ~/zcc-worktrees so they cannot overwrite each other's files. Available for local Git projects; each launch can override this default."
      >
        <CheckboxField
          label="Isolate new agents in a git worktree by default"
          help="Pre-checks Worktree under New Agent > Customize launch. Project settings can override this global default."
          checked={config.worktreeIsolationDefault ?? false}
          onChange={(v) => onUpdate({ worktreeIsolationDefault: v })}
        />
      </Section>

      {/* Agent tabs — presentation of agent/claude tabs. */}
      <Section
        anchorId="agent-tabs"
        title="Tabs"
        help="How agent tabs are presented."
      >
        <CheckboxField
          label="Auto-name tabs"
          help="Name a claude tab from its first instruction via the tab-namer prompt (edit it under Prompts). Off falls back to Claude’s idle title."
          checked={config.autoRenameTabs ?? true}
          onChange={(v) => onUpdate({ autoRenameTabs: v })}
        />
      </Section>

      {/* Agent attention — surfacing which agents need you. The triage sub-settings
          (delay / sensitivity / side-list promotion) only show when it's on. */}
      <Section
        anchorId="agent-attention"
        title="Agent attention"
        help="How the app decides which idle agents are waiting on you and where they surface."
      >
        <CheckboxField
          label="Idle-agent triage"
          help="When an agent goes idle, classify why — waiting on you, done, or paused — and badge it on the Agents board. Uses the idle-triage prompt (edit under Prompts). Off by default: it spends tokens, one claude call per idle spell."
          checked={config.idleTriageEnabled ?? false}
          onChange={(v) => onUpdate({ idleTriageEnabled: v })}
        />
        {config.idleTriageEnabled && (
          <>
            <Field
              label="Need Attention idle delay (seconds)"
              help="How long an agent must stay idle before it's triaged (filters the 1–2s idle flicker between tool calls). Range 10–600."
            >
              <input
                type="number"
                min={10}
                max={600}
                value={config.idleTriageDelaySeconds ?? 20}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (!Number.isNaN(n)) onConfigDraft({ ...config, idleTriageDelaySeconds: n });
                }}
                onBlur={(e) => {
                  const n = Math.max(10, Math.min(600, parseInt(e.target.value, 10) || 20));
                  onUpdate({ idleTriageDelaySeconds: n });
                }}
              />
            </Field>
            <Field
              label="Need Attention sensitivity"
              help="How aggressively a triaged idle agent jumps to the “Needs you” lane. High surfaces almost any non-done idle agent; Medium only genuine questions; Low only high-confidence questions."
            >
              <PopoverPicklist
                value={config.idleAttentionSensitivity ?? 'medium'}
                ariaLabel="Need Attention sensitivity"
                searchable={false}
                onChange={(idleAttentionSensitivity) =>
                  onUpdate({
                    idleAttentionSensitivity: idleAttentionSensitivity as AppConfig['idleAttentionSensitivity']
                  })
                }
                options={[
                  { value: 'high', label: 'High' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'low', label: 'Low' }
                ]}
              />
            </Field>
            <CheckboxField
              label="Promote triaged agents to “Needs you” in the side list"
              help="Also surface a triage-flagged idle agent in the left-side agents list’s “Needs you” group (matching the Agents board), at the sensitivity above. Off by default: the side list’s “Needs you” then holds only agents blocked on a real prompt, and a triaged idle agent stays under Idle."
              checked={config.agentListNeedsYouFromTriage ?? false}
              onChange={(v) => onUpdate({ agentListNeedsYouFromTriage: v })}
            />
          </>
        )}
        <CheckboxField
          label="Quiet questions while working"
          help="Hold a blocking agent question (inbox_ask, or an inbox_push question marked blocking) while its agent is still working, and surface it the moment the agent goes idle — so a busy fleet doesn’t fill your inbox with half-relevant questions it often resolves itself first. A plain status report or a soft/optional question always appears immediately. Spends no tokens; can only ever delay a question, never drop one. On by default."
          checked={config.heldQuestionsEnabled ?? true}
          onChange={(v) => onUpdate({ heldQuestionsEnabled: v })}
        />
        <CheckboxField
          label="Interactive question form"
          help="When an agent question (in the agent modal, inbox, or a follow-up) carries answer options, render them as an interactive form — lettered choices, an optional ‘Other…’ row, Skip/Continue — instead of plain text with a free-text reply box. On by default. Turn off if the form feels overwhelming: the question then shows as plain markdown with a simple reply box everywhere (the options are still listed in the text). A display choice only — it never changes what the agent receives."
          checked={config.structuredQuestionsEnabled ?? true}
          onChange={(v) => onUpdate({ structuredQuestionsEnabled: v })}
        />
        <CheckboxField
          label="Auto-link report files to the inbox"
          help="When an agent writes a report-looking markdown file (a report/summary/analysis/audit name, or any bare .md dropped at the project root) but never calls inbox_push itself, link it to the inbox automatically as soon as the agent goes idle — so it still shows up in that session’s Report tab. Pure filename match, spends no tokens. On by default."
          checked={config.autoReportLinkEnabled ?? true}
          onChange={(v) => onUpdate({ autoReportLinkEnabled: v })}
        />
      </Section>

      {/* Agent automation — capabilities that let agents (or a bulk action) end or
          spawn sessions. All off by default; the MCP ones gate whether the tool is
          even registered, so they take effect on the next app launch. */}
      <Section
        anchorId="agent-automation"
        title="Agent automation"
        help="Bulk and agent-driven actions that close or launch sessions. All off by default."
      >
        <CheckboxField
          label="Agent self-close (MCP)"
          help="Let a running agent close its own session via the close_session / close_session_with_summary MCP tools — the with-summary variant writes the agent’s own note to the inbox first. Off by default; takes effect on the next app launch. The agent can only ever close itself, never another session."
          checked={config.agentSelfCloseEnabled ?? false}
          onChange={(v) => onUpdate({ agentSelfCloseEnabled: v })}
        />
        <CheckboxField
          label="Agent close-idle-peers (MCP)"
          help="Let a running agent close every OTHER idle agent via the close_idle_agents MCP tool — its own project by default, or all projects on request. Each closed agent’s work is summarized to the inbox first (one claude call per agent) and the wrap-up is handed back so the agent can store it. The caller never closes itself. Off by default; takes effect on the next app launch."
          checked={config.closeIdlePeersEnabled ?? false}
          onChange={(v) => onUpdate({ closeIdlePeersEnabled: v })}
        />
        <CheckboxField
          label="Agent launch-team (MCP)"
          help="Let a running agent launch a Team via the launch_team MCP tool — opening one tab per slot (workers first, then an orchestrator handed the workers’ session ids to delegate with). Launches into the agent’s own project by default, or a named one. Off by default; takes effect on the next app launch. The operator can always launch teams from the New-agent launcher’s autonomous mode regardless."
          checked={config.teamLaunchEnabled ?? false}
          onChange={(v) => onUpdate({ teamLaunchEnabled: v })}
        />
      </Section>

      {/* Agent heartbeat — auto-nudge a stalled agent. Its tuning sub-fields
          (delay / max nudges / message) only show when it's on. */}
      <Section
        anchorId="agent-heartbeat"
        title="Agent heartbeat"
        help="Keep an opted-in agent moving by typing a nudge when it sits idle. Off by default — it types into a live session and spends tokens."
      >
        <CheckboxField
          label="Agent heartbeat"
          help="Show a per-agent “Heartbeat” toggle in the agent inspector. When on for an agent, the app types a nudge into it after it sits idle for the delay below, so it keeps working without you. Never applies to background (scheduled/hidden) agents. Off by default — it types into a live session and spends tokens."
          checked={config.heartbeatEnabled ?? false}
          onChange={(v) => onUpdate({ heartbeatEnabled: v })}
        />
        {config.heartbeatEnabled && (
          <>
            <Field
              label="Heartbeat idle delay (seconds)"
              help="How long an agent must stay idle before a nudge fires (also the interval between repeat nudges). Range 10–600."
            >
              <input
                type="number"
                min={10}
                max={600}
                value={config.heartbeatDelaySeconds ?? HEARTBEAT_DEFAULTS.delaySeconds}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (!Number.isNaN(n)) onConfigDraft({ ...config, heartbeatDelaySeconds: n });
                }}
                onBlur={(e) => {
                  const n = Math.max(
                    10,
                    Math.min(600, parseInt(e.target.value, 10) || HEARTBEAT_DEFAULTS.delaySeconds)
                  );
                  onUpdate({ heartbeatDelaySeconds: n });
                }}
              />
            </Field>
            <Field
              label="Heartbeat max nudges"
              help="After this many consecutive nudges with no progress, heartbeat turns itself off for that agent and posts an inbox notice. Range 1–100."
            >
              <input
                type="number"
                min={1}
                max={100}
                value={config.heartbeatMaxNudges ?? HEARTBEAT_DEFAULTS.maxNudges}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (!Number.isNaN(n)) onConfigDraft({ ...config, heartbeatMaxNudges: n });
                }}
                onBlur={(e) => {
                  const n = Math.max(
                    1,
                    Math.min(100, parseInt(e.target.value, 10) || HEARTBEAT_DEFAULTS.maxNudges)
                  );
                  onUpdate({ heartbeatMaxNudges: n });
                }}
              />
            </Field>
            <Field
              label="Heartbeat message"
              help="The text typed into an idle agent on each nudge (submitted like an inbox reply). Leave blank to use the built-in default."
            >
              <textarea
                rows={2}
                value={config.heartbeatMessage ?? HEARTBEAT_DEFAULTS.message}
                onChange={(e) => onConfigDraft({ ...config, heartbeatMessage: e.target.value })}
                onBlur={(e) => onUpdate({ heartbeatMessage: e.target.value.trim() })}
              />
            </Field>
          </>
        )}
        <Field
          label="Autonomous run timeout (minutes, 0 = no timeout)"
          help="How long an autonomous squad can run before timing out. Set to 0 to disable timeout completely. Default is 45 minutes. Range 0 (disabled) or 1–1440 (1 minute to 24 hours)."
        >
          <input
            type="number"
            min={0}
            max={1440}
            value={
              config.autonomousTimeoutMs === 0
                ? 0
                : Math.round((config.autonomousTimeoutMs ?? 45 * 60 * 1000) / 60000)
            }
            onChange={(e) => {
              const minutes = parseInt(e.target.value, 10);
              if (!Number.isNaN(minutes)) {
                onConfigDraft({ ...config, autonomousTimeoutMs: minutes === 0 ? 0 : minutes * 60000 });
              }
            }}
            onBlur={(e) => {
              const minutes = parseInt(e.target.value, 10);
              const clamped = Number.isNaN(minutes)
                ? 45 * 60 * 1000
                : minutes <= 0
                  ? 0
                  : Math.max(1, Math.min(1440, minutes)) * 60000;
              onUpdate({ autonomousTimeoutMs: clamped });
            }}
          />
        </Field>
        <Field
          label="Max autonomous rounds (0 = unlimited)"
          help="Maximum number of turns an autonomous squad can take before stopping. Set to 0 for unlimited. Default is 30. Range 0 (unlimited) or 1–1000."
        >
          <input
            type="number"
            min={0}
            max={1000}
            value={config.autonomousMaxRounds ?? 30}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!Number.isNaN(n)) onConfigDraft({ ...config, autonomousMaxRounds: n });
            }}
            onBlur={(e) => {
              const n = parseInt(e.target.value, 10);
              const clamped = Number.isNaN(n) ? 30 : n <= 0 ? 0 : Math.max(1, Math.min(1000, n));
              onUpdate({ autonomousMaxRounds: clamped });
            }}
          />
        </Field>
        <CheckboxField
          label="Keep Mac awake while agents work"
          help="Stop macOS from idle-sleeping while any agent is actively working, so you can lock the screen and walk away without killing an in-flight turn. Only the system stays awake — the display can still sleep. Releases shortly after all agents go quiet. On by default."
          checked={config.keepAwakeWhileWorking !== false}
          onChange={(v) => onUpdate({ keepAwakeWhileWorking: v })}
        />
      </Section>

      {/* Auto-close idle agents — reclaim at-rest agents on a timer. Its dwell
          sub-field only shows when it's on. Distinct from heartbeat (which
          KEEPS an agent going) — this CLOSES one that's done sitting idle. */}
      <Section
        anchorId="auto-close-idle"
        title="Idle handling & follow-ups"
        help="What happens to an agent that sits idle: close it on a timer, and keep any question it parked as a durable follow-up. Off by default — auto-close ends live sessions. Never touches background (scheduled/hidden) or delegating agents."
      >
        <CheckboxField
          label="Follow-ups"
          help="Show the Follow-ups tab in a project — durable parked questions surfaced from idle-triage and auto-close, so a question an agent raised isn't lost. Off ⇒ the Follow-ups project tab is removed."
          checked={config.followUpsEnabled ?? false}
          onChange={(v) => onUpdate({ followUpsEnabled: v })}
        />
        <CheckboxField
          label="Confirm before quitting with live sessions"
          help="On by default. When quitting the app with terminals or agents still running, show a “Quit and end N running session(s)?” prompt so you don’t lose in-flight work (sessions aren’t saved between launches). Turn off to quit immediately without the prompt — the live sessions are still terminated, just without asking."
          checked={config.confirmQuitOnLiveSessions !== false}
          onChange={(v) => onUpdate({ confirmQuitOnLiveSessions: v })}
        />
        <CheckboxField
          label="Auto-close idle agents"
          help="When on, any non-background agent that stays idle for the dwell below is closed automatically (exit code 0). The agent you’re actively viewing is spared, as is one still delegating to sub-agents. If it had parked a question, that becomes a durable follow-up before the close (and is surfaced in the inbox). Off by default. Also toggleable from the sidebar."
          checked={config.autoCloseIdleEnabled ?? false}
          onChange={(v) => onUpdate({ autoCloseIdleEnabled: v })}
        />
        {config.autoCloseIdleEnabled && (
          <>
            <Field
              label="Idle dwell before close (minutes)"
              help="How long an agent must stay continuously idle before it's auto-closed. A human keystroke into the tab within this window also spares it. Range 1–240."
            >
              <input
                type="number"
                min={AUTO_CLOSE_IDLE_DEFAULTS.minMinutes}
                max={AUTO_CLOSE_IDLE_DEFAULTS.maxMinutes}
                value={config.autoCloseIdleMinutes ?? AUTO_CLOSE_IDLE_DEFAULTS.minutes}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (!Number.isNaN(n)) onConfigDraft({ ...config, autoCloseIdleMinutes: n });
                }}
                onBlur={(e) => {
                  const n = Math.max(
                    AUTO_CLOSE_IDLE_DEFAULTS.minMinutes,
                    Math.min(
                      AUTO_CLOSE_IDLE_DEFAULTS.maxMinutes,
                      parseInt(e.target.value, 10) || AUTO_CLOSE_IDLE_DEFAULTS.minutes
                    )
                  );
                  onUpdate({ autoCloseIdleMinutes: n });
                }}
              />
            </Field>
            <CheckboxField
              label="Post a breadcrumb to the inbox on auto-close"
              help="Off by default. An idle auto-close is routine and is already recorded in the Activity Feed and the Agents tab, so no inbox notice is posted unless you turn this on. When on, each close leaves a folded entry in the inbox's collapsed “Agent closed” section. (A close that preserved a parked question always surfaces its follow-up regardless.)"
              checked={config.autoCloseIdleNotifyInbox ?? false}
              onChange={(v) => onUpdate({ autoCloseIdleNotifyInbox: v })}
            />
          </>
        )}
      </Section>

      {/* Overseer — the auto-mode-OFF fallback auto-approval cascade. The
          sub-settings (LLM tier, deny patterns) only show once it's armed. */}
      <Section
        anchorId="overseer"
        title="Overseer (fallback auto-approve)"
        help={
          autoModeOn
            ? 'A local auto-approval cascade for launches where auto mode is unavailable (older model) or turned off. While auto mode is on it is not installed — auto mode supersedes it. It can only ever turn a prompt into an auto-approve, never block, and is fail-open. Applies to new sessions.'
            : 'A local auto-approval cascade that skips the permission prompt for provably-safe tool calls (read-only tools, git status–class shell). It can only ever turn a prompt into an auto-approve — it never blocks a tool call — and is fail-open: if it errors or you turn it off, your normal prompts come back unchanged. Applies to new sessions.'
        }
      >
        <Field
          label="Mode"
          help="Off: no hook installed, fully inert. Dry-run: logs what it WOULD auto-approve (in the terminal) but still prompts you — try this first. On: auto-approvals take effect."
        >
          <PopoverPicklist
            value={config.overseerMode ?? 'off'}
            ariaLabel="Overseer mode"
            searchable={false}
            onChange={(overseerMode) =>
              onUpdate({ overseerMode: overseerMode as AppConfig['overseerMode'] })
            }
            options={[
              { value: 'off', label: 'Off' },
              { value: 'dryRun', label: 'Dry-run (observe only)' },
              { value: 'on', label: 'On' }
            ]}
          />
        </Field>
        {config.overseerMode && config.overseerMode !== 'off' && (
          <>
            <CheckboxField
              label="LLM judgment tier"
              help="For calls the static safe-list doesn’t cover, ask a quick claude micro-call (overseer-judge prompt, edit under Prompts) whether it’s safe to auto-approve. Off by default — it spends tokens, one call per unresolved tool call. Anything it isn’t confident about still prompts you."
              checked={config.overseerLlmTierEnabled ?? false}
              onChange={(v) => onUpdate({ overseerLlmTierEnabled: v })}
            />
            {config.overseerLlmTierEnabled && (
              <CheckboxField
                label="Deep judgment (think harder)"
                help="When the fast judge isn’t sure but the call looks probably safe, take a second, more careful look with a stronger model before deciding. Approves more of the safe-but-nuanced calls (a scoped edit, a build/test command) at the cost of a few extra seconds and tokens on those calls only — the agent waits a little longer just on the escalated ones. Same conservative bar; anything it still isn’t confident about prompts you."
                checked={config.overseerDeepTierEnabled ?? false}
                onChange={(v) => onUpdate({ overseerDeepTierEnabled: v })}
              />
            )}
            <Field
              label="Extra deny patterns"
              help="One substring per line (added on top of the built-in guardrails). A match — against the tool name or its input — forces the normal prompt and skips the LLM tier. Use for anything you never want auto-approved."
            >
              <textarea
                rows={4}
                defaultValue={(config.overseerDenyPatterns ?? []).join('\n')}
                placeholder={'git push\nmigrate\n.prod'}
                onBlur={(e) =>
                  onUpdate({
                    overseerDenyPatterns: e.target.value
                      .split('\n')
                      .map((s) => s.trim())
                      .filter(Boolean)
                  })
                }
              />
            </Field>
            <Field
              label="Recent decisions"
              help="A live, read-only view of the latest tool calls the cascade decided for current sessions (newest first, bounded). In dry-run these are what it WOULD have auto-approved; switch to On once they look right."
            >
              <OverseerRecentPane dryRun={config.overseerMode === 'dryRun'} />
            </Field>
          </>
        )}
      </Section>
    </>
  );
}

export { AgentsSettingsView as AgentsTab };
