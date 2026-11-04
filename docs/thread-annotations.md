# Thread annotations and browser annotation plugins

Select text within one assistant reply and choose **Annotate**. Add a short change, or choose **Keep this** / **Remove this**. **Add quote** attaches the passage without a comment. The composer holds a compact reference: inspect it to edit the comment, convert it to text, remove it, or return to its source message. Multiple references can be sent together. Sent history records the original passage and comment, independently of subsequent source or draft edits.

Thread sources carry a thread id, message id and source sequence. The shared context parser validates sources and comment limits, and exact serialized offsets guard sent-message badge rendering. A reference is a snapshot, never an instruction to fetch a path. Count and aggregate text limits also include comments.

## Browser plugin seam

`app.slots.experimental_browserToolbarAction` mounts a plugin component in each thread browser toolbar. Props contain the tab URL, an optional desktop page API, and a composer scoped to the same thread. `page.evaluate(expression, {world})` runs a bounded expression in an isolated world by default; `main` supports best-effort framework inspection. Inside an expression, `bridge.postMessage(data)` emits bounded untrusted page data. `page.onMessage` subscriptions are filtered by native tab and thread.

Main derives the owner from IPC's sender window, validates the complete request, looks up an existing tab in that window/thread, and refuses controlled tabs. It does not create a tab or grant filesystem access. Evaluation/result sizes, time, concurrency and message rate are bounded. The console bridge subscribes once per native page and releases on destruction.

The scoped composer adapter can insert a plugin-owned reference, update/remove references by that plugin's resource id, subscribe to accepted send/queue, and focus the owning composer. A plugin cannot overwrite another plugin's reference through this adapter. Failed submissions do not emit accepted-send events. Sent history stays immutable when page pins are edited.

The Agent Annotations port is an independently installed local plugin, outside core. Its upstream overlay/capture code and MIT notice are retained. Core contains generic registration, page and composer adapters only.

## Verification

- `pnpm exec vitest run apps/app/src/components/thread/ThreadAnnotationSelection.test.tsx apps/app/src/plugins/PluginBrowserToolbarActions.test.tsx apps/desktop/src/desktop-browser-page.test.ts apps/desktop/src/desktop-browser-main-ipc.test.ts`
- `pnpm test:e2e -- e2e/thread-annotations.spec.ts` verifies the thread flow. Set `ZCC_ANNOTATIONS_PLUGIN_SOURCE` to an independent plugin source directory to include the complete native browser plugin flow. The fixture installs a copy in its isolated HOME.
- `pnpm live:browser` checks the attached app's existing browser contract; set `ZCC_SERVER_URL` when both production and development instances run.
