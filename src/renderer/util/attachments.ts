export function attachmentName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function mergeAttachmentPaths(current: readonly string[], paths: readonly string[]): string[] {
  return [...new Set([...current, ...paths.map((path) => path.trim()).filter(Boolean)])];
}

export function appendAttachmentContext(prompt: string, paths: readonly string[]): string {
  if (paths.length === 0) return prompt;
  return `${prompt}\n\nAttached files:\n${paths.map((path) => `- ${path}`).join('\n')}`;
}
