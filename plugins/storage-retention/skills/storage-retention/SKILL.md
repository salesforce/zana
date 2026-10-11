---
name: storage-retention
description: Inspect machine storage, clear files of archived threads, and configure automatic thread archiving and clearing with the Storage & retention ZCC plugin.
---

# Storage & retention

Enable the plugin in the Plugins hub first. Both retention policies default to
Never and nothing is archived or cleared until a person turns a policy on or
confirms a cleanup. Open the plugin's sidebar panel for machine reports and
retention settings. Every command prints JSON.

```sh
zcc storage retention
zcc storage retention --archive-after 30 --clear-after 90
zcc storage retention --archive-after 30 --clear-after 90 --save --yes
zcc storage retention --archive-after never --clear-after never --save --yes
zcc storage retention --clear-on-archive true --save --yes
zcc storage retention --clear-on-archive false --save --yes
zcc storage usage
zcc storage usage --rescan
zcc storage usage --machine HOST_ID --rescan
zcc storage usage --machine HOST_ID
zcc storage clear-large-files --yes
zcc storage clear-large-files --machine HOST_ID --yes
zcc storage clear-archived-files --machine HOST_ID --yes
zcc storage remove-orphans --machine HOST_ID --yes
zcc storage clear-thread --thread THREAD_ID --yes
```

Add `--background` to `clear-large-files`, `clear-archived-files` or
`remove-orphans` to start the job and return at once. Read its progress from
`largeFileCleanup`, `archivedFileCleanup` or `maintenance` in `zcc storage usage`.

## Retention

Without `--save`, thresholds only preview how many threads would be affected.
Days are whole numbers from 1 to 3650, or `never`. Unspecified settings keep
their saved values. The policy applies across all projects and is checked hourly.

- **Archive after**: archives threads with no activity for that long.
- **Clear after**: empties the stored files of threads that have been archived
  that long. The thread and its conversation stay.
- **Clear on archive**: empties a thread's stored files about 30 seconds after
  it is archived, so an undo still works. It does not touch threads archived
  earlier. Pending work survives a restart and is retried every minute.

Pinned threads are never archived or cleared by any of these. Conversation
history and uploaded attachments are never removed. Preview first and save only
when the user has authorized it.

## Cleanup

Scans run in the background and cache a report per machine. Reads never start a
scan: run `zcc storage usage --rescan`, then rerun `zcc storage usage` to read
the result. Reports are snapshots, so rescan to see changes made outside ZCC.
Every cleanup command needs a completed scan of its machine and stays available
while a new scan runs; a finished scan leaves out entries cleared meanwhile.

- `clear-large-files` deletes individual files of 10 MB or more from the thread
  storage of archived threads and keeps smaller files. Without `--machine` it
  covers every scanned machine.
- `clear-archived-files` empties the storage of every archived, stopped,
  unpinned thread on the machine, including small files.
- `remove-orphans` removes storage folders that no thread of this server owns
  and that are older than 10 minutes. Run it only when no other ZCC server
  shares that machine's data directory.
- `clear-thread` empties one stopped thread's storage. It also works for a
  pinned thread because the user named it, and refuses a running thread.

Archived threads are skipped while they are running or pinned. Everything
deleted is permanent. Each command refuses to run without `--yes`; do not pass
it on the user's behalf unless they asked for that cleanup.
