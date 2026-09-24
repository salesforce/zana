import { AlertTriangle, Loader2 } from 'lucide-react';
import type { ProviderCliStatus } from '@zana-ai/zcc-contracts/host-rpc';

export function providerCliBlockedReason(input: {
  displayName: string;
  installed: boolean;
}): string {
  return `${input.installed ? 'Update' : 'Install'} ${input.displayName} before starting a thread.`;
}

export function providerCliVersionRequirementCopy(
  currentVersion: string | null,
  minimumSupportedVersion: string | null
): string {
  if (currentVersion !== null && minimumSupportedVersion !== null) {
    return `Installed ${currentVersion}; version ${minimumSupportedVersion} or newer is required.`;
  }
  if (currentVersion !== null) {
    return `Installed ${currentVersion}; a newer version is required.`;
  }
  if (minimumSupportedVersion !== null) {
    return `Version ${minimumSupportedVersion} or newer is required.`;
  }
  return 'A newer version is required.';
}

export function isBlockingProviderCliStatus(status: ProviderCliStatus | null | undefined): boolean {
  return Boolean(status && (!status.installed || status.versionUnsupported));
}

export function ProviderCliBanner({
  displayName,
  installed,
  currentVersion,
  minimumSupportedVersion,
  canRunAction,
  actionRunning,
  onAction
}: {
  displayName: string;
  installed: boolean;
  currentVersion: string | null;
  minimumSupportedVersion: string | null;
  canRunAction: boolean;
  actionRunning: boolean;
  onAction: () => void;
}) {
  const blockedReason = providerCliBlockedReason({ displayName, installed });
  const title = installed ? `${displayName} update required` : `${displayName} not installed`;
  const description = installed
    ? `${blockedReason} ${providerCliVersionRequirementCopy(currentVersion, minimumSupportedVersion)}`
    : blockedReason;
  const actionLabel = installed ? `Update ${displayName}` : `Install ${displayName}`;

  return (
    <section
      className="provider-cli-banner"
      role="region"
      aria-label={title}
      data-testid="provider-cli-banner"
    >
      <div className="provider-cli-banner-body" role="alert">
        <AlertTriangle size={14} className="provider-cli-banner-icon" aria-hidden="true" />
        <div className="provider-cli-banner-copy">
          <p className="provider-cli-banner-title">{title}</p>
          <p className="provider-cli-banner-description">{description}</p>
        </div>
        {canRunAction ? (
          <button
            type="button"
            className="provider-cli-banner-action"
            disabled={actionRunning}
            onClick={onAction}
          >
            {actionRunning ? (
              <>
                <Loader2 size={12} className="thread-command-send-spin" aria-hidden="true" />
                {installed ? 'Updating…' : 'Installing…'}
              </>
            ) : (
              actionLabel
            )}
          </button>
        ) : null}
      </div>
    </section>
  );
}
