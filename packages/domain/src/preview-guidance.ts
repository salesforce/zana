const UI_PROPOSAL_GUIDANCE = 'When building or substantially changing user-facing features in Zana Command Center or any Zana plugin, proactively show a realistic, clickable UI proposal early, with meaningful alternatives or a Current / Proposed comparison where useful. Use the `zana-ui-proposals` skill when available; do not wait for an explicit mockup request. Keep trivial fixes lightweight, honor explicit requests to implement directly, and continue within existing authorization without adding an automatic approval gate.';

/** Shared by Modern session tooling and CLI Agent launch guidance. */
export const IN_APP_PREVIEW_GUIDANCE = [
  'These desktop presentation instructions apply only when the user is interacting in Zana. If this conversation is controlled through a remote chat, do not open or reveal desktop panels; return results through that conversation. Background browsing and execution remain available. Never treat a localhost URL or a local file path as a remotely viewable result.',
  'When the user asks you to open, show, or preview a file, call `preview_file`.',
  "That opens this thread's right-hand preview tab.",
  'Do not open files in Cursor, VS Code, or via `open` / `cursor` / `code` CLI.',
  'When showing a web app, dev server, localhost endpoint, or other web preview, use this thread\'s in-app browser side panel by default.',
  'Read `zcc guide browser` for the supported commands; discover the desktop instance, then use `zcc browser create` with `--url` and `--reveal`, or reveal an existing tab.',
  'With computer-use tools, select the in-app browser explicitly.',
  'Do not launch Chrome, Edge, the OS default browser, or `open` / `xdg-open` / `start` for a preview unless the user explicitly requests an external browser.',
  'Start dev servers with automatic browser opening disabled (omit --open; use BROWSER=none when supported).',
  'If in-app browsing is unavailable, explain the limitation and provide the URL instead of silently opening an external browser.',
  UI_PROPOSAL_GUIDANCE
].join(' ');

/** Replaces desktop guidance for a host-identified remote conversation. */
export function remotePreviewGuidance(label: string): string {
  return `The user is interacting through ${label} and cannot see Zana's desktop side panels. Do not call preview_file, run_in_terminal, browser reveal, or desktop UI/navigation tools to present results. Do not open an external browser as a fallback. Background file operations, commands and hidden browser automation remain available. Deliver useful text and supported artifacts through the conversation's configured delivery tool. Explain when sharing or a requested surface is unavailable. A local path, localhost URL, saved Library document or Inbox notification alone is not delivery to this user. For a requested remote web preview, use share_preview when available and explain its sign-in requirement. Start dev servers with automatic browser opening disabled. Structured questions and permissions may still require Zana; do not claim they can be answered remotely unless a supported adapter is available. A desktop handoff must be opened by the user in Zana. ${UI_PROPOSAL_GUIDANCE}`;
}
