Anonymous usage analytics for Zana. The plugin records agent activity only. It never sends prompts, replies, file paths, or titles.

## What you get

- A master switch to turn analytics on or off.
- Optional click and page-view tracking that records button ids and section names only.
- A place to point events at your own PostHog project instead of Zana's.

## How it works

When analytics is on, ZCC sends event names such as thread created, idle, or failed, plus a random install id stored on this machine. You can turn the plugin off at any time.

## Requirements

Official builds include a Zana PostHog project key. A local checkout sends nothing until you add a key in Settings, or you can leave the plugin off.
