const HARNESSES = ['Claude Code', 'Cursor', 'OpenCode', 'Codex', 'Pi'] as const;

export function HarnessStrip() {
  return (
    <div className="harness-strip" aria-label="Supported coding harnesses">
      <span>Works with</span>
      <ul>
        {HARNESSES.map((harness) => (
          <li key={harness}>{harness}</li>
        ))}
      </ul>
    </div>
  );
}
