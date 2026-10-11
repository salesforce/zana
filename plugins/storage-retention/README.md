# Storage & retention

An opt-in plugin that shows what threads keep on each machine and cleans it up
under rules you set. Retention is off by default (both policies are Never), the
plugin is disabled until you enable it, and every other cleanup is an explicit
action with a confirmation. Open **Storage & retention** in the sidebar once it
is enabled.

## What it does

- **Machine storage.** A background scan measures the thread storage directory
  on each machine (active, archived and orphaned folders, the threads using the
  most space, free disk space) and caches the report. Reports are snapshots;
  rescan to see changes made outside ZCC. Reads never start scans.
- **Automatic retention.** Checked hourly, across all projects: archive threads
  with no activity for N days, and clear the stored files of threads archived
  for N days. Both default to Never. Per run it archives at most 50 and clears
  at most 200 threads.
- **Clear on archive.** Optional. Empties a thread's stored files about 30
  seconds after it is archived, so an undo still works. Pending work survives
  restarts and is retried every minute. It does not touch earlier archives.
- **Clean up.** From a machine page or `zcc storage`: delete large files (10 MB
  or more) from archived threads, clear all files of archived threads, remove
  orphaned folders, or clear one stopped thread's files. Large-file, archived
  and orphan cleanups run in the background and report progress per machine.
  Every cleanup stays available while a scan runs, and a scan that finishes
  afterwards leaves out entries cleared meanwhile.

Conversation history and uploaded attachments are never removed. "Clearing" a
thread empties its stored files; the thread itself stays.

## Safety

- Every deletion happens on the machine that owns the files and is confined by
  `realpath` to the thread storage root the plugin received from the host. It
  never follows a symlink out of the root and never removes the root itself.
- A folder is renamed into a trash location first and removed afterwards, so an
  interrupted run never leaves a half-deleted thread folder in place.
- Pinned threads are skipped by retention, bulk cleanups and the archive queue.
  Running threads (`starting`, `active`, `stopping`) are skipped everywhere.
  Clearing one named stopped thread works even when pinned, because the user
  asked for exactly that thread.
- Orphan removal is explicit only, never part of the hourly run, and only
  removes folders older than 10 minutes that no thread of this server owns. If
  another ZCC server shares the machine's data directory, its folders look
  orphaned to this one: do not run it there.
- Pinned state that cannot be read is treated as pinned. Stored policy that
  cannot be parsed falls back to Never. A server that cannot list all threads
  (more than 200,000) does nothing.
- Scans never use `du` or a child process: a bounded walker with entry caps and
  yields measures allocated bytes, and lower bounds are reported when a folder
  is too large to finish.
- Policy changes that act on more threads show a preview and need confirmation
  in the panel; `zcc storage retention` only previews unless `--save --yes`.

## Layout

| File | Role |
| --- | --- |
| `server.ts` | Registers the panel methods, schedules, listeners and CLI; validates every input and output. |
| `host.ts` | Machine-side scan and deletion through `experimental_defineHostEntry`. |
| `app.tsx` | The sidebar panel (overview, machine page, retention settings). |
| `src/policy.ts`, `src/service.ts` | Retention decisions and the hourly sweep. |
| `src/storage.ts` | Scan cache, cleanup jobs, archive queue, report assembly. |
| `src/host-storage.ts`, `src/disk-usage.ts` | Confined walker, deletion and disk measurement. |
| `src/cli.ts` | The `zcc storage` command. |

The server keeps its state in the plugin database (scan reports, archive queue,
cleared-thread records) and the plugin key-value store (policy, last run).

## RPC methods

`state`, `preview`, `configure`, `hosts`, `host`, `scanHost`, `scanAll`,
`startRemoveOrphans` / `removeOrphans`, `startClearLargeFiles` /
`clearLargeFiles`, `startClearArchivedFiles` / `clearArchivedFiles` and
`clearThread`. The `start*` forms return at once; the others wait for completion.
Inputs and outputs are validated by the plugin itself.

## Not included

Compared with the plugin this was ported from: no `~/.bb-dev` developer-data or
worktree cleanup (those are not ZCC concepts), no process stopping before
removal, no thread deletion (retention clears files and archives; it never
deletes a thread), no `du`-based scan, and no toasts (results appear inline).

## Development

```sh
env -u ZCC_DATA_DIR ./node_modules/.bin/vitest run plugins/storage-retention
./node_modules/.bin/tsc --noEmit -p tsconfig.json
```

Tests create and delete only inside fresh temporary directories.
