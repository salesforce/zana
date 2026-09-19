import { useState } from 'react';
import './ThreadVideoPreview.css';

export function videoPreviewUrl(path: string, threadId?: string, storage = false, projectId?: string | null): string {
  const params = new URLSearchParams({ path, source: storage ? 'thread-storage' : 'workspace' });
  if (threadId) params.set('threadId', threadId);
  if (projectId) params.set('projectId', projectId);
  return `/api/v1/file-preview/video?${params}`;
}

export function ThreadVideoPreview({ src, path }: { src: string; path: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="thread-video-preview" data-testid="thread-video-preview">
      <video
        className="thread-video-preview-player"
        src={src}
        controls
        playsInline
        preload="metadata"
        aria-label={`Video preview: ${path.split(/[\\/]/).pop()}`}
        onError={() => setFailed(true)}
        onLoadedMetadata={() => setFailed(false)}
      />
      {failed ? (
        <p className="thread-detail-empty" role="status">
          Could not play this video. The file may be unavailable, or its format or codec may not be supported.
        </p>
      ) : null}
    </div>
  );
}
