import { MigrationRepairRequiredError } from './harness-routing-migration/journal.js';

export type StartupState =
  | { mode: 'ready' }
  | { mode: 'repair-required'; reason: 'harness-routing-migration' };

export interface StartupGateDeps {
  migrate(): Promise<unknown>;
  launchNormal(): void | Promise<void>;
  onRepairRequired?(state: Extract<StartupState, { mode: 'repair-required' }>): void | Promise<void>;
}

export async function runStartupGate(deps: StartupGateDeps): Promise<StartupState> {
  try {
    await deps.migrate();
  } catch (error) {
    if (!(error instanceof MigrationRepairRequiredError)) {
      try {
        await deps.migrate();
      } catch {
        const state = { mode: 'repair-required', reason: 'harness-routing-migration' } as const;
        await deps.onRepairRequired?.(state);
        return state;
      }
    } else {
      const state = { mode: 'repair-required', reason: 'harness-routing-migration' } as const;
      await deps.onRepairRequired?.(state);
      return state;
    }
  }
  await deps.launchNormal();
  return { mode: 'ready' };
}
