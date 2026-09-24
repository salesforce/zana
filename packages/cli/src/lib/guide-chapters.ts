export interface GuideChapter {
  id: string;
  title: string;
  content: string;
}

export const GUIDE_CHAPTERS: readonly GuideChapter[] = [
  {
    id: 'overview',
    title: 'Overview',
    content: `zcc is the command-line interface to Zana Command Center.

Core concepts:

- Project — a registered repository. Threads belong to a project.
- Thread — a single agent conversation. The fundamental unit of work.
- Machine — an execution host (this laptop or an enrolled remote).
- Terminal — a persistent PTY, distinct from an agent thread.
- Plugin — in-process extension that can add a zcc verb, skills, and UI.

Prefer --json when command output will drive follow-up work.
Run zcc guide <chapter> for command details.

Chapters: threads, projects, machines, terminals, plugins, automations, agent-configuration, environments, browser.

Live control (attach to a running app, no Playwright): zcc thread spawn and zcc agent launch share @zana-ai/zcc-control. Operator launches are untagged. Flags: thread --provider --model --acp-mode --reasoning-level --permission-mode; agent --execution-state --model-level --role (XOR model-level) --wait. zcc agent wait|reply|stop drive a CLI Agent. zcc browser instances|tabs|create|acquire|connection|release|reveal|capture|close|import-sources share the same client (pnpm live:browser). zcc live cleanup --stale janitors tagged [zcc-live:<runId>] test sessions. See docs/control-sdk.md.
`
  },
  {
    id: 'threads',
    title: 'Threads',
    content: `zcc thread is the primary agent surface.

  zcc thread list [--project <id>]
  zcc thread spawn --project <id> --prompt "..." [--provider <id>] [--model <id>] [--acp-mode <mode>] [--reasoning-level <level>] [--permission-mode <mode>] [--wait]
  zcc thread show <id>
  zcc thread log <id>
  zcc thread tell <id> "..."
  zcc thread wait <id> [--timeout 20m] [--until turn|quiet]
  zcc thread background list|stop <id> [--force]
  zcc thread stop <id>
  zcc thread fork|archive|unarchive <id>
  zcc thread open <id> [--file PATH] [--source workspace|thread-storage] [--line N]
  zcc thread interactions <id>

Default wait (--until turn) returns on idle/error even if a background Bash
(npm run dev) is still running. Use --until quiet to wait until
activity.activeBackgroundCommandCount is 0.
zcc run and zcc agent send are deprecated aliases for spawn and tell.
Give spawned threads a clear objective, constraints, deliverable, and what to report back.
`
  },
  {
    id: 'projects',
    title: 'Projects',
    content: `  zcc project list
  zcc project show <id>
  zcc project create --path <absolute-path> [--host <id>]
  zcc project files <id> [--query <text>]
  zcc project content <id> <path>
  zcc project skills <id>
  zcc project processes list <id>
  zcc project processes kill <id> --pid <pid>

zcc projects ls remains as an alias of project list.
`
  },
  {
    id: 'machines',
    title: 'Machines',
    content: `  zcc machine list
  zcc machine show <id>
  zcc machine join-code
  zcc machine rename <id> <name>
  zcc machine remove <id>
  zcc machine provider-cli status|install <id> [provider]
`
  },
  {
    id: 'terminals',
    title: 'Terminals',
    content: `Use zcc terminal for long-running PTYs (dev servers, watches). Use zcc thread for agents.

  zcc terminal list [--project <id>]
  zcc terminal create --project <id> [--title ...] [--command ...]
  zcc terminal show|output|wait <id>
  zcc terminal send <id> --text "..."
  zcc terminal close <id>

Prefer --command for long-lived servers you may inspect or stop. A thread that
"starts the app" usually leaves a background Bash instead; detect with
zcc thread show --json (activity) or zcc thread background list.
zcc term is a deprecated alias.
`
  },
  {
    id: 'plugins',
    title: 'Plugins',
    content: `  zcc plugin new <name> [--app]
  zcc plugin install <source>
  zcc plugin list|dev|reload|logs|run ...
  zcc plugin dev --once        One rebuild + reload; nonzero on failure
  zcc marketplace ls|add|refresh|remove

plugin reload and plugin dev use product HTTP (ZCC_SERVER_URL) and do not need the control socket.
Contributed verbs appear as zcc <name> and in the generated plugin-commands skill.
Core command names always win. Combined plugin output is capped at 1MiB.
Writing a plugin? Use the zcc-plugin-authoring skill.
New scaffolds include AGENTS.md and LIVE_TEST.md. Open the plugin in running ZCC,
exercise its primary action, and observe a source edit after reload. Backend health
is checked by reload/dev; a successful command does not verify the rendered UI.
`
  },
  {
    id: 'automations',
    title: 'Automations',
    content: `Schedules are still listed and toggled with:

  zcc schedule ls
  zcc schedule run-now <id>
  zcc schedule enable|disable <id>
  zcc team launch --team <id> --project <id> --goal "..." [--mode structured|freeform] [--wait]
  zcc team status|wait|answer|stop <id>
  zcc team ls

  Prefer these CLI verbs over writing JSON into ~/.zcc/schedules. The zcc-center skill is a file-format appendix only.
`
  },
  {
    id: 'agent-configuration',
    title: 'Agent configuration',
    content: `Inside a Zana agent terminal the app sets ZCC_SESSION_ID. Mutating live ops then return FORBIDDEN_AGENT (exit 5), except a host-stamped orchestrator which may spawn and close workers.

  zcc skill list
  zcc skill show <id>
  zcc skill install-cli-skills
  zcc skill cli-skills-status

  zcc settings show
  zcc settings general injectProductGuidance false
  zcc settings general injectBundledSkills false
  zcc settings general disabledBundledSkills '["zcc-cli"]'

install-cli-skills copies the zcc-cli skill onto each machine's ~/.claude/skills and ~/.agents/skills so agents outside ZCC can drive the CLI.
Settings writes apply to subsequent launches only.
`
  },
  {
    id: 'environments',
    title: 'Environments',
    content: `Inspect an existing environment (checkout or worktree) by id:

  zcc environment status <id>
  zcc environment diff <id>
  zcc environment diff-files <id>
  zcc environment pull-request <id>
  zcc environment processes list <id>
  zcc environment processes kill <id> --pid <pid>
`
  },
  {
    id: 'browser',
    title: 'Browser',
    content: `zcc browser is the experimental core API for automation integrations controlling ZCC desktop tabs. The Browser Automation plugin adds its own script/session commands; another plugin can use the same core connection independently.

Start with \`zcc browser instances --host <host-id> --json\`. For every tab/control operation provide \`--host <host-id> --instance <instance-id> --generation <generation> --thread <thread-id>\`. The browser host can differ from the agent host. Never infer an active desktop window.

- \`tabs\`: list native tabs and their control state.
- \`create [--url <http(s)-url>] [--reveal]\`: create a tab with a separate automation profile. Defaults: hidden, about:blank.
- \`acquire <tab-ids...> --controller <label> [--ttl-ms <ms>] [--allow-personal]\`: acquire exclusive tab control. If the owning thread is already focused, open the side panel and select the first tab. Default expiry is five minutes, maximum thirty minutes. Personal tabs require the explicit handoff flag.
- \`connection <lease-id> --output <new-file>\`: write private connection JSON with mode 0600 on the CLI host. The loopback WebSocket endpoint is usable only on the browser host. Pass it privately to an integration worker; never expose it through a shared port or chat output.
- \`release <lease-id>\`: revoke automation while keeping tabs open.
- \`reveal <tab-id>\`: open the side panel and select the existing native tab only if its thread is already focused.
- \`capture <tab-id> --output <new-file>\`: save a bounded JPEG to the CLI host without focusing the tab.
- \`close <tab-id>\`: explicitly close that native tab.
- \`watch\`: print changed tab snapshots every two seconds until interrupted.

Cookie import copies signed-in sessions from a browser installed on the desktop host into a ZCC browser profile. These two commands take \`--host\`, \`--instance\`, and \`--generation\` but no \`--thread\`:

- \`import-sources\`: list importable browsers (Chrome, Chromium, Edge, Brave, Vivaldi, Opera, Arc, Firefox, Safari).
- \`import-cookies --from <source-id> --profile <directory> [--into personal|automation:<profile-id>]\`: copy that profile's cookies into the personal ZCC browser (default) or a named automation profile.

All commands support JSON output. In plugin code use \`zcc.sdk.experimental_desktopBrowsers\`. Stop/Take over revokes native control; stopping the owning thread also releases its server control leases.

Use \`zcc file read <path> --host <id> [--root <path>] --json\` to fetch screenshots and other files from the browser host.

Cloud browsers are not supported. Headless Chrome on an enrolled host belongs to the Browser Automation plugin.
`
  }
];

export function renderGuide(chapter?: string): { id: string; title: string; content: string } {
  if (!chapter) {
    const overview = GUIDE_CHAPTERS.find((row) => row.id === 'overview')!;
    return overview;
  }
  const match = GUIDE_CHAPTERS.find((row) => row.id === chapter || row.id === chapter.replace(/_/g, '-'));
  if (!match) {
    const known = GUIDE_CHAPTERS.map((row) => row.id).join(', ');
    return {
      id: 'unknown',
      title: 'Unknown chapter',
      content: `Unknown guide chapter '${chapter}'. Try: ${known}\n`
    };
  }
  return match;
}
