import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { boundCrashText, CRASH_REPORT_MARKDOWN_MAX } from '@zana-ai/zcc-domain/product';

export const CRASH_REPORT_KEEP = 20;
export const CRASH_REPORTS_DIRNAME = 'crashes';

export function crashReportsDir(dataDir: string): string {
  return join(dataDir, CRASH_REPORTS_DIRNAME);
}

export async function saveRendererCrashReport(options: {
  dir: string;
  markdown: string;
  now?: Date;
  id?: string;
}): Promise<{ fileName: string }> {
  await mkdir(options.dir, { recursive: true, mode: 0o700 });
  const stamp = (options.now ?? new Date()).toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const id = (options.id ?? randomUUID()).replaceAll('-', '').slice(0, 8);
  const fileName = `crash-${stamp}-${id}.md`;
  const dest = join(options.dir, fileName);
  const tmp = `${dest}.${randomUUID()}.tmp`;
  const body = boundCrashText(options.markdown, CRASH_REPORT_MARKDOWN_MAX);
  await writeFile(tmp, body, { encoding: 'utf8', mode: 0o600 });
  await rename(tmp, dest);
  await pruneCrashReports(options.dir);
  return { fileName };
}

export async function pruneCrashReports(dir: string, keep = CRASH_REPORT_KEEP): Promise<void> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.startsWith('crash-') && name.endsWith('.md')).sort();
  } catch {
    return;
  }
  const extra = names.length - keep;
  if (extra <= 0) return;
  await Promise.all(names.slice(0, extra).map((name) => unlink(join(dir, name)).catch(() => undefined)));
}
