/**
 * A static sketch of an LWC: its template and stylesheet as plain HTML, for a sandboxed, script-less iframe.
 * Nothing runs, so nothing decides which branch is live: every `if:` / `lwc:if` / `lwc:else` branch and every loop body
 * renders once, in a box labelled with its directive. `{bindings}` become placeholders, and child or base components
 * (`c-card`, `lightning-button`) become labelled boxes.
 */
export const SKETCH_LIMITS = { templateBytes: 256_000, depth: 64 } as const;

const DROP_TAGS = new Set(['script', 'style', 'link', 'iframe', 'frame', 'object', 'embed', 'base', 'meta', 'form', 'slot']);
const VOID_TAGS = new Set(['area', 'br', 'col', 'hr', 'img', 'input', 'source', 'track', 'wbr']);
const LABEL_ATTRS = ['label', 'title', 'value', 'alternative-text', 'icon-name', 'name'];
const BINDING = /\{([^{}]*)\}/g;
const ATTR_NAME = /^[A-Za-z_][\w.-]*$/;
const TAG_NAME = /^[a-z][a-z0-9-]*$/;

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const placeholder = (expr: string) => `‹${expr.trim()}›`;
const bound = (value: string) => /^\{[^{}]*\}$/.test(value.trim());

const BASE_CSS = `body{margin:12px;font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1f2328;background:#fff}
.sk-bind{background:#eef4fd;color:#225ea8;border-radius:3px;padding:0 3px;font:11px ui-monospace,Menlo,monospace}
.sk-cmp{display:block;border:1px dashed #9aa5b1;border-radius:6px;padding:4px 6px;margin:2px 0}
.sk-tag{display:block;font:10px ui-monospace,Menlo,monospace;color:#646b75}
.sk-branch{position:relative;border:1px dashed #d9822b;border-radius:6px;padding:18px 8px 6px;margin:6px 0}
.sk-cond{position:absolute;top:2px;left:8px;font:10px ui-monospace,Menlo,monospace;color:#b35900}`;

function text(value: string): string {
  return escape(value).replace(BINDING, (_, expr: string) => `<span class="sk-bind">${escape(placeholder(expr))}</span>`);
}

function attributes(el: Element): string {
  let out = '';
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    // Directives (for:each, lwc:ref, key), handlers and links do nothing in a sketch.
    if (!ATTR_NAME.test(name) || name.includes(':') || name === 'key' || name.startsWith('on') || name === 'href' || name === 'src' || name === 'srcset' || name === 'action') continue;
    if (bound(attr.value)) {
      if (name === 'class' || name === 'style') continue;
      out += ` ${name}="${escape(placeholder(attr.value.trim().slice(1, -1)))}"`;
    } else out += ` ${name}="${escape(attr.value)}"`;
  }
  return out;
}

function children(nodes: ArrayLike<Node>, depth: number): string {
  let out = '';
  for (const node of Array.from(nodes)) out += render(node, depth);
  return out;
}

function render(node: Node, depth: number): string {
  if (depth > SKETCH_LIMITS.depth) return '';
  if (node.nodeType === 3) return text(node.textContent ?? '');
  if (node.nodeType !== 1) return '';
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (tag === 'template') {
    const inner = children((el as HTMLTemplateElement).content?.childNodes ?? el.childNodes, depth + 1);
    const directives = Array.from(el.attributes).filter(attr => attr.name.includes(':'))
      .map(attr => attr.value ? `${attr.name}=${attr.value}` : attr.name);
    return directives.length ? `<div class="sk-branch"><span class="sk-cond">${escape(directives.join(' '))}</span>${inner}</div>` : inner;
  }
  if (DROP_TAGS.has(tag) || !TAG_NAME.test(tag)) return '';
  if (tag.includes('-')) {
    const labels = LABEL_ATTRS.map(name => el.getAttribute(name)).filter((value): value is string => !!value && !!value.trim())
      .map(value => bound(value) ? `<span class="sk-bind">${escape(placeholder(value.trim().slice(1, -1)))}</span>` : escape(value));
    return `<div class="sk-cmp" data-component="${escape(tag)}"><span class="sk-tag">&lt;${escape(tag)}&gt;</span>${labels.join(' · ')}${children(el.childNodes, depth + 1)}</div>`;
  }
  const open = `<${tag}${attributes(el)}>`;
  return VOID_TAGS.has(tag) ? open : `${open}${children(el.childNodes, depth + 1)}</${tag}>`;
}

/** LWC styles are scoped to the component's host; the sketch stands a `.sk-host` box in for it. */
export function hostCss(css: string): string {
  return css.replace(/:host\(([^)]*)\)/g, '.sk-host$1').replace(/:host(?![\w-])/g, '.sk-host').replace(/<\/style/gi, '<\\/style');
}

/** The iframe document for a template and its stylesheet. Its own CSP keeps it from loading anything. */
export function sketchLwc(template: string, css = ''): string {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${template.slice(0, SKETCH_LIMITS.templateBytes)}</body>`, 'text/html');
  const body = children(doc.body.childNodes, 0);
  return '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:">'
    + `<style>${BASE_CSS}</style><style>${hostCss(css)}</style></head><body><div class="sk-host">${body}</div></body></html>`;
}
