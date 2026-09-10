import { parseProviderCliUpdateHint } from './machine-provider-clis.js';

function HintPath({ label, value }: { label: string; value: string }) {
  return (
    <div className="machine-cli-row-hint-pair">
      <span className="machine-cli-row-hint-label">{label}</span>
      <code className="machine-cli-row-hint-code">{value}</code>
    </div>
  );
}

export function ProviderCliUpdateHint({
  reason,
  testId
}: {
  reason: string;
  testId: string;
}) {
  const hint = parseProviderCliUpdateHint(reason);
  if (hint.kind === 'homebrew') {
    return (
      <div className="machine-cli-row-hint" data-testid={testId}>
        <p className="machine-cli-row-hint-title">Managed by Homebrew</p>
        <HintPath label="Update with" value={`brew upgrade ${hint.formula}`} />
      </div>
    );
  }
  if (hint.kind === 'external') {
    return (
      <div className="machine-cli-row-hint" data-testid={testId}>
        <p className="machine-cli-row-hint-title">ZCC cannot update this CLI</p>
        <HintPath label="PATH" value={hint.path} />
        {hint.resolvedPath ? <HintPath label="Resolves to" value={hint.resolvedPath} /> : null}
      </div>
    );
  }
  return (
    <div className="machine-cli-row-hint" data-testid={testId}>
      <p className="machine-cli-row-hint-title">{hint.text}</p>
    </div>
  );
}
