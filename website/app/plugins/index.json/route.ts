import { NextResponse } from 'next/server';

/**
 * Marketplace-as-provenance: npm/git pointers, never file-bundle archives.
 * `zcc marketplace add` fetches this index. Refresh does not execute code.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const index = {
    schemaVersion: 1,
    name: 'official',
    displayName: 'Zana official plugins',
    description: 'First-party plugins shipped with Zana Command Center',
    plugins: [
      {
        id: 'docs',
        displayName: 'Docs',
        description: 'Durable project knowledge: Docs rail, per-project Library, and the library-curator skill',
        author: { name: 'Zana' },
        source: { git: { url: 'https://github.com/salesforce/zana', subdir: 'plugins/docs', ref: 'HEAD' } }
      }
    ]
  };
  return NextResponse.json(index, {
    headers: { 'Cache-Control': 'public, max-age=0, must-revalidate' }
  });
}
