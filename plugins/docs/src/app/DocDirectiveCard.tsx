import { useZccNavigate, type PluginMessageDirectiveProps } from '@zana-ai/zcc-plugin-sdk/app';
import { parseDocDirectiveAttributes } from '../doc-directive.js';
import { openDocFromCard } from '../open-doc-from-card.js';

export function DocDirectiveCard(props: PluginMessageDirectiveProps) {
  const navigate = useZccNavigate();
  const document = parseDocDirectiveAttributes(props.attributes);
  if (!document) {
    return (
      <div
        className="plugin-directive-card plugin-directive-card--error"
        role="alert"
        title={props.source}
      >
        Invalid Docs link. Expected a Markdown or HTML path.
      </div>
    );
  }

  const openCard = () => {
    openDocFromCard({
      document,
      projectId: props.message.projectId,
      openWorkspaceFile: props.openWorkspaceFile,
      openThreadPanel: navigate.openThreadPanel,
      toPluginPanel: navigate.toPluginPanel
    });
  };

  const openInLibrary = (event: { stopPropagation(): void }) => {
    event.stopPropagation();
    openDocFromCard({
      document,
      projectId: props.message.projectId,
      openWorkspaceFile: props.openWorkspaceFile,
      openThreadPanel: () => false,
      toPluginPanel: navigate.toPluginPanel
    });
  };

  const workspace = document.source === 'workspace';
  return (
    <div className="plugin-directive-card">
      <button
        type="button"
        className="plugin-directive-card-main"
        onClick={openCard}
        disabled={workspace && typeof props.openWorkspaceFile !== 'function'}
        title={document.path}
      >
        <span className="plugin-directive-card-kind">Docs</span>
        <span className="plugin-directive-card-title">{document.title}</span>
      </button>
      {workspace ? null : (
        <button
          type="button"
          className="plugin-directive-card-open"
          onClick={openInLibrary}
          title="Open in Library"
        >
          Open in Library
        </button>
      )}
    </div>
  );
}
