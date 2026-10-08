# The site kit

Design Docs ships a small kit for HTML pages: one stylesheet and one script with
no dependencies, so a doc reads like a finished report or design page in the
panel and on GitHub Pages. Pages load it from `zcc-kit/`. The panel serves that
folder, and `zcc design-docs export --out` copies it into the site. Do not add
your own `zcc-kit/` files; put page-specific styles in your own CSS file.

```html
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>…</title>
  <link rel="stylesheet" href="zcc-kit/site.css">
  <script src="zcc-kit/site.js"></script>
</head>
```

Keep the script in `<head>`: it applies the reader's theme before the page paints
and wires the markup once the page has loaded. From a page in a subfolder, use
`../zcc-kit/…`. The `report` and `html-design` templates are complete examples.

## Layout

- `header.site-header`: the top bar. Inside it, `a.brand` holds
  `span.brand-mark` (a letter or icon) and `span.brand-text` (`<strong>` name plus a
  `<span>` subtitle). Add `<nav>` with `#section` links (the link of the section in
  view is marked active) and `div.actions` for buttons.
- `<main>` holds the content (`main.narrow` for reading width). Give each
  `<section>` an `id` for the nav. `div.section-head` holds an `<h2>` and a
  `<p>` subtitle.
- `footer.site-footer`.
- Text: `.eyebrow` (a small label above a title), `.lede` (intro paragraph),
  `.muted`, `.visually-hidden`.
- Grids: `.grid` (auto-fit cards), `.grid.wide`, `.grid.cols-2`, `.grid.cols-3`.
  `.card` is a bordered panel.
- `.button` and `.button.primary`.

## Components

- **KPI tiles**: `div.kpis` holding `div.tile`s, each with `.label`, `.value`,
  `.note` and an optional sparkline. A delta inside the note:
  `span.delta.good.up`, `span.delta.bad.down`. `.hero` is one big number.
- **Status**: `span.status.good`, `.warning`, `.serious` or `.critical` (a plain
  `.status` is neutral). Always write the word; color is never the only cue.
- **Callouts**: `div.callout`, plus `.good`, `.warning` or `.critical`.
- `span.pill` is a small tag. `div.flow` with `div.step`s (`<b>` title, then
  text) is a left-to-right process.
- **Meter**: `<div class="meter" style="--value: 64%"><span>64%</span></div>`, with
  `.warning` or `.critical`.
- **Tables**: wrap a table in `div.table-wrap` so it scrolls. Use `th.num` and
  `td.num` for numbers.
  - `table.sortable` makes each header a sort button. `data-sort="none"` on a `<th>`
    opts that column out, and `data-sort="…"` on a `<td>` gives the cell its sort
    value.
  - `tr.clickable` makes the whole row follow the first link in it.
- **Filters**: put them in a `div.filters` row above what they filter. Inside it,
  `span.title` names the row and each `<label>` wraps a control.
  `<input data-filter="#runs">` filters the rows of `table#runs` by text.
  `<select data-filter="#runs" data-column="Option">` matches one column by its
  header. An empty value shows every row.
- **Tabs**: `div.tab-list` holding `<button data-tab="a">` buttons, and elsewhere
  `<div data-tab-panel="a">`. The URL hash can pick the tab.
- **Dialogs**: `<button data-dialog="#about">` opens `<dialog id="about">`, and
  `data-dialog-close` inside the dialog closes it.
- **Theme**: `<button data-kit-theme>` toggles light and dark;
  `data-kit-theme="light"`, `"dark"` or `"auto"` picks one. The reader's choice is
  remembered, and the page follows the system theme until they choose. The kit
  sets `data-theme` on `<html>` for a chosen theme.

## Charts

A chart is a `figure.chart` with a JSON spec. The kit draws it as an SVG with
gridlines, a legend for two or more series, hover tooltips and a data table
under it.

```html
<figure class="chart">
  <figcaption>Success rate by week</figcaption>
  <p class="sub">Share of runs that succeeded</p>
  <script type="application/json">
    {"type": "line", "data": "data/weekly.csv", "x": "week", "y": ["Option A", "Option B"], "format": "percent"}
  </script>
</figure>
```

You can also point at a spec file instead: `<figure class="chart" data-chart="charts/trend.json">`.

| Field | Meaning |
| --- | --- |
| `type` | `"bar"` or `"line"`. |
| `labels` + `series` | Inline data: `labels` for the x axis, `series: [{"name", "values", "slot"?}]`. Use `null` for a gap. |
| `data` + `x` + `y` | Rows instead: a CSV or JSON file path (or an array of objects). `x` names the label column, and `y` names one or more value columns (`"col"`, `["a","b"]` or `[{"column","name","slot"}]`). |
| `format` | `"number"`, `"integer"`, `"percent"` or `"compact"`, or `Intl.NumberFormat` options. Percent values are fractions (`0.42` shows as 42%). |
| `stacked`, `horizontal` | Bar charts only. |
| `area` | Line charts only. |
| `yMin`, `yMax` | Widen the axis (for example `yMin: 0`). They never cut data off. |
| `height` | 80 to 2000 pixels. |
| `valueLabels` | Values at the bar ends. On by default for one series of up to 12 bars. |
| `table` | Set it to `false` to hide the data table. |
| `xLabel` | The header of the label column in that table. |
| `title` | Shown as the caption when the figure has no `<figcaption>`. |

Rules the kit enforces, so your spec fails with a message rather than a misleading chart:

- At most 8 series, with up to 2000 points. Fold small series into "Other" or
  split into several charts.
- Series take the color slots 1–8 in order. Pin `slot` so a series keeps its
  color across charts and filters.
- There is one y axis. Two measures on different scales need two charts.
- A broken spec shows a red callout in the figure with the reason. The page
  check and the render report surface it to you too.

## Sparklines

`<svg class="spark" data-spark="52,55,58,61" data-format="percent" aria-label="Success rate"></svg>`
draws a small trend line. Commas or a JSON array both work, and an empty value is
a gap.

## Script API

`site.js` defines `window.Kit`:

- `Kit.chart(target, spec)` returns `{ element, ready, update(spec), destroy() }`.
- `Kit.sparkline(target, values, { format, label })`
- `await Kit.load(path)` returns a JSON value or CSV rows (numbers parsed, cached).
- `Kit.format(value, format)`
- `Kit.sortTable(table, column, ascending)`
- `Kit.enhance(root)` wires kit markup you added after load.
- `Kit.theme.get()` gives the theme shown, `choice()` what the reader picked, and
  `set('light' | 'dark' | 'auto')` changes it.

Events: `kit:theme` on `window` (`detail: { theme, choice }`), `kit:tab` on the
tab list (`detail: { tab }`, bubbles) and `kit:filter` on a filtered table
(`detail: { shown, total }`).

## CSS tokens

Use the variables so your own styles follow the theme:

- `--page`, `--surface-1` and `--surface-2` are the backgrounds; `--border` is for lines.
- `--text-primary`, `--text-secondary` and `--text-muted` are the ink; `--accent` and `--link` are for emphasis and links.
- `--series-1` … `--series-8` are the chart colors.
- `--seq-100` … `--seq-700` are one hue from light to dark, for heat maps.
- `--good`, `--warning`, `--serious` and `--critical` are for status only.
