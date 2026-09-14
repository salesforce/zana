import type { PluginFileOpenerProps } from '@zana-ai/zcc-plugin-sdk/app';

export function DocsOpener(props: PluginFileOpenerProps) {
  const Original = props.experimental_Original;
  if (!Original) return null;
  return (
    <div className="docs-file-opener">
      <Original />
    </div>
  );
}
