import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
// Package exports map `monaco-editor/*.js` onto the editor's ESM tree. Do not
// import the `esm/vs` subtree by package path — that needs a filesystem alias,
// which then bypasses optimizeDeps.exclude and Vite 8 prebundles workers with
// no default.
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker';
import CssWorker from 'monaco-editor/language/css/css.worker.js?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker.js?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';

/**
 * Shared, side-effecting Monaco bootstrap. Importing this module (from ANY
 * monaco surface — the Explorer, the Library, or the modal's DiffViewer) wires
 * up two things exactly once, module-load time:
 *
 *   1. `MonacoEnvironment.getWorker` — same-origin bundled workers instead of
 *      the React wrapper's jsDelivr fetch (Electron CSP blocks that and leaves
 *      the editor stuck on "Loading…").
 *   2. `loader.config({ monaco })` — point `@monaco-editor/react` at the same
 *      bundled instance.
 *
 * Workers are ESM side-effect scripts (no `export default`). Vite's `?worker`
 * constructor is the right bundler form **when the importer lives under the
 * renderer root** (`src/renderer`). Docs UI used to live in `plugins/docs`,
 * which Vite serves as `/@fs/` and then prebundles into `.vite/deps` with no
 * default export — that is the crash this layout + these specifiers prevent.
 */
(self as unknown as { MonacoEnvironment?: unknown }).MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new JsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    return new EditorWorker();
  }
};
loader.config({ monaco });
