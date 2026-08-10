import { chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// node-pty's prebuilt Unix spawn helper must be executable. Some npm installs
// retain the archive's read-only mode, which otherwise surfaces only as the
// opaque "posix_spawnp failed" when the first terminal is created.
if (process.platform !== 'win32') {
  const helper = join(
    process.cwd(),
    'node_modules',
    'node-pty',
    'prebuilds',
    `${process.platform}-${process.arch}`,
    'spawn-helper'
  );
  if (existsSync(helper)) chmodSync(helper, 0o755);
}
