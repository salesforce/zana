import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Per-slot error boundary keyed by pluginId + generation so a reload remounts
 * a fresh boundary instead of a latched crash from the previous bundle.
 */
export class PluginSlotBoundary extends Component<
  { pluginId: string; generation: number; children?: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    /* isolated */
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="plugin-slot-error" role="alert">
          Plugin {this.props.pluginId} failed to render.
        </div>
      );
    }
    return this.props.children ?? null;
  }
}
