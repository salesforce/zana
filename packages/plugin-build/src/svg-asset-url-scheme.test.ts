import { describe, expect, it } from "vitest";
import { assertValidPluginLogoSvg } from "./svg-asset.js";

const LOGO = 'manifest zcc.branding.logo.light ("./logo.svg")';
const SVG = 'xmlns="http://www.w3.org/2000/svg"';
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const withHref = (href: string, tag = "a"): Uint8Array =>
  encode(`<svg ${SVG}><${tag} href="${href}"><path d="M0 0"/></${tag}></svg>`);

describe("logo SVG URL schemes", () => {
  it.each([
    ["javascript:alert(1)", "javascript"],
    ["  JavaScript:alert(1)", "javascript"],
    ["java&#10;scr&#9;ipt:alert(1)", "javascript"],
    ["vbscript:msgbox(1)", "vbscript"],
    ["VBScript:msgbox(1)", "vbscript"],
    ["data:text/html,&lt;script&gt;1&lt;/script&gt;", "data"],
    ["data:image/svg+xml;base64,PHN2Zy8+", "data"],
    ["  DaTa:text/html,x", "data"],
    ["data:application/octet-stream,x", "data"],
    ["data:,plain", "data"],
  ])("refuses %s", (href, scheme) => {
    const bytes = withHref(href);
    expect(() => assertValidPluginLogoSvg(bytes, LOGO)).toThrow(
      new RegExp(`must not contain a ${scheme}: URL in <a href>`),
    );
    expect(() => assertValidPluginLogoSvg(bytes, LOGO)).toThrow(LOGO);
  });

  it("names the namespaced attribute that carries the URL", () => {
    const bytes = encode(
      `<svg ${SVG} xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="vbscript:1"/></svg>`,
    );
    expect(() => assertValidPluginLogoSvg(bytes, LOGO)).toThrow(
      /must not contain a vbscript: URL in <use xlink:href>/,
    );
  });

  it.each([
    "data:image/png;base64,iVBORw0KGgo=",
    "data:image/jpeg;base64,/9j/4AAQ",
    "data:image/jpg;base64,/9j/4AAQ",
    "data:image/gif;base64,R0lGODlh",
    "data:image/webp;base64,UklGR",
    "data:image/avif,x",
  ])("keeps the raster image %s, which carries no script", (href) => {
    expect(() => assertValidPluginLogoSvg(withHref(href, "image"), LOGO)).not.toThrow();
  });

  it.each(["#fragment", "https://example.com/x.svg#p", "relative/path.svg", ""])(
    "accepts the href %j",
    (href) => {
      expect(() => assertValidPluginLogoSvg(withHref(href), LOGO)).not.toThrow();
    },
  );

  it("ignores URL-looking text outside an href", () => {
    const bytes = encode(
      `<svg ${SVG}><title>vbscript:1</title><path d="M0 0" data-x="data:text/html,x"/></svg>`,
    );
    expect(() => assertValidPluginLogoSvg(bytes, LOGO)).not.toThrow();
  });
});
