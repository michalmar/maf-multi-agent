# PRD: Chart.js Native Agent Charts

> **Status:** Approved  
> **Author:** Architecture Review  
> **Date:** 2026-05-20  

---

## 1. Problem Statement

Coder Data charts are now emitted as `.mafchart.json` artifacts and rendered in the browser, but the first implementation uses custom SVG/CSS chart renderers. Those renderers preserve the Usage Dashboard style and avoid image artifacts, but they provide limited built-in interactivity and duplicate chart behavior that already exists in `michalmar/copilot-billing-preview`.

The desired experience is to keep the safe artifact-based workflow while rendering charts with the same polished, interactive Chart.js pattern used in the billing preview application.

---

## 2. Goals

1. Render `.mafchart.json` artifacts with Chart.js-backed components for richer browser interactivity.
2. Preserve the existing markdown and artifact contract: `[chart:Title](sandbox:/mnt/data/file.mafchart.json)`.
3. Keep historical `.mafchart.json` artifacts compatible without migration.
4. Prevent agents from emitting arbitrary Chart.js configuration.
5. Keep PNG history replay behavior unchanged for sessions created before native chart artifacts.

---

## 3. Non-Goals

1. Do not replace the Usage Dashboard implementation in this change.
2. Do not add arbitrary user-authored Chart.js option passthrough.
3. Do not introduce a chart database or separate chart persistence model.
4. Do not add a third-party matrix chart plugin unless correlation matrix requirements outgrow the current SVG implementation.

---

## 4. Solution

Keep the existing chart artifact pipeline and replace the frontend chart renderer internals with Chart.js adapters inspired by `copilot-billing-preview/src/components`.

### 4.1 Artifact Contract

The Coder Data agent continues to create a JSON file under `/mnt/data` and link it from the shared document:

```markdown
[chart:Daily vibration trend](sandbox:/mnt/data/daily_vibration_trend.mafchart.json)
```

The JSON remains declarative:

```json
{
  "version": 1,
  "renderer": "maf-native",
  "type": "multi_timeseries",
  "title": "Daily vibration trend",
  "xLabel": "Date",
  "yLabel": "Vibration",
  "series": [
    {
      "name": "Motor A",
      "color": "#2f81f7",
      "data": [{ "x": "2026-05-01", "y": 12.4 }]
    }
  ]
}
```

### 4.2 Supported Chart Types

| Type | Renderer |
|------|----------|
| `bar` | Chart.js vertical bar |
| `horizontal_bar` | Chart.js horizontal bar |
| `stacked_bar` | Chart.js stacked bar adapted from billing-preview multi-series bars |
| `line` / `timeseries` | Chart.js line chart adapted from billing-preview dual-axis line charts |
| `multi_timeseries` | Multiple Chart.js line panels or a multi-series line chart |
| `scatter` | Chart.js scatter plot |
| `correlation_matrix` | Existing custom SVG matrix |

### 4.3 Safety Boundary

The agent supplies data, labels, colors, thresholds, and high-level chart type only. The frontend owns Chart.js `data`, `options`, plugin registration, responsive behavior, themes, tooltips, and axis formatting. This keeps the artifact format stable and avoids untrusted Chart.js option execution.

### 4.4 Compatibility

Existing `.mafchart.json` files keep rendering because the public artifact schema does not change. Older PNG-only history sessions continue using the existing image replay path and are not migrated to JSON charts.

---

## 5. User Experience

Users see the same chart cards in shared documents and final answers, but chart bodies gain native Chart.js interactions:

- Hover tooltips.
- Legend toggling.
- Responsive canvas rendering.
- Stacked bar and dual-axis line behavior consistent with the billing preview charts.
- JSON download remains available for auditability.

---

## 6. Caveats and Risks

| Risk | Mitigation |
|------|------------|
| Larger frontend bundle | Add only `chart.js` and `react-chartjs-2`; avoid optional plugins initially. |
| Theme mismatch | Resolve app CSS variables and feed concrete colors into Chart.js. |
| Matrix chart gap | Keep the current custom SVG matrix until a plugin is justified. |
| Schema drift | Keep agent-authored JSON declarative and validate/coerce it in the renderer. |
| Historical PNGs | Preserve existing image rendering and history file proxy paths. |

---

## 7. Rollout

1. Merge the Chart.js renderer with the existing native chart feature enabled by default.
2. Keep `.mafchart.json` links and history replay behavior unchanged.
3. Update Coder Data dispatch instructions to describe Chart.js-backed native artifacts.
4. Validate frontend tests, frontend production build, and backend regression tests.
