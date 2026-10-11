Find out what your threads keep on each machine, and let ZCC clean up old thread files when you ask it to. Everything is off until you turn it on.

## What you get

- A per-machine report of how much space thread storage uses, split into active threads, archived threads and orphaned folders, with the threads using the most space.
- Automatic retention: archive threads that have been inactive for a while, and clear the stored files of threads that have been archived for a while. Both default to Never and are checked hourly.
- An option to clear a thread's stored files shortly after you archive it, once an undo is no longer possible.
- One-click cleanups that each ask first: delete large files from archived threads, clear all files of archived threads, remove orphaned folders, or clear one thread's files.
- The `zcc storage` command and a skill, so an agent can run the same reports and cleanups when you ask.

## How it works

The plugin measures thread storage on each machine and keeps the last report. Cleanups only act on what that scan found and re-check every folder before removing it. Pinned threads, running threads, conversation history and uploaded attachments are never removed by retention. Deleted files are gone for good.

## Settings

- `Archive inactive threads`: Never, or after a chosen number of days without activity.
- `Clear files of archived threads`: Never, or after a thread has been archived a chosen number of days.
- `Clear files when a thread is archived`: off by default.
- Changes that act on more threads show a preview and ask you to confirm before saving.

## CLI

- `zcc storage usage [--machine <id>] [--rescan]`: read the cached report or start a scan.
- `zcc storage retention [--archive-after <days|never>] [--clear-after <days|never>] [--clear-on-archive <true|false>] [--save --yes]`: preview or save the policy.
- `zcc storage clear-large-files | clear-archived-files | remove-orphans --yes [--machine <id>] [--background]`: run a cleanup.
- `zcc storage clear-thread --thread <id> --yes`: clear one stopped thread's files.
