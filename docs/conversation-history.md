# Conversation history

Open **History** in the sidebar, either across projects or inside one project.

Both tabs use the same list-and-preview layout. Select an entry to read saved messages without leaving history or starting a process. Every entry shows the harness icon and name alongside a folder icon and project name beneath its title, with the date on a separate line. Both transcript previews repeat that context above their actions, which stay visible while messages scroll. Hover for **Harness** and **Project** labels, or use the **Project** filter to narrow the list. Project and search filters carry across tabs; Refresh stays in the same position.

- **Threads** includes archived and unarchived conversations. Search titles and saved messages, preview a conversation, then **Open conversation** for its full timeline or **Restore conversation** to continue an archived thread. A destroyed environment remains readable but cannot be restored. Previews use the latest 20 timeline segments, omit tool payloads and delegated threads, and label shortened history.
- **CLI Agents** lists local Claude, Codex and OpenCode conversations belonging to registered projects. Search titles, read a text preview, then resume the exact saved provider session in its original project. Other providers and remote CLI history are not supported yet.
- The CLI launcher keeps eight recent conversations and links to **Browse all history**.

Closing a tab does not erase its native transcript. History is reconstructed from the thread database and provider stores, so it survives application restarts. The application does not invent a fresh conversation when a selected native session is missing: it reports the problem.

## Persistence and scope

Thread history reads `threads` and `thread_events` from the product database through `GET /api/v1/threads/history`. Hidden automation threads are excluded. Pages contain 40 rows; title/message search is parameterized and treats SQL wildcard characters literally. Restore uses the existing unarchive endpoint and rejects destroyed environments.

Desktop CLI history uses window-owned, expiring snapshots. Rows expose opaque handles. Main resolves the original registered project and canonical path again before preview or launch. Provider-native IDs and filesystem paths are never accepted from the renderer. Preview/resume revalidates the native transcript's project membership.

Claude JSONL files and Codex rollout JSONL files remain the source of truth. `conversation-index.json` in the app data directory is a metadata-only cache, written atomically and serialized; it contains no transcript bodies. It is capped at 10,000 entries, scans use bounded reads and concurrency, and a corrupt cache can be rebuilt. Codex human-input events avoid using injected context as conversation titles. OpenCode uses its native SQLite database read-only through the runtime-specific SQLite binding.

Each snapshot expires after ten minutes. Global scans cover up to 64 registered local projects and retain the newest 10,000 collected rows; selecting a project scopes the scan directly. An unreadable project does not hide the results from other projects. Previews are limited to 500 text messages, 64,000 characters per message and roughly one million characters total; JSONL reads additionally stop at 4 MiB. The UI labels shortened previews. Tool payloads and system messages are omitted.

## Verification

Focused tests cover filters, pagination, stale responses, restored navigation, transcript parsing, missing/cross-project sessions, native-store symlinks, cache reconstruction, reader failures, and exact resume validation. `e2e/conversation-history.spec.ts` runs against built Electron with an isolated HOME. It checks archived-thread search/read/restore/follow-up, large native previews, app restart and exact Codex resume arguments. The fixture disables bundled skill injection so it exercises history independently of skill catalog changes.

Run the live mode/reasoning suite followed by live Memory retrieval for changes affecting launch/resume, as required by `AGENTS.md`. OpenCode launch changes also require its deterministic launch-boundary spec and live agent-picker check. These attach checks require the appropriate running app, plugins and native harness configuration; a preflight return is not successful verification.
