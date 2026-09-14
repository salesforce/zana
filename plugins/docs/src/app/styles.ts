export const DOCS_PLUGIN_STYLES = `
.docs-document-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.docs-document-panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}

.docs-document-panel-title {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 550;
}

.docs-document-panel-open {
  flex: 0 0 auto;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}

.docs-document-panel-open:hover {
  color: var(--text-primary);
}

.docs-document-panel-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.docs-document-panel-body .library-md-editor {
  min-height: 100%;
}

.docs-document-panel-status,
.docs-document-panel-empty {
  padding: 16px 18px;
  color: var(--text-muted);
  font-size: 13px;
}

.docs-html-frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: var(--bg-base);
}
`;
