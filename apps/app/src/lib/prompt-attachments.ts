import { fetchWithAppSurface } from './fetch-with-app-surface.js';

export interface UploadedPromptAttachment {
  type: 'localImage' | 'localFile';
  path: string;
  name: string;
  mimeType?: string;
  sizeBytes: number;
}

export function projectAttachmentContentUrl(projectId: string, path: string): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/attachments/content?path=${encodeURIComponent(path)}`;
}

export async function uploadPromptAttachment(
  projectId: string,
  file: File
): Promise<UploadedPromptAttachment> {
  const form = new FormData();
  form.set('file', file, file.name);
  const response = await fetchWithAppSurface(
    `/api/v1/projects/${encodeURIComponent(projectId)}/attachments`,
    { method: 'POST', body: form }
  );
  if (!response.ok) {
    let detail = `${response.status}`;
    try {
      const body = (await response.json()) as { error?: string; message?: string };
      detail = body.message ?? body.error ?? detail;
    } catch {
      /* keep status */
    }
    throw new Error(detail);
  }
  return response.json() as Promise<UploadedPromptAttachment>;
}

export async function persistComposerImages(
  projectId: string,
  images: Array<{ path: string | null; file: File }>
): Promise<string[]> {
  const paths: string[] = [];
  for (const image of images) {
    if (image.path) {
      paths.push(image.path);
      continue;
    }
    const uploaded = await uploadPromptAttachment(projectId, image.file);
    paths.push(uploaded.path);
  }
  return paths;
}

export function conversationImageSrc(
  projectId: string | null | undefined,
  path: string
): string | null {
  if (/^(https?:|data:|blob:)/iu.test(path)) return path;
  if (!projectId) return null;
  if (path.startsWith('/') || /^[a-zA-Z]:[\\/]/u.test(path)) return null;
  return projectAttachmentContentUrl(projectId, path);
}
