import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error)
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const details = error instanceof Error ? error.stack || error.message : String(error);
    console.error('[renderer] uncaught render error:', details, info.componentStack);
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="settings-panel">
        <div className="settings-inner">
          <h2>Renderer crashed</h2>
          <p>The app hit an unexpected error and recovered to a safe screen.</p>
          <pre style={{ whiteSpace: 'pre-wrap', color: 'var(--danger)' }}>{this.state.message}</pre>
          <div className="empty-actions">
            <button className="btn primary" onClick={this.handleReload}>
              Reload app
            </button>
          </div>
        </div>
      </div>
    );
  }
}
