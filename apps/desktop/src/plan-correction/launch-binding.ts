import type { PlanCorrectionService } from './service.js';

/** Bridges transient launch requests to the durable execution identity. */
export class PlanCorrectionLaunchBinding {
  private readonly reasons = new Map<string, string>();

  beginLaunch(launchRequestId: string, reason: string): void {
    this.reasons.set(launchRequestId, reason);
  }

  async bindExecution(launchRequestId: string, executionId: string, correction: PlanCorrectionService): Promise<boolean> {
    const reason = this.reasons.get(launchRequestId);
    if (reason === undefined) return false;
    this.reasons.delete(launchRequestId);
    await correction.begin(executionId, reason, false);
    return true;
  }

  forgetLaunch(launchRequestId: string): void {
    this.reasons.delete(launchRequestId);
  }
}
