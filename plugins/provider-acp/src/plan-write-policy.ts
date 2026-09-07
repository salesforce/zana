import { basename, isAbsolute, join, relative, resolve } from "node:path";

const PLAN_DIR_SEGMENTS = [".zcc", "plans"] as const;

export function isPlanAcpMode(mode: string | undefined): boolean {
  return (mode ?? "").trim().toLowerCase() === "plan";
}

function isPathInsideRoot(targetPath: string, root: string): boolean {
  const relativePath = relative(resolve(root), resolve(targetPath));
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

/** True when dest is a markdown file under `<cwd>/.zcc/plans`. */
export function isPlanArtifactWritePath(cwd: string, dest: string): boolean {
  const plansRoot = join(cwd, ...PLAN_DIR_SEGMENTS);
  if (!isPathInsideRoot(dest, plansRoot)) return false;
  return basename(dest).toLowerCase().endsWith(".md");
}
