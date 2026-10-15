---
name: zcc-browser
description: Open web apps, localhost endpoints, and web previews in this thread's in-app browser side panel. Use when the user should see a page or watch interactive QA. Keep previews inside Zana unless the user explicitly requests an external browser.
---

# Visible web previews

## Remote conversations

If the host identifies a remote chat as the controlling surface, the user cannot see Zana's desktop panels or inline visualization UI. Do not follow the desktop presentation steps below. Return useful text through the configured conversation delivery tool; use a supported remote artifact or authenticated web-preview link only when available. Do not claim that a local file path, localhost URL, or desktop panel was shown to the remote user. Hidden browser automation and file creation for your own work remain available. A desktop handoff must be opened by the user in Zana.


Use the in-app browser side panel for web previews, including development servers.
Do not launch Chrome, Edge, the OS default browser, or `open` / `xdg-open` / `start`
unless the user explicitly requests an external browser. With computer-use tools,
select the in-app browser explicitly. Start dev servers with browser auto-open
disabled: omit `--open` and use `BROWSER=none` where supported.

The supported core interface is `zcc browser`. Read `zcc guide browser` for its
current contract. Legacy `browser_open`, `browser_snapshot`, `browser_click`,
`browser_type`, and `browser_eval` MCP tools have been retired; do not call them.

1. Use `zcc status --json` for `currentThreadId` and `zcc machine list --json`
   to identify the connected desktop host. Use the current thread/session scope.
2. List its desktop instances with `zcc browser instances --host <host-id> --json`.
   Use a returned instance ID and generation. If several windows could be the
   user's intended target, resolve that choice rather than guessing.
3. List existing tabs first and reuse an appropriate preview. Otherwise create
   a visible tab, using the actual IDs returned above:

```sh
zcc browser tabs --host <host-id> --instance <instance-id> --generation <generation> --thread <thread-id> --json
zcc browser create --host <host-id> --instance <instance-id> --generation <generation> --thread <thread-id> --url 'http://localhost:5173' --reveal --json
zcc browser reveal <tab-id> --host <host-id> --instance <instance-id> --generation <generation> --thread <thread-id> --json
```

Creating/revealing a tab only reveals it when its owning thread is focused; it
does not switch threads or bring the desktop window forward. Keep using that
tab while the dev server updates it. A localhost URL refers to the browser's
host, so a server on another host needs an explicitly reachable URL or tunnel.

For clicking, typing, snapshots, or scripted QA, use the Browser Automation
plugin's `browser-automation` skill with its desktop backend, or the available
in-app computer-use surface. Check `zcc plugin ls --json` for an enabled, running
`browser-automation` plugin before using its commands. Once available:

```sh
zcc browser-automation open --backend desktop --machine <host-id> --desktop <instance-id> --json
```

Retain the returned session ID and load the plugin's skill for its
inspect/act/verify workflow. Use `--tab <tab-id>` only for a user-requested
handoff of an existing tab and its login profile. If the plugin is missing,
installation through Plugins or `zcc plugin install builtin:browser-automation`
adds its commands and skill; enable it if disabled. Plugin installation uses
the normal host trust controls. New threads receive the updated skill catalog;
running threads keep their existing snapshot.

A simple visible URL preview through `zcc browser`
does not require installing that plugin. Headless automation is a separate
choice and does not open this side panel.

For a custom CDP integration, follow `zcc guide browser` to acquire a scoped
lease and write its connection to a private file. The client must run on the
browser host. With Playwright 1.60+, use
`chromium.connectOverCDP(wsEndpoint, { noDefaults: true })`, then the existing
default context's `pages()` or `newPage()`. Electron owns download and
presentation defaults; browser-wide settings and independent browser contexts
are unsupported. Keep the endpoint out of chat and shared ports, and release
the lease in cleanup.

If no desktop backend is available, explain the limitation and provide the URL.
Do not silently switch to an external browser. Leave a preview the user needs
open; release any automation lease when finished. Respect Stop/Take over.

For files, use `preview_file`. For your own web research, use the available
search/fetch tools.

## Phone or remote previews

When the user requests a phone or remote preview, start their dev server, then
in a Modern thread use `share_preview` with `action: "share"` and the port. The tool uses this
thread's execution machine. Return the private URL and its status; the user
signs in with the same Connect account. Requires Remote access and expires
after eight hours. `action: "stop"` removes this thread's share. Never share
ports automatically. Keep desktop Open in the in-app browser.
