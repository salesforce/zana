import { IPC } from '@zana-ai/zcc-desktop-contract';
import { normalizeApiErrorResume } from '@zana-ai/zcc-domain/product';
import { ctx } from './ctx.js';

const MAX_TEXT = 8192;

export function registerApiErrorResumeIpc(): void {
  // Desktop-only (Settings "Check an error"): the renderer's rules and text are
  // untrusted, so both are normalised and capped here before any matching.
  ctx.safeHandle(
    IPC.apiErrorResume.check,
    async (input: { text?: unknown; rules?: unknown } | undefined) => {
      if (!input || typeof input.text !== 'string') return { ruleId: null, skipped: [] };
      const rules = normalizeApiErrorResume({ enabled: true, rules: input.rules })?.rules ?? [];
      return ctx.apiErrorResume.check(input.text.slice(0, MAX_TEXT), rules);
    },
    () => ({ ruleId: null, skipped: [] })
  );
}
