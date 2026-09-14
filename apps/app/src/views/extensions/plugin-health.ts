export interface PluginHealthCopy {
  summary: string;
  technical: string;
}

export function summarizePluginHealthDetail(detail: string | null | undefined): PluginHealthCopy {
  const technical = String(detail ?? '').trim();
  if (!technical) return { summary: '', technical: '' };
  if (/jiti createJiti is unavailable/i.test(technical)) {
    return {
      summary: 'Could not load this TypeScript plugin in the packaged app.',
      technical
    };
  }
  if (/cannot find module/i.test(technical)) {
    return {
      summary: 'A required plugin file is missing from this build.',
      technical
    };
  }
  const firstLine = technical.split('\n')[0]?.trim() || technical;
  return {
    summary: firstLine.length > 140 ? `${firstLine.slice(0, 137)}…` : firstLine,
    technical
  };
}
