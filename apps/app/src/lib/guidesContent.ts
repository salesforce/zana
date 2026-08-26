/**
 * Markdown content for the Home dashboard's Guides card (see HomePanel.tsx /
 * GuideModal.tsx). Each entry is a short, task-oriented article — not
 * exhaustive reference docs — meant to get someone doing the thing in a
 * couple of minutes. Keyed by the same `id` HomePanel's `GUIDE_ITEMS` use.
 */
export const GUIDE_CONTENT: Record<string, string> = {
  'create-extension': `
A plugin is your own panel or tool, running inside Zana.

## 1. Seed a thread

Click **Plugins → New plugin** (or **Browse → Create a plugin**, or the composer
**Plugin** button). That inserts the same prompt: *Create a new zcc plugin that …*
Send it from the current project — not a dedicated Extensions folder.

## 2. Scaffold, install, iterate

The agent loads the plugin-authoring skill and runs:

\`\`\`
zcc plugin new hello --app
cd zcc-plugin-hello
zcc plugin install .
zcc plugin dev
\`\`\`

Edits to \`server.ts\` reload from source. App changes remount live. Use
\`zcc plugin list\` and \`zcc plugin logs <id> -f\` to verify.

## 3. Install from source (not create)

**Install from folder / repository** and **Open existing plugin** stay in the
hub overflow menu. Those install an existing tree; they never start a create
thread.

A failed reload keeps the last good generation running. Plugins are full-trust
in-process on the server after install.

## Where things live

- New plugins: \`./zcc-plugin-<id>\` inside the project you authored from.
- Already-local leftovers: \`~/zcc-workspace/extensions/<id>\`.
- \`package.json\` → \`zcc\` is the manifest (name, app/server entries, skills, MCP).
`,
  scheduler: `
The Scheduler runs an agent on a recurring cadence — a nightly report, a
weekly dependency check, anything you'd otherwise remember to kick off by
hand.

## 1. Create a schedule

Open **Scheduler** and click **New schedule**. You'll pick:

- **Project** — where the agent runs (or leave it global for a
  cross-project task).
- **Prompt** — what to tell the agent each run.
- **Cadence** — interval (every N hours/days) or a specific time of day.
- **Profile** — which harness/persona launches it.

## 2. Where results land

Every run's outcome — success, failure, or a question the agent couldn't
resolve — shows up in your **Inbox**, so you don't have to babysit the
Scheduler tab to know what happened.

## 3. Templates & groups

**New schedule → From template** pre-fills common shapes (a status digest, a
changelog scan). Group related schedules together from the schedule's edit
dialog — the Scheduler tab lets you filter by group.

## 4. Pausing / editing

Toggle a schedule off without deleting it, or edit its prompt/cadence at any
time — the next run picks up the change.
`,
  personas: `
A persona is a reusable agent identity: role, model, permission mode, system
prompt, and tool access, bundled so you don't re-type it every time.

## 1. Create a persona

Open **Personas** and click **＋**. Give it:

- **Name & role** — what this persona is for ("Code reviewer", "Release
  notes writer").
- **Model** — which model it launches with.
- **System prompt** — the instructions that shape every session it starts.
- **Tools / permission mode** — what it's allowed to touch.

## 2. Launch with it

Pick the persona when starting a new agent (Quick Agent, a project tab, or a
Scheduler run) — its model/prompt/tools apply automatically instead of the
profile defaults.

## 3. Teams

Related personas can be grouped into a **Squad** — a small team that works
together on a task, each member with its own role. See **Squads** to set one
up once you have a couple of personas you'd reuse together.
`,
  shortcuts: `
Zana is built to be driven from the keyboard once you know the
handful of shortcuts that matter most day to day.

## Getting around

- **⌘P** — command palette / project switcher.
- **⌘⇧1…9** — jump straight to project 1–9; **⌘⇧]/[** to step through them.
- **⌘I** — toggle the Inbox. **⌘J** — toggle the Scheduler. **⌘,** — Settings.
- **⌘O** — toggle the workspaces Overview.

## Tabs & terminals

- **⌘T** — new tab with the project's default profile.
- **⌘1…9**, **⌘]/[** — switch tabs.
- **⌘W** — hide the active tab (process keeps running); **⌘⇧W** — actually
  terminate it.
- **⌘F** — find in the active terminal; **⌘K** — clear scrollback.

## Full list

Press **⌘?** any time (or open it from this Guides card) for the complete
reference, including Explorer and tab-context-menu actions.
`,
  walkthrough: `
The first-run walkthrough is a three-step tour of the core loop: launching an
agent, adding a project, and creating a schedule.

It auto-opens once for a new install, then never again unless you re-open
it — from here, or from **Settings → General → Replay walkthrough**.

Each step moves the app to the real view it's talking about and points at
the control to use, so you're looking at the actual UI rather than a
screenshot.

Use **Back**/**Next** to move between steps, or **Skip**/**Esc** to close it
at any point — closing (by finishing or skipping) marks it done so it won't
pop up again on its own.
`
};
