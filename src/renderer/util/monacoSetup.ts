import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker.js?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker.js?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker.js?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker.js?worker';

/**
 * Shared, side-effecting Monaco bootstrap. Importing this module (from ANY
 * monaco surface — the Explorer, the Library, or the modal's DiffViewer) wires
 * up two things exactly once, module-load time:
 *
 *   1. `MonacoEnvironment.getWorker` — bundle the workers locally via Vite's
 *      `?worker` imports instead of letting the React wrapper fetch them from
 *      jsDelivr (Electron's CSP blocks the remote fetch and leaves the editor
 *      stuck on "Loading…").
 *   2. `loader.config({ monaco })` — point `@monaco-editor/react` at the same
 *      bundled instance.
 *
 * WHY THIS IS SHARED: the DIFF worker computes the line-level diff that both the
 * side-by-side rendering AND `hideUnchangedRegions` folding depend on. It used
 * to be set up only inside `ExplorerView`/`LibraryView` (both lazy-loaded), so a
 * `DiffViewer` mounted from the agent modal's Changes tab — reachable WITHOUT
 * ever opening the Explorer — ran with no worker configured: Monaco couldn't
 * compute the diff, so it showed both files in full with no changed chunks and
 * nothing to collapse. Centralizing the bootstrap here and importing it from
 * `DiffViewer` guarantees the worker exists wherever a diff is shown.
 */
(self as unknown as { MonacoEnvironment?: unknown }).MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  }
};
loader.config({ monaco });
