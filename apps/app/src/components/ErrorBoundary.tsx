import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Bug } from 'lucide-react';
import { reportRendererCrash } from '../lib/report-bug.js';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
  stack: string;
  componentStack: string;
  reportStatus: string;
  reporting: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    message: '',
    stack: '',
    componentStack: '',
    reportStatus: '',
    reporting: false
  };

  static getDerivedStateFromError(error: unknown): Pick<State, 'hasError' | 'message'> {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error)
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const stack = error instanceof Error ? error.stack || error.message : String(error);
    console.error('[renderer] uncaught render error:', stack, info.componentStack);
    this.setState({
      stack,
      componentStack: info.componentStack ?? ''
    });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleReport = () => {
    if (this.state.reporting) return;
    this.setState({ reporting: true, reportStatus: '' });
    void reportRendererCrash({
      message: this.state.message,
      stack: this.state.stack,
      componentStack: this.state.componentStack
    }).then((reportStatus) => {
      this.setState({ reportStatus, reporting: false });
    }).catch(() => {
      this.setState({
        reporting: false,
        reportStatus: 'Could not copy crash details. You can still file a bug from the sidebar.'
      });
    });
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="settings-panel">
        <div className="settings-inner">
          <h2>Renderer crashed</h2>
          <p>The app hit an unexpected error and recovered to a safe screen.</p>
          <pre style={{ whiteSpace: 'pre-wrap', color: 'var(--danger)' }}>{this.state.message}</pre>
          {this.state.reportStatus ? (
            <p className="crash-report-status" role="status">{this.state.reportStatus}</p>
          ) : null}
          <div className="empty-actions">
            <button className="btn primary" type="button" onClick={this.handleReload}>
              Reload app
            </button>
            <button
              className="btn"
              type="button"
              onClick={this.handleReport}
              disabled={this.state.reporting}
              aria-label="Report a bug"
            >
              <Bug size={14} aria-hidden="true" />
              {this.state.reporting ? 'Preparing report…' : 'Report a bug'}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
