import type { ModernTeamLaunchConfig } from './modern-team-launch-tools.js';

export function createRuntimeMcpConfig() {
  let current: ModernTeamLaunchConfig = { teamLaunchEnabled: false, teamJobLaunchEnabled: false };
  let pending: ModernTeamLaunchConfig | null = null;

  return {
    get(): ModernTeamLaunchConfig {
      return current;
    },
    receive(next: ModernTeamLaunchConfig, started: boolean): void {
      if (!started) {
        pending = next;
        return;
      }
      current = next;
      pending = null;
    },
    started(): void {
      if (!pending) return;
      current = pending;
      pending = null;
    }
  };
}
