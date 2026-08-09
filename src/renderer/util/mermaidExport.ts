/**
 * Rasterize a mermaid SVG *string* to a PNG/JPEG blob, plus a download helper.
 *
 * IMPORTANT — why this takes a string, not the on-screen <svg>: mermaid 11
 * renders node labels inside <foreignObject> (HTML labels). A browser TAINTS a
 * canvas the moment you drawImage() an <img> whose SVG contains a
 * foreignObject, so canvas.toBlob() then yields a blank (background-only)
 * image — the ~300-byte "download did nothing" bug. The caller therefore
 * re-renders the diagram with `htmlLabels: false` (native <text> labels, no
 * foreignObject) and hands us that clean, self-contained markup. That SVG also
 * carries an explicit font, so we don't need getComputedStyle here.
 */

/** Read the intrinsic pixel size of an SVG string from its viewBox (or w/h). */
function svgSize(xml: string): { width: number; height: number } {
  const doc = new DOMParser().parseFromString(xml, 'image/svg+xml');
  const svg = doc.documentElement as unknown as SVGSVGElement;
  const vb = svg.getAttribute('viewBox');
  if (vb) {
    const parts = vb.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: Math.ceil(parts[2]), height: Math.ceil(parts[3]) };
    }
  }
  const w = Number(svg.getAttribute('width'));
  const h = Number(svg.getAttribute('height'));
  return {
    width: Number.isFinite(w) && w > 0 ? Math.ceil(w) : 800,
    height: Number.isFinite(h) && h > 0 ? Math.ceil(h) : 600
  };
}

/**
 * Rasterize an SVG string to a PNG or JPEG blob at `scale`× (2 = retina-crisp).
 * `background` paints a solid fill first — required for JPEG (no transparency),
 * and used for PNG too so a dark-theme diagram exported for a light doc reads.
 */
export async function rasterizeSvgString(
  xml: string,
  opts: { type: 'image/png' | 'image/jpeg'; scale?: number; background?: string }
): Promise<Blob> {
  const { type } = opts;
  const scale = opts.scale ?? 2;
  const { width, height } = svgSize(xml);

  const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');

    if (opts.background) {
      ctx.fillStyle = opts.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
        type,
        type === 'image/jpeg' ? 0.92 : undefined
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('svg image load failed'));
    img.src = src;
  });
}

/** Trigger a browser download of a blob under `filename`. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click has consumed the URL first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
