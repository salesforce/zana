// The heavy half of DiffViewer, split into its own module so it can be
// React.lazy()'d. `react-diff-viewer-continued` drags in emotion + the `diff`
// library + js-yaml; keeping it here (behind a dynamic import in DiffViewer.tsx)
// stops it riding the first-paint chunk via the always-mounted AgentModalHost.
// It's only needed once the user actually opens a diff (agent inspector,
// explorer, library), so it loads on demand.
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';

export default function DiffViewerInner({
  original,
  modified,
  compactStyles,
  isDark
}: {
  original: string;
  modified: string;
  compactStyles: Record<string, unknown>;
  isDark: boolean;
}) {
  return (
    <ReactDiffViewer
      oldValue={original}
      newValue={modified}
      splitView={false}
      showDiffOnly
      extraLinesSurroundingDiff={2}
      hideLineNumbers={false}
      // Faster for large files than word-level/char-heavy modes.
      compareMethod={DiffMethod.LINES}
      disableWordDiff
      hideSummary
      useDarkTheme={isDark}
      styles={compactStyles}
    />
  );
}
