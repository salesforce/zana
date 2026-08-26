import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { MachinesTab } from './MachinesSettingsView.js';

vi.mock('../../lib/product-client.js', () => ({
  product: {
    hosts: {
      list: async () => [],
      onChanged: () => () => {}
    }
  }
}));

vi.mock('@/store', () => ({
  useData: (selector: (s: { projects: unknown[] }) => unknown) => selector({ projects: [] })
}));

const config: AppConfig = {
  version: 1,
  theme: 'system',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null,
  publicAppUrl: 'https://box.tailnet.ts.net'
};

describe('MachinesTab', () => {
  it('renders the public origin field and add-machine control', () => {
    const html = renderToStaticMarkup(
      <MachinesTab
        config={config}
        onConfigDraft={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />
    );
    expect(html).toContain('Public app URL');
    expect(html).toContain('Add machine');
    expect(html).toContain('https://box.tailnet.ts.net');
    expect(html).toContain('data-testid="machines-list"');
  });
});
