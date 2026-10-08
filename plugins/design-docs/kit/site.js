// Design Docs site kit. Generated from src/kit by scripts/build-app.mjs; do not edit.
"use strict";
(() => {
  // src/kit/chart-spec.ts
  var MAX_SERIES = 8;
  var MAX_POINTS = 2e3;
  function fail(message) {
    throw new Error(`Kit.chart: ${message}`);
  }
  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function optionalNumber(spec, key) {
    const value = spec[key];
    if (value === void 0 || value === null) return null;
    if (typeof value !== "number" || !Number.isFinite(value)) fail(`${key} must be a number`);
    return value;
  }
  function optionalBoolean(spec, key) {
    const value = spec[key];
    if (value === void 0 || value === null) return null;
    if (typeof value !== "boolean") fail(`${key} must be true or false`);
    return value;
  }
  function toValue(value, where) {
    if (value === null || value === void 0 || value === "") return null;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
    return fail(`${where} is ${JSON.stringify(value)}, not a number (use null for a gap)`);
  }
  var FORMATS = /* @__PURE__ */ new Set(["number", "integer", "percent", "compact"]);
  function fromRows(rows, x, y) {
    if (!Array.isArray(rows)) fail("data must be rows: an array of objects, or the path of a JSON or CSV file");
    if (typeof x !== "string" || !x) fail("x must name the column that labels each point");
    const columns = (Array.isArray(y) ? y : [y]).map((entry, index) => {
      if (typeof entry === "string" && entry) return { column: entry, name: entry };
      if (isRecord(entry) && typeof entry.column === "string" && entry.column) {
        return { column: entry.column, name: typeof entry.name === "string" && entry.name ? entry.name : entry.column, slot: entry.slot };
      }
      return fail(`y[${index}] must name a value column`);
    });
    if (!columns.length) fail("y must name at least one value column");
    const objects = rows.map((row2, index) => isRecord(row2) ? row2 : fail(`data[${index}] is not an object`));
    return {
      labels: objects.map((row2) => String(row2[x] ?? "")),
      series: columns.map(({ column, name, slot }) => ({
        name,
        values: objects.map((row2, index) => toValue(row2[column], `data[${index}].${column}`)),
        ...slot === void 0 ? {} : { slot }
      }))
    };
  }
  function resolveSpec(raw) {
    if (!isRecord(raw)) fail("the spec must be an object");
    const type = raw.type;
    if (type !== "bar" && type !== "line") fail(`type must be "bar" or "line", not ${JSON.stringify(type)}`);
    let labels = raw.labels;
    let series = raw.series;
    if (raw.data !== void 0) {
      if (typeof raw.data === "string") fail(`data names ${raw.data}, which has not loaded yet`);
      ({ labels, series } = fromRows(raw.data, raw.x, raw.y));
    }
    if (!Array.isArray(labels)) fail("labels must be an array (or give data, x and y)");
    if (labels.length > MAX_POINTS) fail(`at most ${MAX_POINTS} points; aggregate the data first`);
    if (!Array.isArray(series) || !series.length) fail("series must be a non-empty array");
    if (series.length > MAX_SERIES) {
      fail(`${series.length} series is more than ${MAX_SERIES} colors can tell apart; fold the smallest into "Other" or split into small multiples`);
    }
    const used = /* @__PURE__ */ new Map();
    const resolved = series.map((entry, index) => {
      if (!isRecord(entry)) fail(`series[${index}] must be an object with name and values`);
      const name = typeof entry.name === "string" ? entry.name.trim() : "";
      if (!name) fail(`series[${index}] needs a name`);
      if (!Array.isArray(entry.values)) fail(`series[${index}].values must be an array`);
      if (entry.values.length !== labels.length) {
        fail(`series "${name}" has ${entry.values.length} values for ${labels.length} labels; use null for a gap`);
      }
      const slot = entry.slot ?? index + 1;
      if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 1 || slot > MAX_SERIES) fail(`series "${name}" slot must be 1 to ${MAX_SERIES}`);
      const taken = used.get(slot);
      if (taken !== void 0) fail(`series "${taken}" and "${name}" both use color slot ${slot}`);
      used.set(slot, name);
      return { name, slot, values: entry.values.map((value, point) => toValue(value, `series "${name}" value ${point + 1}`)) };
    });
    const format = raw.format ?? "number";
    if (!(typeof format === "string" ? FORMATS.has(format) : isRecord(format))) {
      fail('format must be "number", "integer", "percent", "compact" or Intl.NumberFormat options');
    }
    const height = optionalNumber(raw, "height");
    if (height !== null && (height < 80 || height > 2e3)) fail("height must be 80 to 2000 pixels");
    const stacked = optionalBoolean(raw, "stacked") ?? false;
    const horizontal = optionalBoolean(raw, "horizontal") ?? false;
    const area = optionalBoolean(raw, "area") ?? false;
    if (type === "line" && (stacked || horizontal)) fail("stacked and horizontal are for bar charts");
    if (type === "bar" && area) fail("area is for line charts");
    const yMin = optionalNumber(raw, "yMin");
    const yMax = optionalNumber(raw, "yMax");
    if (yMin !== null && yMax !== null && yMin >= yMax) fail("yMin must be below yMax");
    return {
      type,
      labels: labels.map((label) => String(label ?? "")),
      series: resolved,
      title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : null,
      stacked,
      horizontal,
      area,
      format,
      yMin,
      yMax,
      height,
      valueLabels: optionalBoolean(raw, "valueLabels"),
      table: optionalBoolean(raw, "table") ?? true,
      xLabel: typeof raw.xLabel === "string" ? raw.xLabel : typeof raw.x === "string" ? raw.x : ""
    };
  }

  // src/kit/dom.ts
  var SVG_NS = "http://www.w3.org/2000/svg";
  function lastIndex(items, test) {
    for (let index = items.length - 1; index >= 0; index -= 1) if (test(items[index])) return index;
    return -1;
  }
  function setAttributes(node, attributes) {
    for (const [name, value] of Object.entries(attributes)) {
      if (value === null || value === void 0 || value === false) continue;
      node.setAttribute(name, value === true ? "" : String(value));
    }
  }
  function html(doc, tag, attributes = {}, children = []) {
    const node = doc.createElement(tag);
    setAttributes(node, attributes);
    for (const child of children) if (child !== null && child !== void 0) node.append(child);
    return node;
  }
  function svg(doc, tag, attributes = {}, text) {
    const node = doc.createElementNS(SVG_NS, tag);
    const rounded = {};
    for (const [name, value] of Object.entries(attributes)) rounded[name] = typeof value === "number" ? round(value) : value;
    setAttributes(node, rounded);
    if (text !== void 0) node.textContent = text;
    return node;
  }
  function round(value) {
    return Math.round(value * 100) / 100;
  }
  function resolve(doc, target) {
    const node = typeof target === "string" ? doc.querySelector(target) : target;
    if (!node) throw new Error(`Kit: nothing matches ${String(target)}`);
    return node;
  }
  function once(seen, node, enhance) {
    if (seen.has(node)) return;
    seen.add(node);
    enhance();
  }
  function reportError(win, error) {
    const report = win.reportError;
    if (typeof report === "function") report.call(win, error);
    else win.console.error(error);
  }

  // src/kit/tooltip.ts
  var tooltips = /* @__PURE__ */ new WeakMap();
  function tooltipFor(win) {
    const doc = win.document;
    const existing = tooltips.get(doc);
    if (existing?.element.isConnected) return existing;
    const element = html(doc, "div", { class: "kit-tooltip", role: "tooltip", id: "kit-tooltip", hidden: true });
    doc.body.append(element);
    const tooltip = {
      element,
      show(head, rows, at, placement = "above") {
        element.replaceChildren(
          html(doc, "div", { class: "head" }, [head]),
          ...rows.map((row2) => {
            const line = html(doc, "div", { class: "row" }, [html(doc, "span", { class: "v" }, [row2.value]), html(doc, "span", { class: "k" }, [row2.name])]);
            if (row2.slot !== null) line.style.setProperty("--c", `var(--series-${row2.slot})`);
            return line;
          })
        );
        element.hidden = false;
        const width = element.offsetWidth;
        const height = element.offsetHeight;
        let left = at.x + 14;
        if (left + width > win.innerWidth - 8) left = at.x - 14 - width;
        let top = placement === "side" ? Math.min(at.y - height / 2, win.innerHeight - height - 8) : at.y - height - 12;
        if (top < 8) top = placement === "side" ? 8 : at.y + 16;
        element.style.left = `${Math.max(8, left)}px`;
        element.style.top = `${Math.max(8, top)}px`;
      },
      hide() {
        element.hidden = true;
      }
    };
    tooltips.set(doc, tooltip);
    return tooltip;
  }

  // src/kit/util.ts
  var PRESETS = {
    number: { maximumFractionDigits: 2 },
    integer: { maximumFractionDigits: 0 },
    // Values are fractions: 0.62 is 62%.
    percent: { style: "percent", maximumFractionDigits: 1 },
    compact: { notation: "compact", maximumFractionDigits: 1 }
  };
  var formatters = /* @__PURE__ */ new Map();
  var MAX_FORMATTERS = 50;
  function formatNumber(value, format = "number", locale) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "\u2013";
    const options = typeof format === "string" ? PRESETS[format] ?? PRESETS.number : format;
    const key = `${locale ?? ""}\0${JSON.stringify(options)}`;
    let formatter = formatters.get(key);
    if (!formatter) {
      formatter = new Intl.NumberFormat(locale, options);
      if (formatters.size < MAX_FORMATTERS) formatters.set(key, formatter);
    }
    return formatter.format(value);
  }
  function niceStep(span, count) {
    const raw = span / Math.max(1, count);
    const power = 10 ** Math.floor(Math.log10(raw));
    const fraction = raw / power;
    return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
  }
  function niceTicks(min, max, count = 5) {
    if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, ticks: [0, 1] };
    if (min > max) [min, max] = [max, min];
    if (min === max) {
      const pad = min === 0 ? 1 : Math.abs(min) * 0.1;
      min = min >= 0 && min - pad < 0 ? 0 : min - pad;
      max += pad;
    }
    const step = niceStep(max - min, count);
    const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
    const round2 = (value) => Number(value.toFixed(decimals));
    const low = round2(Math.floor(min / step) * step);
    const high = round2(Math.ceil(max / step) * step);
    const ticks = [];
    for (let index = 0; ; index += 1) {
      const tick = round2(low + index * step);
      if (tick > high + step / 2) break;
      ticks.push(tick);
    }
    return { min: low, max: high, ticks };
  }
  function linearScale(domain, range) {
    const [d0, d1] = domain;
    const [r0, r1] = range;
    const span = d1 - d0 || 1;
    return (value) => r0 + (value - d0) / span * (r1 - r0);
  }
  function textWidth(text, size = 12) {
    let units = 0;
    for (const char of text) units += /[ilj.,:;'|!]/.test(char) ? 0.3 : /[mwMW@%]/.test(char) ? 0.85 : /[A-Z0-9]/.test(char) ? 0.65 : 0.55;
    return units * size;
  }
  function fitText(text, width, size = 12) {
    if (textWidth(text, size) <= width) return text;
    let cut = text;
    while (cut.length > 1 && textWidth(`${cut}\u2026`, size) > width) cut = cut.slice(0, -1);
    return `${cut.trimEnd()}\u2026`;
  }
  var NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;
  function toNumber(text) {
    const cleaned = text.trim().replace(/[\s,$€£%]/g, "").replace(/^−/, "-");
    return NUMBER.test(cleaned) ? Number(cleaned) : null;
  }
  function parseCsv(text) {
    const rows = [];
    let row2 = [];
    let field = "";
    let quoted = false;
    const source = text.replace(/^﻿/, "");
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (quoted) {
        if (char === '"' && source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else if (char === '"') quoted = false;
        else field += char;
      } else if (char === '"' && field === "") quoted = true;
      else if (char === ",") {
        row2.push(field);
        field = "";
      } else if (char === "\n" || char === "\r") {
        if (char === "\r" && source[index + 1] === "\n") index += 1;
        row2.push(field);
        rows.push(row2);
        row2 = [];
        field = "";
      } else field += char;
    }
    if (field !== "" || row2.length) {
      row2.push(field);
      rows.push(row2);
    }
    const [header, ...body] = rows.filter((cells) => cells.some((cell) => cell !== ""));
    if (!header) return [];
    return body.map(
      (cells) => Object.fromEntries(
        header.map((name, column) => {
          const cell = cells[column] ?? "";
          const number = cell.trim() === "" ? null : NUMBER.test(cell.trim()) ? Number(cell.trim()) : null;
          return [name.trim(), number ?? cell];
        })
      )
    );
  }

  // src/kit/charts.ts
  var GAP = 2;
  var MAX_BAR = 24;
  var RADIUS = 4;
  var FALLBACK_WIDTH = 640;
  var PART = "data-kit-part";
  var TICK_SIZE = 12;
  var LABEL_SIZE = 12.5;
  function valueAxis(lo, hi, length, spacing, format) {
    const { ticks, min, max } = niceTicks(lo, hi, Math.max(2, Math.round(length / spacing)));
    return { ticks, min, max, text: ticks.map((tick) => formatNumber(tick, format)) };
  }
  var widest = (texts, size) => texts.reduce((most, text) => Math.max(most, textWidth(text, size)), 0);
  function roundedRect(x, y, w, h, r, corners) {
    const n = (value) => Math.round(value * 100) / 100;
    const [tl, tr, br, bl] = corners.map((on) => on ? r : 0);
    const arc = (radius, toX, toY) => radius ? `A${n(radius)},${n(radius)} 0 0 1 ${n(toX)},${n(toY)}` : "";
    return `M${n(x + tl)},${n(y)}H${n(x + w - tr)}${arc(tr, x + w, y + tr)}V${n(y + h - br)}${arc(br, x + w - br, y + h)}H${n(x + bl)}${arc(bl, x, y + h - bl)}V${n(y + tl)}${arc(tl, x + tl, y)}Z`;
  }
  function rootSvg(doc, width, height) {
    return svg(doc, "svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img", tabindex: 0 });
  }
  function gridLines(doc, axis, line) {
    const group = svg(doc, "g", { class: "chart-grid", "aria-hidden": "true" });
    for (const tick of axis.ticks) if (tick !== 0) group.append(svg(doc, "line", line(tick)));
    return group;
  }
  function row(series, value, format) {
    return { value: formatNumber(value, format), name: series.name, slot: series.slot };
  }
  var markClass = (series) => `chart-mark chart-s${series.slot}`;
  function toggleOn(marks, on) {
    for (const mark of marks) mark.classList.toggle("on", on);
  }
  function drawBars(doc, spec, shown, width) {
    const count = spec.labels.length;
    const grouped = !spec.stacked && shown.length > 1;
    const perGroup = grouped ? shown.length : 1;
    const format = spec.format;
    let lo = 0;
    let hi = 0;
    for (let index = 0; index < count; index += 1) {
      let up = 0;
      let down = 0;
      for (const series of shown) {
        const value = series.values[index];
        if (value === null || value === void 0) continue;
        if (spec.stacked) {
          if (value > 0) up += value;
          else down += value;
        } else {
          hi = Math.max(hi, value);
          lo = Math.min(lo, value);
        }
      }
      hi = Math.max(hi, up);
      lo = Math.min(lo, down);
    }
    if (spec.yMax !== null) hi = Math.max(hi, spec.yMax);
    if (spec.yMin !== null) lo = Math.min(lo, spec.yMin);
    const labelled = spec.valueLabels ?? (shown.length === 1 && !spec.stacked && count <= (spec.horizontal ? 20 : 12));
    const total = (index, sign) => shown.reduce((sum, series) => {
      const value = series.values[index] ?? 0;
      return sign > 0 ? sum + Math.max(0, value) : sum + Math.min(0, value);
    }, 0);
    const valueText = [];
    if (labelled) {
      for (let index = 0; index < count; index += 1) {
        if (spec.stacked) {
          const up = total(index, 1);
          const down = total(index, -1);
          if (up) valueText.push({ index, series: null, value: up });
          if (down) valueText.push({ index, series: null, value: down });
        } else for (const series of shown) if (series.values[index] !== null) valueText.push({ index, series, value: series.values[index] });
      }
    }
    return spec.horizontal ? horizontalBars(doc, spec, shown, width, { lo, hi, perGroup, labelled, valueText }) : verticalBars(doc, spec, shown, width, { lo, hi, perGroup, labelled, valueText });
  }
  function segments(spec, shown, index) {
    const out = [];
    if (!spec.stacked) {
      shown.forEach((series, slotIndex) => {
        const value = series.values[index] ?? null;
        out.push({ series, slotIndex, from: 0, to: value ?? 0, value, outer: true, inner: false });
      });
      return out;
    }
    let up = 0;
    let down = 0;
    for (const series of shown) {
      const value = series.values[index] ?? null;
      if (!value) continue;
      const from = value > 0 ? up : down;
      const to = from + value;
      out.push({ series, slotIndex: 0, from, to, value, outer: false, inner: from !== 0 });
      if (value > 0) up = to;
      else down = to;
    }
    const lastUp = out[lastIndex(out, (segment) => segment.to > 0)];
    const lastDown = out[lastIndex(out, (segment) => segment.to < 0)];
    if (lastUp) lastUp.outer = true;
    if (lastDown) lastDown.outer = true;
    return out;
  }
  function verticalBars(doc, spec, shown, width, plan) {
    const count = Math.max(1, spec.labels.length);
    const height = spec.height ?? 260;
    const top = plan.labelled ? 22 : 10;
    const bottom = 28;
    const plotHeight = height - top - bottom;
    const axis = valueAxis(plan.lo, plan.hi, plotHeight, 56, spec.format);
    const left = Math.ceil(widest(axis.text, TICK_SIZE)) + 12;
    const right = 8;
    const plotWidth = Math.max(40, width - left - right);
    const y = linearScale([axis.min, axis.max], [top + plotHeight, top]);
    const band = plotWidth / count;
    const thick = Math.max(1, Math.min(MAX_BAR, (band * 0.72 - GAP * (plan.perGroup - 1)) / plan.perGroup));
    const groupWidth = thick * plan.perGroup + GAP * (plan.perGroup - 1);
    const root = rootSvg(doc, width, height);
    root.append(gridLines(doc, axis, (tick) => ({ x1: left, x2: left + plotWidth, y1: y(tick), y2: y(tick) })));
    const ticks = svg(doc, "g", { "aria-hidden": "true" });
    axis.ticks.forEach((tick, index) => ticks.append(svg(doc, "text", { class: "chart-tick", x: left - 8, y: y(tick), dy: "0.32em", "text-anchor": "end" }, axis.text[index])));
    root.append(ticks);
    const categories = svg(doc, "g", { "aria-hidden": "true" });
    const step = Math.max(1, Math.ceil((Math.min(widest(spec.labels, LABEL_SIZE), 140) + 8) / band));
    spec.labels.forEach((label, index) => {
      if (index % step) return;
      categories.append(
        svg(doc, "text", { class: "chart-category", x: left + band * (index + 0.5), y: top + plotHeight + 18, "text-anchor": "middle" }, fitText(label, band * step - 6, LABEL_SIZE))
      );
    });
    root.append(categories);
    const marks = svg(doc, "g");
    const hits = svg(doc, "g");
    const stops = [];
    spec.labels.forEach((label, index) => {
      const start = left + band * index + (band - groupWidth) / 2;
      for (const segment of segments(spec, shown, index)) {
        const x = spec.stacked ? start : start + segment.slotIndex * (thick + GAP);
        let high = y(Math.max(segment.from, segment.to));
        let low = y(Math.min(segment.from, segment.to));
        if (segment.inner) {
          if (segment.to > 0) low -= GAP;
          else high += GAP;
        }
        const drawn = [];
        if (segment.value && low - high > 0.5) {
          const r = segment.outer ? Math.min(RADIUS, thick / 2, low - high) : 0;
          const up = segment.to > 0;
          drawn.push(svg(doc, "path", { class: markClass(segment.series), d: roundedRect(x, high, thick, low - high, r, [up, up, !up, !up]) }));
          marks.append(...drawn);
        }
        if (spec.stacked && !segment.value) continue;
        const whole = spec.stacked || shown.length === 1;
        const bandStart = left + band * index;
        const slotStart = whole || segment.slotIndex === 0 ? bandStart : x - GAP / 2;
        const slotEnd = whole || segment.slotIndex === shown.length - 1 ? bandStart + band : x + thick + GAP / 2;
        const hitX = slotStart;
        const hitWidth = slotEnd - slotStart;
        const hitTop = Math.max(top, spec.stacked ? segment.outer && segment.to > 0 ? high - 24 : high - GAP / 2 : top);
        const hitLow = Math.min(top + plotHeight, spec.stacked ? segment.outer && segment.to < 0 ? low + 24 : low + GAP / 2 : top + plotHeight);
        const stopIndex = stops.length;
        hits.append(svg(doc, "rect", { class: "chart-hit", "data-stop": stopIndex, x: hitX, width: hitWidth, y: hitTop, height: Math.max(1, hitLow - hitTop) }));
        const rows = [row(segment.series, segment.value, spec.format)];
        if (spec.stacked) rows.push({ value: formatNumber(segmentsTotal(shown, index), spec.format), name: "Total", slot: null });
        stops.push({
          x: x + thick / 2,
          y: segment.to >= 0 ? high : low,
          head: label,
          rows,
          enter: () => toggleOn(drawn, true),
          leave: () => toggleOn(drawn, false)
        });
      }
    });
    root.append(marks);
    root.append(svg(doc, "line", { class: "chart-baseline", x1: left, x2: left + plotWidth, y1: y(0), y2: y(0), "aria-hidden": "true" }));
    const values = svg(doc, "g", { "aria-hidden": "true" });
    for (const { index, series, value } of plan.valueText) {
      const text = formatNumber(value, spec.format);
      const room = series === null || plan.perGroup === 1 ? band - 2 : thick + GAP + 6;
      if (textWidth(text, TICK_SIZE) > room) continue;
      const slotIndex = series === null ? 0 : shown.indexOf(series);
      const x = left + band * index + (band - groupWidth) / 2 + (spec.stacked ? 0 : slotIndex * (thick + GAP)) + thick / 2;
      values.append(svg(doc, "text", { class: "chart-value", x, y: value >= 0 ? y(value) - 6 : y(value) + 14, "text-anchor": "middle" }, text));
    }
    root.append(values, hits);
    return { svg: root, stops };
  }
  function segmentsTotal(shown, index) {
    return shown.reduce((sum, series) => sum + (series.values[index] ?? 0), 0);
  }
  function horizontalBars(doc, spec, shown, width, plan) {
    const count = Math.max(1, spec.labels.length);
    const top = 4;
    const bottom = 26;
    const fixedThick = plan.perGroup === 1 ? 20 : Math.max(6, Math.min(16, 44 / plan.perGroup));
    let band = fixedThick * plan.perGroup + GAP * (plan.perGroup - 1) + 14;
    const height = spec.height ?? top + bottom + band * count;
    if (spec.height !== null) band = (height - top - bottom) / count;
    const thick = spec.height === null ? fixedThick : Math.max(1, Math.min(MAX_BAR, (band * 0.72 - GAP * (plan.perGroup - 1)) / plan.perGroup));
    const groupHeight = thick * plan.perGroup + GAP * (plan.perGroup - 1);
    const labelWidth = Math.min(widest(spec.labels, LABEL_SIZE), width * 0.35);
    const left = Math.ceil(labelWidth) + 12;
    const valueWidth = plan.labelled ? widest(plan.valueText.map(({ value }) => formatNumber(value, spec.format)), TICK_SIZE) + 10 : 0;
    const plotWidthGuess = Math.max(40, width - left - 12 - valueWidth);
    const axis = valueAxis(plan.lo, plan.hi, plotWidthGuess, 90, spec.format);
    const right = Math.max(12, valueWidth, textWidth(axis.text.at(-1) ?? "", TICK_SIZE) / 2 + 2);
    const plotWidth = Math.max(40, width - left - right);
    const plotHeight = height - top - bottom;
    const x = linearScale([axis.min, axis.max], [left, left + plotWidth]);
    const root = rootSvg(doc, width, height);
    root.append(gridLines(doc, axis, (tick) => ({ x1: x(tick), x2: x(tick), y1: top, y2: top + plotHeight })));
    const ticks = svg(doc, "g", { "aria-hidden": "true" });
    axis.ticks.forEach((tick, index) => ticks.append(svg(doc, "text", { class: "chart-tick", x: x(tick), y: top + plotHeight + 17, "text-anchor": "middle" }, axis.text[index])));
    root.append(ticks);
    const categories = svg(doc, "g", { "aria-hidden": "true" });
    spec.labels.forEach((label, index) => {
      categories.append(
        svg(doc, "text", { class: "chart-category", x: left - 10, y: top + band * (index + 0.5), dy: "0.32em", "text-anchor": "end" }, fitText(label, labelWidth, LABEL_SIZE))
      );
    });
    root.append(categories);
    const marks = svg(doc, "g");
    const hits = svg(doc, "g");
    const stops = [];
    spec.labels.forEach((label, index) => {
      const start = top + band * index + (band - groupHeight) / 2;
      for (const segment of segments(spec, shown, index)) {
        const y = spec.stacked ? start : start + segment.slotIndex * (thick + GAP);
        let low = x(Math.min(segment.from, segment.to));
        let high = x(Math.max(segment.from, segment.to));
        if (segment.inner) {
          if (segment.to > 0) low += GAP;
          else high -= GAP;
        }
        const drawn = [];
        if (segment.value && high - low > 0.5) {
          const r = segment.outer ? Math.min(RADIUS, thick / 2, high - low) : 0;
          const rightward = segment.to > 0;
          drawn.push(svg(doc, "path", { class: markClass(segment.series), d: roundedRect(low, y, high - low, thick, r, [!rightward, rightward, rightward, !rightward]) }));
          marks.append(...drawn);
        }
        if (spec.stacked && !segment.value) continue;
        const whole = spec.stacked || shown.length === 1;
        const bandStart = top + band * index;
        const slotStart = whole || segment.slotIndex === 0 ? bandStart : y - GAP / 2;
        const slotEnd = whole || segment.slotIndex === shown.length - 1 ? bandStart + band : y + thick + GAP / 2;
        const hitY = slotStart;
        const hitHeight = slotEnd - slotStart;
        const hitLow = Math.max(left, spec.stacked ? segment.outer && segment.to < 0 ? low - 24 : low - GAP / 2 : left);
        const hitHigh = Math.min(left + plotWidth, spec.stacked ? segment.outer && segment.to > 0 ? high + 24 : high + GAP / 2 : left + plotWidth);
        const stopIndex = stops.length;
        hits.append(svg(doc, "rect", { class: "chart-hit", "data-stop": stopIndex, x: hitLow, width: Math.max(1, hitHigh - hitLow), y: hitY, height: hitHeight }));
        const rows = [row(segment.series, segment.value, spec.format)];
        if (spec.stacked) rows.push({ value: formatNumber(segmentsTotal(shown, index), spec.format), name: "Total", slot: null });
        stops.push({ x: segment.to >= 0 ? high : low, y: y + thick / 2, head: label, rows, enter: () => toggleOn(drawn, true), leave: () => toggleOn(drawn, false) });
      }
    });
    root.append(marks);
    root.append(svg(doc, "line", { class: "chart-baseline", x1: x(0), x2: x(0), y1: top, y2: top + plotHeight, "aria-hidden": "true" }));
    const values = svg(doc, "g", { "aria-hidden": "true" });
    for (const { index, series, value } of plan.valueText) {
      const slotIndex = series === null ? 0 : shown.indexOf(series);
      if (series !== null && plan.perGroup > 1 && thick < 11) continue;
      const y = top + band * index + (band - groupHeight) / 2 + (spec.stacked ? 0 : slotIndex * (thick + GAP)) + thick / 2;
      const end = x(value);
      values.append(
        svg(doc, "text", { class: "chart-value", x: value >= 0 ? end + 6 : end - 6, y, dy: "0.32em", "text-anchor": value >= 0 ? "start" : "end" }, formatNumber(value, spec.format))
      );
    }
    root.append(values, hits);
    return { svg: root, stops };
  }
  function drawLines(doc, spec, shown, width) {
    const count = spec.labels.length;
    const height = spec.height ?? 260;
    const all = shown.flatMap((series) => series.values.filter((value) => value !== null));
    let lo = all.length ? Math.min(...all) : 0;
    let hi = all.length ? Math.max(...all) : 1;
    if (spec.area) {
      lo = Math.min(lo, 0);
      hi = Math.max(hi, 0);
    }
    if (spec.yMin !== null) lo = Math.min(lo, spec.yMin);
    if (spec.yMax !== null) hi = Math.max(hi, spec.yMax);
    const top = 10;
    const bottom = 28;
    const plotHeight = height - top - bottom;
    const axis = valueAxis(lo, hi, plotHeight, 56, spec.format);
    const left = Math.ceil(widest(axis.text, TICK_SIZE)) + 12;
    const lastOf = (series) => lastIndex(series.values, (value) => value !== null);
    const direct = shown.length >= 2 && shown.length <= 4 && shown.every((series) => lastOf(series) === count - 1);
    const right = direct ? Math.min(widest(shown.map((series) => series.name), LABEL_SIZE), width * 0.25) + 16 : 10;
    const plotWidth = Math.max(40, width - left - right);
    const spacing = count > 1 ? plotWidth / (count - 1) : plotWidth;
    const xAt = (index) => count > 1 ? left + index * spacing : left + plotWidth / 2;
    const y = linearScale([axis.min, axis.max], [top + plotHeight, top]);
    const base = axis.min <= 0 && axis.max >= 0 ? 0 : axis.min;
    const root = rootSvg(doc, width, height);
    root.append(gridLines(doc, axis, (tick) => ({ x1: left, x2: left + plotWidth, y1: y(tick), y2: y(tick) })));
    const ticks = svg(doc, "g", { "aria-hidden": "true" });
    axis.ticks.forEach((tick, index) => ticks.append(svg(doc, "text", { class: "chart-tick", x: left - 8, y: y(tick), dy: "0.32em", "text-anchor": "end" }, axis.text[index])));
    root.append(ticks, svg(doc, "line", { class: "chart-baseline", x1: left, x2: left + plotWidth, y1: y(base), y2: y(base), "aria-hidden": "true" }));
    const categories = svg(doc, "g", { "aria-hidden": "true" });
    const step = Math.max(1, Math.ceil((Math.min(widest(spec.labels, LABEL_SIZE), 140) + 16) / spacing));
    spec.labels.forEach((label, index) => {
      if (index % step) return;
      const anchor = count > 1 && index === 0 ? "start" : count > 1 && index === count - 1 ? "end" : "middle";
      categories.append(svg(doc, "text", { class: "chart-category", x: xAt(index), y: top + plotHeight + 18, "text-anchor": anchor }, fitText(label, spacing * step - 8, LABEL_SIZE)));
    });
    root.append(categories);
    const runs = (series) => {
      const out = [];
      let current = [];
      series.values.forEach((value, index) => {
        if (value === null) {
          if (current.length) out.push(current);
          current = [];
        } else current.push([xAt(index), y(value)]);
      });
      if (current.length) out.push(current);
      return out;
    };
    const n = (value) => Math.round(value * 100) / 100;
    const path = (points) => points.map(([px, py], index) => `${index ? "L" : "M"}${n(px)},${n(py)}`).join("") + (points.length === 1 ? `L${n(points[0][0])},${n(points[0][1])}` : "");
    const marks = svg(doc, "g");
    if (spec.area) {
      for (const series of shown) {
        for (const run of runs(series)) {
          const d = `${path(run)}L${n(run.at(-1)[0])},${n(y(base))}L${n(run[0][0])},${n(y(base))}Z`;
          marks.append(svg(doc, "path", { class: `chart-area chart-s${series.slot}`, d }));
        }
      }
    }
    for (const series of shown) {
      const d = runs(series).map(path).join("");
      if (d) marks.append(svg(doc, "path", { class: `chart-line chart-s${series.slot}`, d }));
    }
    const ends = [];
    for (const series of shown) {
      const last = lastOf(series);
      if (last < 0) continue;
      const endY = y(series.values[last]);
      ends.push({ series, y: endY });
      marks.append(svg(doc, "circle", { class: `chart-dot chart-s${series.slot}`, cx: xAt(last), cy: endY, r: 4 }));
    }
    root.append(marks);
    if (direct) {
      const sorted = [...ends].sort((a, b) => a.y - b.y);
      const clear = sorted.every((end, index) => index === 0 || end.y - sorted[index - 1].y >= 14);
      if (clear) {
        const labels = svg(doc, "g", { "aria-hidden": "true" });
        for (const end of ends) {
          labels.append(svg(doc, "text", { class: "chart-series-label", x: left + plotWidth + 10, y: end.y, dy: "0.32em" }, fitText(end.series.name, right - 14, LABEL_SIZE)));
        }
        root.append(labels);
      }
    }
    const crosshair = svg(doc, "line", { class: "chart-crosshair", y1: top, y2: top + plotHeight, x1: left, x2: left, visibility: "hidden", "aria-hidden": "true" });
    const hover = svg(doc, "g", { "aria-hidden": "true" });
    const overlay = svg(doc, "rect", { class: "chart-overlay", x: left - Math.min(spacing / 2, left), y: top, width: plotWidth + Math.min(spacing, left + right), height: plotHeight });
    root.append(crosshair, hover, overlay);
    const stops = spec.labels.map((label, index) => {
      const at = shown.map((series) => ({ series, value: series.values[index] ?? null }));
      const known = at.filter((entry) => entry.value !== null);
      return {
        x: xAt(index),
        y: known.length ? Math.min(...known.map((entry) => y(entry.value))) : top,
        head: label,
        // Highest first, the way the lines stack at this x.
        rows: [...known.sort((a, b) => b.value - a.value), ...at.filter((entry) => entry.value === null)].map((entry) => row(entry.series, entry.value, spec.format)),
        enter: () => {
          crosshair.setAttribute("x1", String(n(xAt(index))));
          crosshair.setAttribute("x2", String(n(xAt(index))));
          crosshair.setAttribute("visibility", "visible");
          hover.replaceChildren(...known.map((entry) => svg(doc, "circle", { class: `chart-dot chart-s${entry.series.slot}`, cx: xAt(index), cy: y(entry.value), r: 4 })));
        },
        leave: () => {
          crosshair.setAttribute("visibility", "hidden");
          hover.replaceChildren();
        }
      };
    });
    const nearest = (px) => count > 1 ? Math.min(count - 1, Math.max(0, Math.round((px - left) / spacing))) : 0;
    return { svg: root, stops, nearest, overlay };
  }
  function wire(win, scene) {
    const tooltip = () => tooltipFor(win);
    const root = scene.svg;
    let current = -1;
    let last = 0;
    const show = (index, client) => {
      const stop = scene.stops[index];
      if (!stop) return;
      if (index !== current) {
        scene.stops[current]?.leave();
        current = index;
        last = index;
        stop.enter();
      }
      const box = root.getBoundingClientRect();
      if (scene.nearest) tooltip().show(stop.head, stop.rows, { x: box.left + stop.x, y: client?.y ?? box.top + stop.y }, "side");
      else tooltip().show(stop.head, stop.rows, client ?? { x: box.left + stop.x, y: box.top + stop.y });
    };
    const hide = () => {
      scene.stops[current]?.leave();
      current = -1;
      tooltip().hide();
    };
    root.addEventListener("pointermove", (event) => {
      const target = event.target;
      const hit = target.closest?.("[data-stop]");
      let index = -1;
      if (hit) index = Number(hit.getAttribute("data-stop"));
      else if (scene.nearest && target === scene.overlay) index = scene.nearest(event.clientX - root.getBoundingClientRect().left);
      if (index < 0) hide();
      else show(index, { x: event.clientX, y: event.clientY });
    });
    root.addEventListener("pointerleave", hide);
    root.addEventListener("focus", () => show(last));
    root.addEventListener("blur", hide);
    root.addEventListener("keydown", (event) => {
      const end = scene.stops.length - 1;
      const from = current < 0 ? last : current;
      const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? Math.min(end, from + 1) : event.key === "ArrowLeft" || event.key === "ArrowUp" ? Math.max(0, from - 1) : event.key === "Home" ? 0 : event.key === "End" ? end : null;
      if (event.key === "Escape") hide();
      if (next === null) return;
      event.preventDefault();
      show(next);
    });
    return hide;
  }
  function describe(spec, shown, name) {
    const kind = spec.type === "line" ? "Line chart" : spec.horizontal ? "Bar chart" : "Column chart";
    const of = shown.length === 1 ? shown[0].name : `${shown.length} series`;
    const tail = spec.table ? "; the data table follows" : "";
    return `${name ? `${name}. ` : ""}${kind} of ${of} over ${spec.labels.length} ${spec.labels.length === 1 ? "point" : "points"}${tail}.`;
  }
  function dataTable(doc, spec) {
    const head = html(doc, "tr", {}, [
      html(doc, "th", { scope: "col" }, [spec.xLabel]),
      ...spec.series.map((series) => html(doc, "th", { scope: "col", class: "num" }, [series.name]))
    ]);
    const body = spec.labels.map(
      (label, index) => html(doc, "tr", {}, [
        html(doc, "th", { scope: "row" }, [label]),
        ...spec.series.map((series) => html(doc, "td", { class: "num" }, [formatNumber(series.values[index], spec.format)]))
      ])
    );
    return html(doc, "details", { class: "chart-table", [PART]: true }, [
      html(doc, "summary", {}, ["Data table"]),
      html(doc, "div", { class: "table-wrap" }, [html(doc, "table", {}, [html(doc, "thead", {}, [head]), html(doc, "tbody", {}, body)])])
    ]);
  }
  function isRecord2(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function createChart(win, target, spec, load) {
    const doc = win.document;
    const figure = resolve(doc, target);
    figure.classList.add("chart");
    const hidden = /* @__PURE__ */ new Set();
    let resolved = null;
    let plot = null;
    let lastWidth = 0;
    let generation = 0;
    let destroyed = false;
    let hideTooltip = () => {
    };
    const Observer = win.ResizeObserver;
    const observer = Observer ? new Observer(() => {
      if (plot && Math.abs(measure() - lastWidth) >= 1) drawPlot();
    }) : null;
    const clear = () => {
      for (const part of [...figure.children]) if (part.hasAttribute(PART)) part.remove();
    };
    const measure = () => Math.floor(plot?.clientWidth || figure.clientWidth || FALLBACK_WIDTH);
    const caption = () => figure.querySelector(":scope > figcaption, :scope > .title")?.textContent?.trim() ?? "";
    function drawPlot() {
      if (!plot || !resolved) return;
      hideTooltip();
      const width = Math.max(160, measure());
      lastWidth = width;
      const shown = resolved.series.filter((series) => !hidden.has(series.slot));
      const scene = resolved.type === "line" ? drawLines(doc, resolved, shown, width) : drawBars(doc, resolved, shown, width);
      scene.svg.setAttribute("aria-label", describe(resolved, shown, caption() || resolved.title || ""));
      plot.replaceChildren(scene.svg);
      hideTooltip = wire(win, scene);
    }
    function render(next) {
      resolved = next;
      for (const slot of [...hidden]) if (!next.series.some((series) => series.slot === slot)) hidden.delete(slot);
      if (hidden.size >= next.series.length) hidden.clear();
      clear();
      if (next.title && !caption()) figure.prepend(html(doc, "figcaption", { [PART]: true }, [next.title]));
      if (next.series.length >= 2) {
        const legend = html(doc, "ul", { class: next.type === "line" ? "chart-legend lines" : "chart-legend", [PART]: true, "aria-label": "Series" });
        for (const series of next.series) {
          const button = html(doc, "button", { type: "button", class: `chart-s${series.slot}`, "aria-pressed": String(!hidden.has(series.slot)) }, [series.name]);
          button.addEventListener("click", () => {
            const showing = !hidden.has(series.slot);
            if (showing && hidden.size >= next.series.length - 1) return;
            if (showing) hidden.add(series.slot);
            else hidden.delete(series.slot);
            button.setAttribute("aria-pressed", String(!showing));
            drawPlot();
          });
          legend.append(html(doc, "li", {}, [button]));
        }
        figure.append(legend);
      }
      plot = html(doc, "div", { class: "chart-plot", [PART]: true });
      figure.append(plot);
      if (next.table) figure.append(dataTable(doc, next));
      observer?.disconnect();
      observer?.observe(plot);
      drawPlot();
    }
    function fail2(error) {
      clear();
      resolved = null;
      plot = null;
      const message = error instanceof Error ? error.message : String(error);
      figure.append(html(doc, "p", { class: "callout critical", [PART]: true, role: "alert" }, [`This chart could not be drawn. ${message}`]));
    }
    const attempt = (next) => {
      try {
        render(resolveSpec(next));
      } catch (error) {
        fail2(error);
        throw error;
      }
    };
    function update(next) {
      const mine = generation += 1;
      if (isRecord2(next) && typeof next.data === "string") {
        const path = next.data;
        return load(path).then(
          (rows) => {
            if (mine !== generation || destroyed) return;
            attempt({ ...next, data: rows });
          },
          (error) => {
            if (mine === generation && !destroyed) fail2(error);
            throw error;
          }
        );
      }
      try {
        attempt(next);
        return Promise.resolve();
      } catch (error) {
        return Promise.reject(error);
      }
    }
    let ready;
    if (isRecord2(spec) && typeof spec.data === "string") ready = update(spec);
    else {
      generation += 1;
      attempt(spec);
      ready = Promise.resolve();
    }
    return {
      element: figure,
      ready,
      update,
      destroy() {
        destroyed = true;
        observer?.disconnect();
        hideTooltip();
        clear();
      }
    };
  }
  function drawSparkline(win, target, raw, options = {}) {
    const doc = win.document;
    const host = resolve(doc, target);
    const values = raw.map((value) => typeof value === "number" && Number.isFinite(value) ? value : null);
    const width = Math.floor(host.clientWidth || 120);
    const height = Math.floor(host.clientHeight || 28);
    const root = host instanceof win.SVGSVGElement ? host : svg(doc, "svg");
    for (const [name, value] of Object.entries({ width, height, viewBox: `0 0 ${width} ${height}`, role: "img" })) root.setAttribute(name, String(value));
    root.replaceChildren();
    const known = values.filter((value) => value !== null);
    const format = options.format ?? "number";
    const what = options.label ?? "Trend";
    if (!known.length) root.setAttribute("aria-label", `${what}: no data`);
    else {
      const pad = 3;
      const lo = Math.min(...known);
      const hi = Math.max(...known);
      const x = (index) => values.length > 1 ? pad + index * (width - pad * 2) / (values.length - 1) : width / 2;
      const y = lo === hi ? () => height / 2 : linearScale([lo, hi], [height - pad, pad]);
      let d = "";
      let drawing = false;
      values.forEach((value, index) => {
        if (value === null) {
          drawing = false;
          return;
        }
        d += `${drawing ? "L" : "M"}${Math.round(x(index) * 100) / 100},${Math.round(y(value) * 100) / 100}`;
        drawing = true;
      });
      const latest = lastIndex(values, (value) => value !== null);
      root.append(svg(doc, "path", { class: "chart-spark", d }), svg(doc, "circle", { class: "chart-spark-now", cx: x(latest), cy: y(values[latest]), r: 2.5 }));
      root.setAttribute("aria-label", `${what}: ${formatNumber(known[0], format)} to ${formatNumber(known.at(-1), format)}`);
    }
    if (root !== host) host.replaceChildren(root);
    return root;
  }

  // src/kit/tables.ts
  var collator = new Intl.Collator(void 0, { numeric: true, sensitivity: "base" });
  function rowsOf(section) {
    return [...section?.children ?? []].filter((node) => node.tagName === "TR");
  }
  function headerCells(table) {
    return [...rowsOf(table.tHead)[0]?.cells ?? []];
  }
  function bodyRows(table) {
    return rowsOf(table.tBodies[0]).filter((row2) => !row2.classList.contains("kit-empty"));
  }
  function cellValue(row2, column) {
    const cell = row2.cells[column];
    return (cell?.dataset.sort ?? cell?.textContent ?? "").trim();
  }
  function bindSortable(win, table) {
    const headers = headerCells(table);
    for (const header of headers) {
      if (header.dataset.sort === "none") continue;
      const button = html(win.document, "button", { type: "button", class: "sort" });
      button.append(...header.childNodes);
      header.append(button);
      button.addEventListener("click", () => {
        const ascending = header.getAttribute("aria-sort") !== "ascending";
        sortTable(table, header.cellIndex, ascending);
        for (const other of headers) if (other !== header) other.removeAttribute("aria-sort");
        header.setAttribute("aria-sort", ascending ? "ascending" : "descending");
      });
    }
  }
  function sortTable(table, column, ascending) {
    const body = table.tBodies[0];
    if (!body) return;
    const rows = bodyRows(table);
    const values = rows.map((row2) => cellValue(row2, column));
    const numeric = values.every((value) => value === "" || toNumber(value) !== null);
    const order = rows.map((row2, index) => ({ row: row2, value: values[index], index })).sort((a, b) => {
      if (a.value === "" || b.value === "") return a.value === b.value ? a.index - b.index : a.value === "" ? 1 : -1;
      const compared = numeric ? toNumber(a.value) - toNumber(b.value) : collator.compare(a.value, b.value);
      return (ascending ? compared : -compared) || a.index - b.index;
    });
    for (const { row: row2 } of order) body.append(row2);
    const empty = body.querySelector("tr.kit-empty");
    if (empty) body.append(empty);
  }
  var filters = /* @__PURE__ */ new WeakMap();
  function columnOf(table, name) {
    if (name === void 0 || name === "") return null;
    const headers = headerCells(table);
    const byName = headers.findIndex((header) => header.textContent?.trim().toLowerCase() === name.trim().toLowerCase());
    if (byName >= 0) return byName;
    return /^\d+$/.test(name) ? Number(name) : null;
  }
  function bindFilter(win, control) {
    const doc = win.document;
    let table = null;
    try {
      table = doc.querySelector(control.dataset.filter ?? "");
    } catch {
    }
    if (!(table instanceof win.HTMLTableElement)) return;
    const target = table;
    const column = columnOf(target, control.dataset.column);
    const exact = control instanceof win.HTMLSelectElement;
    const update = () => {
      let active = filters.get(target);
      if (!active) filters.set(target, active = /* @__PURE__ */ new Map());
      active.set(control, { column, exact, value: control.value.trim().toLowerCase() });
      applyFilters(win, target);
    };
    control.addEventListener(exact ? "change" : "input", update);
    if (control.value) update();
  }
  function matches(row2, filter) {
    if (!filter.value) return true;
    const text = (filter.column === null ? row2.textContent ?? "" : cellValue(row2, filter.column)).toLowerCase();
    if (filter.exact) return filter.column === null ? text.includes(filter.value) : text.trim() === filter.value;
    return filter.value.split(/\s+/).every((word) => text.includes(word));
  }
  function applyFilters(win, table) {
    const active = [...filters.get(table)?.values() ?? []];
    let shown = 0;
    const rows = bodyRows(table);
    for (const row2 of rows) {
      const visible = active.every((filter) => matches(row2, filter));
      row2.hidden = !visible;
      if (visible) shown += 1;
    }
    const body = table.tBodies[0];
    let empty = body?.querySelector("tr.kit-empty") ?? null;
    if (shown === 0 && rows.length && body) {
      if (!empty) {
        const columns = headerCells(table).length || rows[0]?.cells.length || 1;
        empty = html(win.document, "tr", { class: "kit-empty" }, [html(win.document, "td", { colspan: columns, class: "empty" }, ["No rows match."])]);
        body.append(empty);
      }
      empty.hidden = false;
    } else if (empty) empty.hidden = true;
    table.dispatchEvent(new win.CustomEvent("kit:filter", { detail: { shown, total: rows.length } }));
  }
  function bindClickableRows(table) {
    table.addEventListener("click", (event) => {
      const target = event.target;
      if (target.closest("a, button, input, select, textarea, label, summary")) return;
      const row2 = target.closest("tr.clickable");
      if (!row2 || !table.contains(row2)) return;
      const selection = table.ownerDocument.getSelection?.();
      if (selection && !selection.isCollapsed && selection.toString()) return;
      row2.querySelector("a[href]")?.click();
    });
  }

  // src/kit/theme.ts
  var THEME_KEY = "zcc-kit-theme";
  function stored(win) {
    try {
      const value = win.localStorage.getItem(THEME_KEY);
      return value === "light" || value === "dark" ? value : "auto";
    } catch {
      return "auto";
    }
  }
  function prefersDark(win) {
    return typeof win.matchMedia === "function" && win.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  function createTheme(win) {
    const doc = win.document;
    const buttons = /* @__PURE__ */ new Set();
    let choice = stored(win);
    const current = () => choice === "auto" ? prefersDark(win) ? "dark" : "light" : choice;
    const sync = () => {
      const theme = current();
      for (const button of buttons) {
        if (!button.isConnected) {
          buttons.delete(button);
          continue;
        }
        const wanted = button.dataset.kitTheme;
        if (wanted === "light" || wanted === "dark" || wanted === "auto") button.setAttribute("aria-pressed", String(choice === wanted));
        else {
          const next = theme === "dark" ? "light" : "dark";
          button.setAttribute("aria-label", `Switch to ${next} theme`);
          button.dataset.theme = theme;
        }
      }
    };
    const apply = () => {
      if (choice === "auto") delete doc.documentElement.dataset.theme;
      else doc.documentElement.dataset.theme = choice;
      sync();
    };
    const control = {
      get: current,
      choice: () => choice,
      set(next) {
        choice = next === "light" || next === "dark" ? next : "auto";
        try {
          if (choice === "auto") win.localStorage.removeItem(THEME_KEY);
          else win.localStorage.setItem(THEME_KEY, choice);
        } catch {
        }
        apply();
        win.dispatchEvent(new win.CustomEvent("kit:theme", { detail: { theme: current(), choice } }));
      },
      bind(root) {
        for (const button of root.querySelectorAll("[data-kit-theme]")) {
          if (buttons.has(button)) continue;
          buttons.add(button);
          button.addEventListener("click", () => {
            const wanted = button.dataset.kitTheme;
            control.set(wanted === "light" || wanted === "dark" || wanted === "auto" ? wanted : current() === "dark" ? "light" : "dark");
          });
        }
        sync();
      }
    };
    apply();
    if (typeof win.matchMedia === "function") win.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", sync);
    return control;
  }

  // src/kit/widgets.ts
  function bindScrollSpy(win, root) {
    const doc = win.document;
    const links = [...root.querySelectorAll('.site-header nav a[href^="#"]')].map((link) => ({ link, target: doc.getElementById(decodeURIComponent(link.hash.slice(1))) })).filter((entry) => entry.target !== null);
    if (!links.length) return () => {
    };
    let frame = 0;
    const update = () => {
      frame = 0;
      const header = doc.querySelector(".site-header");
      const below = header?.getBoundingClientRect().bottom ?? 0;
      let active = links[0];
      for (const entry of links) {
        const margin = Number.parseFloat(win.getComputedStyle(entry.target).scrollMarginTop) || 0;
        if (entry.target.getBoundingClientRect().top <= Math.max(below, margin) + 16) active = entry;
      }
      if (win.innerHeight + win.scrollY >= doc.documentElement.scrollHeight - 2) active = links.at(-1);
      for (const { link } of links) {
        const on = link === active.link;
        link.classList.toggle("active", on);
        if (on) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      }
    };
    const schedule = () => {
      if (!frame) frame = win.requestAnimationFrame(update);
    };
    win.addEventListener("scroll", schedule, { passive: true });
    win.addEventListener("resize", schedule);
    update();
    return () => {
      win.removeEventListener("scroll", schedule);
      win.removeEventListener("resize", schedule);
      if (frame) win.cancelAnimationFrame(frame);
    };
  }
  var tabIds = 0;
  function bindTabs(win, list) {
    const scope = list.parentElement ?? win.document.body;
    const tabs = [...list.querySelectorAll("button[data-tab]")];
    if (!tabs.length) return;
    const panelFor = (tab) => [...scope.querySelectorAll("[data-tab-panel]")].find((panel) => panel.dataset.tabPanel === tab.dataset.tab) ?? null;
    list.setAttribute("role", "tablist");
    for (const tab of tabs) {
      tabIds += 1;
      tab.type = "button";
      tab.setAttribute("role", "tab");
      tab.id ||= `kit-tab-${tabIds}`;
      const panel = panelFor(tab);
      if (panel) {
        panel.id ||= `kit-tab-panel-${tabIds}`;
        panel.setAttribute("role", "tabpanel");
        panel.setAttribute("aria-labelledby", tab.id);
        tab.setAttribute("aria-controls", panel.id);
      }
    }
    const select = (chosen, focus) => {
      for (const tab of tabs) {
        const on = tab === chosen;
        tab.setAttribute("aria-selected", String(on));
        tab.tabIndex = on ? 0 : -1;
        const panel = panelFor(tab);
        if (panel) panel.hidden = !on;
      }
      if (focus) chosen.focus();
      list.dispatchEvent(new win.CustomEvent("kit:tab", { bubbles: true, detail: { tab: chosen.dataset.tab } }));
    };
    for (const tab of tabs) tab.addEventListener("click", () => select(tab, false));
    list.addEventListener("keydown", (event) => {
      const index = tabs.indexOf(event.target);
      if (index < 0) return;
      const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? (index + 1) % tabs.length : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (index - 1 + tabs.length) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault();
      select(tabs[next], true);
    });
    const hash = win.location.hash.slice(1);
    const initial = tabs.find((tab) => tab.getAttribute("aria-selected") === "true") ?? tabs.find((tab) => hash !== "" && (tab.dataset.tab === hash || panelFor(tab)?.id === hash)) ?? tabs[0];
    select(initial, false);
  }
  function bindDialogTrigger(win, trigger) {
    trigger.addEventListener("click", (event) => {
      const selector = trigger.dataset.dialog ?? "";
      let dialog = null;
      try {
        dialog = win.document.querySelector(selector);
      } catch {
      }
      if (!(dialog instanceof win.HTMLDialogElement)) return;
      event.preventDefault();
      bindDialog(dialog);
      if (!dialog.open) dialog.showModal();
    });
  }
  var boundDialogs = /* @__PURE__ */ new WeakSet();
  function bindDialog(dialog) {
    if (boundDialogs.has(dialog)) return;
    boundDialogs.add(dialog);
    dialog.addEventListener("click", (event) => {
      const target = event.target;
      if (target === dialog || target.closest("[data-dialog-close]")) dialog.close();
    });
  }

  // src/kit/index.ts
  var KIT_VERSION = "1";
  var MAX_CACHED_FILES = 50;
  function isCsv(path, type) {
    return /\.csv$/i.test(path.split(/[?#]/)[0] ?? "") || /text\/csv/i.test(type ?? "");
  }
  function createKit(win) {
    const doc = win.document;
    const theme = createTheme(win);
    const seen = /* @__PURE__ */ new WeakSet();
    const clickable = /* @__PURE__ */ new WeakSet();
    const files = /* @__PURE__ */ new Map();
    let spying = false;
    const fetchText = (path) => {
      let pending = files.get(path);
      if (!pending) {
        pending = win.fetch(path).then(async (response) => {
          if (!response.ok) throw new Error(`Kit.load: ${path} answered ${response.status}`);
          return { text: await response.text(), type: response.headers.get("content-type") };
        });
        pending.catch(() => files.delete(path));
        if (files.size >= MAX_CACHED_FILES) files.delete(files.keys().next().value);
        files.set(path, pending);
      }
      return pending;
    };
    const load = async (path) => {
      if (typeof path !== "string" || !path) throw new Error("Kit.load: give the path of a JSON or CSV file");
      const { text, type } = await fetchText(path);
      if (isCsv(path, type)) return parseCsv(text);
      try {
        return JSON.parse(text);
      } catch (error) {
        throw new Error(`Kit.load: ${path} is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
      }
    };
    const chart = (target, spec) => createChart(win, target, spec, load);
    const declared = (figure) => {
      const script = figure.querySelector(':scope > script[type="application/json"]');
      const file = figure.dataset.chart;
      if (!script && !file) return;
      const fail2 = (error) => {
        if (!figure.querySelector(":scope > .callout.critical")) {
          const note = doc.createElement("p");
          note.className = "callout critical";
          note.setAttribute("data-kit-part", "");
          note.textContent = `This chart could not be drawn. ${error instanceof Error ? error.message : String(error)}`;
          figure.append(note);
        }
        reportError(win, error);
      };
      const draw = (spec) => {
        try {
          chart(figure, spec).ready.catch(fail2);
        } catch (error) {
          fail2(error);
        }
      };
      if (file) load(file).then(draw, fail2);
      else {
        let spec;
        try {
          spec = JSON.parse(script.textContent ?? "");
        } catch (error) {
          fail2(new Error(`Kit.chart: the chart's JSON does not parse (${error instanceof Error ? error.message : String(error)})`));
          return;
        }
        draw(spec);
      }
    };
    const enhance = (root = doc) => {
      theme.bind(root);
      if (!spying && root === doc) {
        spying = true;
        bindScrollSpy(win, doc);
      }
      const each = (selector, bind) => {
        for (const node of root.querySelectorAll(selector)) {
          once(seen, node, () => {
            try {
              bind(node);
            } catch (error) {
              reportError(win, error);
            }
          });
        }
      };
      each(".tab-list", (list) => bindTabs(win, list));
      each("table.sortable", (table) => bindSortable(win, table));
      each("input[data-filter], select[data-filter]", (control) => bindFilter(win, control));
      for (const row2 of root.querySelectorAll("tr.clickable")) {
        const table = row2.closest("table");
        if (table) once(clickable, table, () => bindClickableRows(table));
      }
      each("[data-dialog]", (trigger) => bindDialogTrigger(win, trigger));
      each("dialog", (dialog) => bindDialog(dialog));
      each("figure.chart, [data-chart]", declared);
      each("[data-spark]", (host) => {
        const raw = host.dataset.spark ?? "";
        const values = raw.trim().startsWith("[") ? JSON.parse(raw) : raw.split(",");
        const format = host.dataset.format;
        drawSparkline(win, host, values.map((value) => value === null || String(value).trim() === "" ? null : Number(value)), {
          ...format ? { format } : {},
          ...host.getAttribute("aria-label") ? { label: host.getAttribute("aria-label") } : {}
        });
      });
    };
    return {
      version: KIT_VERSION,
      theme,
      chart,
      sparkline: (target, values, options) => drawSparkline(win, target, values, options),
      load,
      format: (value, format) => formatNumber(value, format),
      sortTable: (table, column, ascending = true) => sortTable(table, column, ascending),
      enhance
    };
  }

  // src/kit/entry.ts
  var kit = createKit(window);
  Object.defineProperty(window, "Kit", { value: kit, configurable: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => kit.enhance(), { once: true });
  else kit.enhance();
})();
