See the open issues and pull requests of your repositories inside ZCC. Hand one to an agent with one click.

## What you get

- A GitHub panel with Issues and Pull requests tabs across every tracked repository. It has a repository filter and a New issue form.
- Issue details: body, comments, a comment box, and editing of status, assignee, and labels.
- Send agent on an issue, or Review with agent on a pull request. ZCC starts a thread in the repository's project and links it from the item.
- Mentions. Type `@` or `#` in any composer to attach an issue or pull request. Its title, body, and state go to the agent at send time.
- Remote machines. Sessions on your other machines can use `git` and `gh` against github.com with your `gh` login, without signing in there.

## How it works

The plugin tracks every ZCC project whose checkout has a GitHub `origin` remote. Add more repositories in the Extra repositories setting as a comma-separated `owner/repo` list. Choose a Default project for repositories that are not attached to a project. A background service refreshes the cache at startup, then waits 15 minutes after each completed sync to reduce background GitHub traffic. Press Refresh in the panel to update now.

## Remote machines

With the Forward the GitHub CLI login to remote machines setting on (the default), every session on a non-primary machine gets a `GH_TOKEN` from this computer's `gh auth login`, and git uses it for github.com over HTTPS. The machine's own credential helpers for other hosts keep working. Two further settings are off by default: one also commits as your GitHub login and email (this replaces any `user.name` / `user.email` set on the machine), and one rewrites github.com SSH remotes to HTTPS for machines without a GitHub SSH key. The token is read with `gh auth token`, kept in memory only, and never saved to disk, settings, or logs. A `GH_TOKEN` you already set on a machine always wins, and sessions on this computer are never touched. The login is re-read about once a minute without ever delaying a launch; turning the setting off stops forwarding at once, and signing out of `gh` stops it within about a minute. Sessions that are already running keep the environment they started with.

## For agents

The `zcc github` command lists cached data. Use `zcc github repos`, `zcc github issues [owner/repo]`, `zcc github prs [owner/repo]`, or `zcc github sync`.

## Requirements

The GitHub CLI must be installed and signed in with `gh auth login`. See https://cli.github.com for installation. The plugin uses your `gh` session and stores no tokens. Until `gh auth status` passes, the plugin reports that it needs configuration.
