---
name: browser-automation
description: Control Zana's side-panel browser through the Browser Automation plugin, or explicitly use a local headless session. Use for persistent browser navigation, snapshots, clicking, forms, scripted QA, and verification screenshots.
---

Use `zcc browser-automation`. Open one session, retain its session ID, then inspect,
act, and verify in short scripts.

`browser.getPage("main")` reuses the session's initial tab. Keep the same session
and page names across scripts, screenshots, and retries. Request another named
page or `browser.newPage()` only when a separate page is needed, and close it
when finished. Stop/Take over keeps the pages for manual use; close disposes
session-owned tabs and preserves handed-off tabs.

For a user-visible browser task, use the desktop backend. Headless sessions are
an explicit choice. `--machine` accepts an exact host ID or a unique machine
name (quote names with spaces). Exact IDs take precedence; unknown or ambiguous
names fail before opening a session.

Choose `--backend local --headless --machine <host-id>` for headless Chrome on
an enrolled host. Choose `--backend desktop --machine <host-id> --desktop
<instance-id>` for a new dedicated desktop automation tab. Starting desktop
control opens the side panel and selects the browser tab when its thread is
focused, or the next time the user opens that thread. New or activated controller pages follow the same rule;
automation does not switch threads or bring the desktop window forward. Headless sessions remain headless.
Plugin-owned local/headless Chrome launches with `--no-sandbox`, disabling Chrome's
sandbox. Desktop attachment does not change the browser's launch flags.
Resolve the explicit instance with `zcc browser instances --host <host-id> --json`
first. Never silently choose a different host, mode, or login profile.
Adding `--tab <tab-id>` hands off an existing tab and its profile's logged-in
authority; do so only when the user asked to use that tab. The CLI uses the
current thread, or `--thread <id>` outside a thread. Each session belongs to
that thread.

CLI opening:

```sh
zcc browser-automation open --backend local --headless --machine <host-id> --json
zcc browser-automation open --backend desktop --machine <host-id> --desktop <instance-id> --json
```

Run scripts:

```sh
zcc browser-automation run <session-id> --script 'const p = await browser.getPage("main"); await p.goto("https://example.com"); await p.snapshot()' --json
zcc browser-automation run <session-id> --script 'const p = await browser.getPage("main"); await p.click("ref/e6"); await p.snapshot()' --json
zcc browser-automation screenshot <session-id> --page main --json
zcc browser-automation run <session-id> --script-file ./check.js --script-host <source-host-id> --timeout-ms 90000 --json
```

Take a fresh snapshot before using refs after navigation or document changes.
Use refs from that session's DevBrowser snapshot. Do not mix agent-browser refs
or invent selectors. Prefer a cheap URL/text/snapshot check after each action;
request a screenshot when visual verification matters. Use
`await p.shot({type:"jpeg",maxEdge:960,quality:70}); undefined` inside scripts to
return a bounded JPEG file.

A run may return at most four screenshots, JPEG only, 500 KB combined. A larger
or differently encoded capture fails the run. Reduce the size or number of
captures rather than retrying the same script unchanged.

`run` and `screenshot` return JSON with `hostId` and `images`, where each image
has `path`, `mimeType`, `width`, and `height`. The path is in the browser session's
temporary directory on that host. Use your image-reading tool on the path when
you are on the same machine. If the browser host differs, fetch the image to
local temporary storage first (substitute the returned path and host ID):

```sh
zcc file read '<image-path>' --host '<host-id>' --json | node -e '
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const file = JSON.parse(fs.readFileSync(0, "utf8"));
if (file.contentEncoding !== "base64") throw new Error("Expected binary image");
const destination = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "browser-image-")), "capture.jpg");
fs.writeFileSync(destination, Buffer.from(file.content, "base64"), {mode: 0o600});
console.log(destination);
'
```

Read the printed local path with your image-reading tool. Do not print base64
image bytes into the conversation. Read or copy captures before closing the
session: cleanup removes its temporary directory. Remove local copies when
finished.

A local headless `open` returns a `previewDirective`, for example
`::browser-preview{session="<session-id>"}`. Copy it into your next message
exactly once as a standalone line, before you continue working. Do not wrap it
in backticks or a code fence, and do not invent or edit the session ID. ZCC
renders it as a live view of that browser in the chat, which the user can
expand, so they can watch while you work. Desktop sessions return no directive;
that browser is already visible in the side panel. `zcc browser-automation
preview <session-id> --json` reports the live frame's `url`, `title`, size, and
`sequence` without image bytes; it is not a substitute for `screenshot` when you
need to see the page.

`pages` lists persistent pages. Runs serialize within a session. Scripts are
trusted JavaScript with Puppeteer-style DevBrowser APIs, not a sandbox.
`--script-file` requires `--script-host <host-id>` naming the source host explicitly.
Relative script paths resolve against the invoking CLI's working directory;
the script is transferred to the browser host. Browser file operations and
`localhost` refer to the browser host. Transfer files explicitly.

Stop cancels running and queued work and releases desktop control. Cancellation
and timeout stop the session too; open a new session to resume. Close disposes
owned Chrome and plugin-created desktop tabs while preserving handed-off tabs.
Close sessions after use. Five-minute idle and thirty-minute absolute expiry
apply. Timeouts default to 30 seconds, maximum 120 seconds. Use
`--timeout-ms <1000-120000>` or `--timeout <duration>` (`90s`, `2m`, `1500ms`).
Bare `--timeout` values mean seconds (1–120) or milliseconds (1000–120000).

If a session stopped or expired, open a new one and take a fresh snapshot;
session IDs and refs from the old session cannot resume it. Respect Stop/Take
over: do not reacquire control to continue work the user stopped. Use
`zcc browser-automation list --json` to inspect this thread's sessions, and
`zcc browser-automation close <session-id> --json` when finished. `--help` lists
commands and their supported flags. With `--json`, request failures return
`{ "ok": false, "error": { "code": "…", "message": "…", "hint": "…" } }`
on stdout and a nonzero exit code; stderr also carries the message. The hint is
optional. `session_unavailable` means reopen; `screenshot_limit` means reduce
the capture size or number.

Script results instead contain `text`, `images`, and `exitCode`. Check
`exitCode` before treating a run as successful; a timeout stops the session.

An unavailable backend or a failed runtime install is an actionable setup
error, not permission to attach to a random browser. The first open on a host
installs the pinned `dev-browser` npm release into plugin-owned host storage
there and verifies its provenance and digest; it needs npm, network access, and
Chrome on that host, and can take a minute. Later opens reuse the verified
install offline. The exact pin and Chrome setup are documented in the plugin
README. Cloud browsers and arbitrary CDP endpoints are unsupported by this
plugin. For a custom CDP integration, use the scoped core connection described
by `zcc guide browser`; keep its private endpoint out of chat and shared ports.
