import { Component, createContext, useContext, type ErrorInfo, type ReactNode } from 'react';

export interface PluginRuntimeContextValue {
  pluginId: string;
  generation: number;
}

export const PluginRuntimeContext = createContext<PluginRuntimeContextValue>({
  pluginId: '',
  generation: 0
});

export function usePluginRuntimeContext(): PluginRuntimeContextValue {
  return useContext(PluginRuntimeContext);
}

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
    return (
      <PluginRuntimeContext.Provider
        value={{ pluginId: this.props.pluginId, generation: this.props.generation }}
      >
        {this.props.children ?? null}
      </PluginRuntimeContext.Provider>
    );
  }
}
