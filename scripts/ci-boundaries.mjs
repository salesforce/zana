import { existsSync } from 'node:fs';

/** Conservative ownership map: changed production seams run their real app tests. */
export function boundarySpecs(paths) {
  const specs = new Set();
  const add = (...names) => names.forEach(name => specs.add(`e2e/${name}.spec.ts`));
  for (const path of paths) {
    // A changed test must verify itself, including CI-only regression repairs.
    if (/^e2e\/[^/]+\.spec\.ts$/.test(path) && existsSync(path)) specs.add(path);
    if (/^(apps\/|packages\/|plugins\/|e2e\/|scripts\/.*(electron|e2e|build)|electron\.vite|package\.json|pnpm-lock)/.test(path)) add('smoke');
    if (/threads|thread-view|agent-runtime|provider-bridge|provider-(acp|codex)|host-hub|control-sdk/.test(path)) add('thread-plan-ux', 'thread-refresh-progress', 'provider-bridge-framing', 'thread-loading');
    if (/plugin-host-artifact|plugin-service|build-plugin-host|prepare-plugin-runtime|before-pack-plugins|provider-(acp|codex|claude-code)|electron-builder|release\.yml/.test(path)) add('packaged-provider-startup');
    if (/plugin-recovery|plugin-service|DevelopmentView|before-pack-plugins|release\.yml/.test(path)) add('development-recovery');
    if (/conversation-(pruning|output|history-maintenance)/.test(path)) add('thread-history-pruning');
    if (/inbox|feed-categories/.test(path)) add('inbox-read-persistence');
    if (/plugins\/tasks\//.test(path)) add('tasks-bb-parity', 'mobile-tasks');
    if (/terminal|pty|runtime-host-environment/.test(path)) add('terminals', 'terminal-view-navigation');
    if (/monaco|editor|App\.tsx/.test(path)) add('thread-diff-workbench', 'renderer-resource-budget');
    if (/timeline|thread-store|renderer-resource-budget/.test(path)) add('renderer-resource-budget');
    if (/job-team|execution-routing|execution-service/.test(path)) add('job-team-launch-ui', 'cli-agent-job-team-run', 'modern-owner-job-team-run');
    if (/harness\/|(?:^|\/)pty\.ts$/.test(path)) add('job-team-launch-ui', 'cli-agent-job-team-run', 'modern-owner-job-team-run');
    if (/control-plane|control-client/.test(path)) add('plugin-authoring-live', 'job-team-launch-ui', 'cli-agent-job-team-run', 'modern-owner-job-team-run');
    // OBL-004: the native tool policy relay, hook route and runtime channel. 2.3.4 shipped
    // denying every Claude PTY tool call because no spec drove this path.
    if (/native-tool|harness\/(claude\/hooks|codex\/provider)|services\/mcp\/mcp-server|utility-entry|runtime-supervisor|fixtures\/plugins\/platform-hooks-probe/.test(path)) add('native-tool-policy-pty', 'platform-hooks-probe-fixture');
    // #421: StopFailure hook, resume service, wiring, IPC and the Settings section.
    if (/harness\/claude\/(hooks|interaction-hooks)|followups\/api-error-resume|api-error-resume-wiring|ipc\/api-error-resume|ApiErrorResumeSection/.test(path)) add('api-error-resume');
    // #416: a Squad engineer that stops on an API error is nudged, restarted, then handed to the user.
    if (/services\/execution\/(worker-api-error-recovery|service|store|projection)\.ts|squad-worker-restart|worker-api-error-recovery-wiring|api-error-resume-wiring|harness\/claude\/interaction-hooks|ExecutionJobDetails/.test(path)) add('job-team-api-error-recovery');
    if (/build-plugin-(app|server)\.ts/.test(path)) add('plugin-authoring-live');
    if (/plugins\/design-docs\/src\/server\/(sync-store|peer-protocol)|(?:^|\/)isolated-plugin-runtime|e2e\/fixtures\/peer-design-docs-worker/.test(path)) add('peer-data-boundary');
    if (/opencode/.test(path)) add('opencode-launch-boundary');
    if (/desktop-browser/.test(path)) add('desktop-browser-broker');
    if (/mobile-relay|mobile\/|mobile-/.test(path)) add('mobile-shell', 'mobile-relay-upload');
    if (/services\/scheduler\/|components\/scheduler\/|views\/scheduler\/|schedule-health|ipc\/scheduler\.ts|scheduler-resume-run/.test(path)) add('scheduler-self-healing', 'scheduler-overview', 'scheduler-detail', 'scheduler-cron', 'scheduler-resume-latest-run');
    if (/squad-proposal|squad-worktree-runtime|squad-session-lifecycle|SquadEditor|team-store|TeamComposer|register-teams-mcp-tool|InboxDetail|(?:^|\/)AgentLauncher\.tsx|ExecutionJobDetails|modern-team-launch-tools|ipc\/execution-board|services\/execution\/(store|projection|source-policy|source-registry)/.test(path)) add('squad-proposal-flow', 'job-team-launch-ui');
    if (/squad-proposal|squad-worktree-runtime|squad-session-lifecycle|SquadEditor|team-store|TeamComposer|register-teams-mcp-tool|InboxDetail|(?:^|\/)AgentLauncher\.tsx|ExecutionJobDetails|modern-team-launch-tools|ipc\/execution-board|services\/execution\/(store|projection|execution-mcp-tool)/.test(path)) add('squad-proposal-flow', 'squad-direct-report', 'job-team-launch-ui');
    // Owner report-back: the service, the MCP server that carries execution.start, and the notifier/report text.
    if (/services\/execution\/service\.ts|services\/mcp\/mcp-server|squad-proposals\/(notifier|report)/.test(path)) add('squad-direct-report');
    // Close with follow-up crosses the main/renderer seam: the summary, its failure reasons and the toast (#352).
    if (/followups\/(close-summary|wrap-up-close|session-summary-text)|lib\/close-idle-agents|claude-cli-provider|main-claude-binary|wrap-up-close-wiring|threads\/thread-wrap-up/.test(path)) add('close-with-follow-up-needs-you', 'close-with-follow-up-wrap-up');
    // #532: route timing seams. Back stalled for seconds, and a project window's route lock can loop.
    if (/apps\/app\/src\/(main\.tsx|lib\/split-layout\/|views\/thread-detail\/SplitThreadArea|hooks\/useRouteSync|lib\/app-navigate|components\/ProjectScopedNav)/.test(path)) add('project-back-navigation', 'app-routing', 'settings-search');
    if (/execution-source-picker|ipc\/execution-board|services\/execution\/source-registry|team-launch-support|TeamComposer|team-composer-sources/.test(path)) add('squad-source-retry');
    if (/scripts\/ci-|\.github\/(?:workflows\/ci\.yml|actions\/)/.test(path)) add('smoke');
  }
  return [...specs].sort();
}
