import { Component, Suspense, type ReactNode } from 'react';
import { StencilLines } from '../ui/Skeleton.js';

const ViewerLoadingFallback = (
  <div className="explorer-viewer-empty">
    <div className="explorer-viewer-loading">
      <StencilLines label="Loading file viewer" />
    </div>
  </div>
);

/** A failed editor/preview chunk must never take the file tree down with it. */
export class ViewerBoundary extends Component<{ children: ReactNode; resetKey?: unknown }, { error: boolean }> {
  state: { error: boolean } = { error: false };

  static getDerivedStateFromError() {
    return { error: true };
  }

  componentDidCatch(error: unknown) {
    console.error('File viewer failed to load:', error);
  }

  componentDidUpdate(prevProps: { children: ReactNode; resetKey?: unknown }) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: false });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="explorer-viewer-empty" role="alert">
          Could not load file viewer: An unexpected error occurred
        </div>
      );
    }
    return <Suspense fallback={ViewerLoadingFallback}>{this.props.children}</Suspense>;
  }
}
