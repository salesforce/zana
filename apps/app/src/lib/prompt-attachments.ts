import { APP_SURFACE_HEADER, fetchWithAppSurface } from './fetch-with-app-surface.js';
import { getAppSurface } from './app-surface.js';

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
  file: File,
  onProgress?: (ratio: number) => void
): Promise<UploadedPromptAttachment> {
  const form = new FormData();
  form.set('file', file, file.name);
  if (!onProgress) {
    const response = await fetchWithAppSurface(
      `/api/v1/projects/${encodeURIComponent(projectId)}/attachments`,
      { method: 'POST', body: form }
    );
    if (!response.ok) {
      throw new Error(await uploadErrorDetail(response));
    }
    return response.json() as Promise<UploadedPromptAttachment>;
  }
  const response = await new Promise<Response>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/v1/projects/${encodeURIComponent(projectId)}/attachments`);
    xhr.setRequestHeader(APP_SURFACE_HEADER, getAppSurface());
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      onProgress(Math.min(1, event.loaded / event.total));
    };
    xhr.onload = () => {
      resolve(new Response(xhr.responseText, {
        status: xhr.status,
        statusText: xhr.statusText,
        headers: { 'Content-Type': xhr.getResponseHeader('Content-Type') ?? 'application/json' }
      }));
    };
    xhr.onerror = () => reject(new Error('upload failed'));
    xhr.send(form);
  });
  if (!response.ok) throw new Error(await uploadErrorDetail(response));
  onProgress(1);
  return response.json() as Promise<UploadedPromptAttachment>;
}

async function uploadErrorDetail(response: Response): Promise<string> {
  let detail = `${response.status}`;
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    detail = body.message ?? body.error ?? detail;
  } catch {
    /* keep status */
  }
  return detail;
}

/** Absolute disk paths and relative project files must be uploaded; remote/data URLs can render as-is. */
export function composerImageNeedsUpload(path: string | null | undefined): boolean {
  if (!path) return true;
  if (/^(https?:|data:|blob:)/iu.test(path)) return false;
  return true;
}

export async function persistComposerImages(
  projectId: string,
  images: Array<{ path: string | null; file: File }>,
  onProgress?: (ratio: number) => void
): Promise<string[]> {
  const paths: string[] = [];
  const pending = images.filter((image) => composerImageNeedsUpload(image.path));
  let completed = 0;
  for (const image of images) {
    if (!composerImageNeedsUpload(image.path) && image.path) {
      paths.push(image.path);
      continue;
    }
    const uploaded = await uploadPromptAttachment(
      projectId,
      image.file,
      onProgress
        ? (ratio) => {
            if (pending.length === 0) return;
            onProgress((completed + ratio) / pending.length);
          }
        : undefined
    );
    completed += 1;
    onProgress?.(completed / Math.max(1, pending.length));
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
  if (path.startsWith('file:') || path.startsWith('/') || /^[a-zA-Z]:[\\/]/u.test(path)) return null;
  return projectAttachmentContentUrl(projectId, path);
}
