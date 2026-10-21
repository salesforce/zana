/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import { hostCss, sketchLwc, SKETCH_LIMITS } from './lwc-sketch.js';

const body = (doc: string) => doc.slice(doc.indexOf('<div class="sk-host">') + '<div class="sk-host">'.length, doc.lastIndexOf('</div></body>'));

describe('sketchLwc', () => {
  it('replaces bindings with placeholders and drops directives, handlers and links', () => {
    const out = body(sketchLwc('<template><a href="https://x" class={cls} title={tip} data-x="1" onclick={go} lwc:ref="r" key={k}>Hi {name} &amp; <b>{ n }</b></a></template>'));
    expect(out).toBe('<a title="‹tip›" data-x="1">Hi <span class="sk-bind">‹name›</span> &amp; <b><span class="sk-bind">‹n›</span></b></a>');
  });
  it('shows every branch and loop body once, labelled with its directive, and unwraps a bare template', () => {
    const out = body(sketchLwc(`<template>
      <template if:true={loading}><p>Loading</p></template><template if:false={loading}><p>Ready</p></template>
      <template lwc:if={a}><i>A</i></template><template lwc:else><i>C</i></template>
      <template for:each={rows} for:item="row"><li key={row.id}>{row.name}</li></template><template><b>plain</b></template></template>`).replace(/\s+/g, ' '));
    expect(out).toBe(' <div class="sk-branch"><span class="sk-cond">if:true={loading}</span><p>Loading</p></div>'
      + '<div class="sk-branch"><span class="sk-cond">if:false={loading}</span><p>Ready</p></div>'
      + ' <div class="sk-branch"><span class="sk-cond">lwc:if={a}</span><i>A</i></div><div class="sk-branch"><span class="sk-cond">lwc:else</span><i>C</i></div>'
      + ' <div class="sk-branch"><span class="sk-cond">for:each={rows} for:item=row</span><li><span class="sk-bind">‹row.name›</span></li></div><b>plain</b>');
  });
  it('boxes child and base components with their label, keeping slotted content', () => {
    const out = body(sketchLwc('<template><lightning-button label="Save" icon-name={icon}></lightning-button><c-card title="Hi"><p>in</p></c-card></template>'));
    expect(out).toBe('<div class="sk-cmp" data-component="lightning-button"><span class="sk-tag">&lt;lightning-button&gt;</span>Save · <span class="sk-bind">‹icon›</span></div>'
      + '<div class="sk-cmp" data-component="c-card"><span class="sk-tag">&lt;c-card&gt;</span>Hi<p>in</p></div>');
  });
  it('drops scripts, styles, frames and slots, keeps void elements open, and stops at the depth limit', () => {
    expect(body(sketchLwc('<template><script>x()</script><style>p{}</style><iframe></iframe><slot></slot><img alt="a" src="https://x"><hr></template>'))).toBe('<img alt="a"><hr>');
    const deep = `<template>${'<div>'.repeat(SKETCH_LIMITS.depth + 5)}deep${'</div>'.repeat(SKETCH_LIMITS.depth + 5)}</template>`;
    expect(body(sketchLwc(deep))).not.toContain('deep');
  });
  it('stands a host box in for :host and blocks every load with its own CSP', () => {
    const doc = sketchLwc('<template><p>x</p></template>', ':host { display:block } :host(.big) p { color:red } </style><script>');
    expect(doc).toContain("default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    expect(doc).toContain('.sk-host { display:block } .sk-host.big p { color:red } <\\/style><script>');
    expect(doc).not.toMatch(/<\/style><script>/);
    expect(hostCss(':host-context(x)')).toBe(':host-context(x)');
  });
});
