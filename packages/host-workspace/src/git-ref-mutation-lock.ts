import fs from "node:fs/promises";
import { withQueuedLock } from "./process-local-queued-lock.js";

const gitRefMutationLockKeyPrefix = "git-ref-mutation:";

export async function withGitRefMutationLock<T>(
  commonDir: string,
  work: () => Promise<T>,
): Promise<T> {
  const commonDirIdentity = await fs.stat(commonDir, { bigint: true });
  return withQueuedLock(
    `${gitRefMutationLockKeyPrefix}${commonDirIdentity.dev}:${commonDirIdentity.ino}`,
    work,
  );
}
