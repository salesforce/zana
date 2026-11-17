import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Use the CI image's browser without depending on the isolated HOME's cache. */
export function slackDiagramBrowserEnv(
  home: string,
  executablePath: string,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  if (platform !== 'linux') return {};
  const launcher = join(home, 'slack-diagram-chromium');
  const quotedExecutable = `'${executablePath.replaceAll("'", "'\\''")}'`;
  // The Linux E2E container runs as root, like the Electron fixture. This flag
  // applies only to this disposable test browser; production keeps its sandbox.
  writeFileSync(launcher, `#!/bin/sh\nexec ${quotedExecutable} --no-sandbox "$@"\n`, { mode: 0o700 });
  return { PUPPETEER_EXECUTABLE_PATH: launcher };
}
