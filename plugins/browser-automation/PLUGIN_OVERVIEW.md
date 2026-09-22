Run persistent browser scripts from a thread on the desktop app or an enrolled host.

## What you get

- Thread-owned desktop browser sessions (DevBrowser) and local headless sessions.
- Capture, cookie import into the automation partition, and CDP access for the leased page.
- A live inline preview of local headless sessions that expands into a lightbox.
- The `zcc browser` command for the same lifecycle.

## How it works

ZCC leases an in-app browser or a headless session bound to the thread. Personal signed-in profiles are not copied unless you opt in. Cookie values never appear in HTTP JSON.

## Requirements

Desktop BrowserView support for in-app sessions. Isolated product-server launches cannot drive the desktop browser.
