import { BrowserWindow, app, shell } from 'electron';
import { writeFile, unlink, mkdir, access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InboxPdfExport, InboxPdfExportResult } from '../shared/types.js';

/**
 * Render a self-contained HTML document to PDF and write it to disk.
 *
 * The renderer already paints the inbox detail (mermaid → inline SVG,
 * code → highlighted spans), then serializes that subtree plus the page CSS
 * into a standalone document. We load it into a hidden, offscreen
 * BrowserWindow and use Chromium's `printToPDF` — so the PDF matches what the
 * user sees, with no second markdown pipeline to keep in sync.
 *
 * The window is sandboxed: no node integration, no preload, and the HTML is
 * staged to a uniquely-named temp file that we `loadFile` and delete once the
 * snapshot is taken. We deliberately do NOT use a `data:` URL here: Chromium
 * refuses to *navigate* to a data: URL larger than ~2 MB, and the inlined page
 * stylesheet alone (~400 KB once percent-encoded) eats most of that budget —
 * so any moderately large markdown doc failed to load with ERR_INVALID_URL.
 * A temp file has no such ceiling and carries the full 2 MB read-cap worst
 * case fine.
 *
 * There is no save dialog: the PDF goes straight into `exportDir` (the OS
 * Downloads folder unless the user overrode it in settings), with the filename
 * uniquely suffixed on collision so an export never overwrites an existing
 * file. Once written, the PDF is opened in the OS default viewer (best-effort —
 * a failed open never fails the export, the file is already safely on disk).
 * Returns the absolute path written, or `{ ok: false, message }` on failure.
 */
export async function exportInboxPdf(
  exportDir: string | undefined,
  input: InboxPdfExport
): Promise<InboxPdfExportResult> {
  const safeName = sanitizeFilename(input.suggestedName) || 'inbox-entry';
  // Configured override wins; otherwise the OS Downloads folder.
  const targetDir = exportDir?.trim() || app.getPath('downloads');

  let offscreen: BrowserWindow | null = null;
  // Uniquely-suffixed temp file: trusted, self-generated HTML staged for
  // `loadFile`, deleted in `finally` whether or not the render succeeds.
  const stagePath = join(tmpdir(), `zcc-inbox-export-${randomBytes(8).toString('hex')}.html`);
  try {
    // The override dir may not exist yet (Downloads always does); create it so
    // a freshly-typed path just works rather than failing the write.
    await mkdir(targetDir, { recursive: true });
    await writeFile(stagePath, input.html, 'utf8');

    offscreen = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        // No app preload — this window only renders trusted, self-generated
        // HTML and must not expose any cc.* bridge.
        preload: undefined
      }
    });

    await offscreen.loadFile(stagePath);
    // Let late layout settle (fonts, SVG sizing) before snapshotting.
    await offscreen.webContents.executeJavaScript(
      'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))'
    );

    const pdf = await offscreen.webContents.printToPDF({
      printBackground: true,
      margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
      pageSize: 'A4'
    });

    const outPath = await uniquePath(targetDir, safeName);
    await writeFile(outPath, pdf);
    // Open in the OS default PDF viewer. Best-effort: the file is already
    // written, so a non-empty error here (no associated app, etc.) must not
    // turn a successful export into a failure — we just skip the auto-open.
    await shell.openPath(outPath).catch(() => '');
    return { ok: true, path: outPath };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  } finally {
    offscreen?.destroy();
    await unlink(stagePath).catch(() => {
      // Best-effort cleanup — a leftover temp file is harmless and the OS
      // reclaims tmpdir; never let cleanup mask the export result.
    });
  }
}

/**
 * Resolve a non-colliding `<dir>/<base>.pdf`, falling back to `<base> (2).pdf`,
 * `<base> (3).pdf`, … so an export never silently overwrites an earlier one.
 * Bounded so a wedged filesystem can't loop forever; the suffix is then random.
 */
async function uniquePath(dir: string, base: string): Promise<string> {
  for (let n = 1; n <= 999; n++) {
    const name = n === 1 ? `${base}.pdf` : `${base} (${n}).pdf`;
    const candidate = join(dir, name);
    try {
      await access(candidate);
      // Exists — try the next suffix.
    } catch {
      return candidate; // access threw ⇒ free slot.
    }
  }
  return join(dir, `${base}-${randomBytes(4).toString('hex')}.pdf`);
}

/** Strip path separators / illegal filename chars; collapse whitespace. */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}
